import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { OllamaClient, OllamaError, pickChatModel } from '@core/ai/ollama'
import { AiError, type ProviderDeps } from '@core/ai/providers'
import { Orchestrator, type Llm } from '@core/ai/orchestrator'
import { EntityExtractor, EntityService } from '@core/entities'
import { buildObituary, GhostHunter } from '@core/ghosts'
import { FatalIndexError, ImageReader, IndexPipeline, watchFolder, type Embedder, type FolderWatcher } from '@core/indexing'
import { isVirtualPath, openContainer, parseVPath } from '@core/media'
import { SqliteStore } from '@core/memory'
import { kindOf, type FileKind } from '@shared/filetypes'
import type { Ghost, Person, PersonSummary, SearchAnswer } from '@shared/types'
import type { ChangeDto, IndexState, NameDecision, OllamaHint, OllamaStatus, RestoreOutcome, Settings, TrashItemDto, TrashOverview } from '@shared/ipc'
import { AiService } from './ai'
import type { SecretStore } from './secrets'
import type { SettingsStore } from './settings'
import { SetupManager } from './setup'
import { TrashService, type TrashDeps } from './trash'

const YEAR_MS = 365.25 * 24 * 3600 * 1000
const MODEL_CACHE_MS = 15_000
const ENTITY_DEBOUNCE_MS = 10_000

/** Lo que OUIJA necesita de un servidor de modelos. `OllamaClient` lo cumple; las pruebas usan uno falso. */
export interface ModelClient extends Embedder, Llm {
  listModels(): Promise<string[]>
  probeDimensions(): Promise<number>
}

export interface MediumCoreDeps {
  dataDir: string
  settings: SettingsStore
  /** Claves de API de los servicios externos. */
  secrets: SecretStore
  /** Solo pruebas: dirección local que imita a los proveedores. */
  aiDeps?: ProviderDeps
  /** Crea el cliente de modelos. Por defecto, Ollama local. */
  createClient?: (settings: Settings, chatModel: string | undefined) => ModelClient
  /** Reloj inyectable para pruebas. */
  now?: () => number
  /** Cada cuánto se revisan las carpetas por si la vigilancia en vivo se perdió algo (0 = nunca). */
  rescanEveryMs?: number
  /** Solo pruebas: dónde buscar la papelera. */
  trash?: TrashDeps
}

const EMPTY_STATE: IndexState = { phase: 'idle', processed: 0, total: 0, indexed: 0, skipped: 0, errors: 0 }

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function defaultClient(s: Settings, chatModel: string | undefined): ModelClient {
  return new OllamaClient({ host: s.ollamaHost, embedModel: s.embedModel, chatModel })
}

/**
 * Núcleo de la aplicación sin dependencias de Electron: reúne el índice, los modelos locales, la
 * búsqueda, los fantasmas y las personas. Lo usa el proceso principal y se prueba por separado.
 */
export class MediumCore {
  private store!: SqliteStore
  private entityService!: EntityService
  private state: IndexState = { ...EMPTY_STATE }
  private listeners = new Set<(s: IndexState) => void>()
  private watchers: FolderWatcher[] = []
  private abort: AbortController | null = null
  private running: Promise<void> | null = null
  private entityTimer: NodeJS.Timeout | undefined
  private models: { at: number; list: string[]; host: string } | null = null
  private readonly now: () => number
  private readonly makeClient: NonNullable<MediumCoreDeps['createClient']>
  /** Motor local y modelos: instala lo que falte la primera vez. */
  readonly setup: SetupManager
  /** Modelo de lenguaje local o de un servicio externo. */
  readonly ai: AiService
  /** La papelera del sistema: se lee y se puede resucitar de ella. */
  readonly trash: TrashService
  private changeListeners = new Set<() => void>()
  private rescanTimer: NodeJS.Timeout | undefined

  constructor(private readonly deps: MediumCoreDeps) {
    this.now = deps.now ?? Date.now
    this.makeClient = deps.createClient ?? defaultClient
    this.trash = new TrashService(deps.trash)
    this.ai = new AiService(deps.secrets, () => deps.settings.value, (ai) => deps.settings.update({ ai }), deps.aiDeps)
    this.setup = new SetupManager({ dataDir: deps.dataDir, getSettings: () => deps.settings.value, onModelsChanged: () => this.modelsChanged() })
  }

  get dataDir(): string {
    return this.deps.dataDir
  }
  private get settings(): Settings {
    return this.deps.settings.value
  }
  private get tempDir(): string {
    return join(this.deps.dataDir, 'open')
  }
  private get dbFile(): string {
    return join(this.deps.dataDir, 'index.sqlite')
  }

  // --- Ciclo de vida -----------------------------------------------------

  async init(): Promise<void> {
    await mkdir(this.deps.dataDir, { recursive: true })
    await rm(this.tempDir, { recursive: true, force: true }) // las copias para abrir no sobreviven al reinicio
    await this.openStore(this.settings.embedDimensions)

    await this.syncEmbeddingDimensions()
    // Si el motor local está instalado pero apagado (por ejemplo, tras reiniciar), se enciende sin bloquear el arranque.
    void this.setup.startIfInstalled().then((up) => (up ? this.modelsChanged() : undefined)).catch(() => undefined)
    this.entityService = new EntityService(this.store)
    if (this.settings.watchFolders) await this.startWatchers()
    this.startSafetyRescan()
  }

  /** Si el modelo de embeddings cambió de dimensión, el índice se rehace. */
  private async syncEmbeddingDimensions(): Promise<void> {
    const status = await this.ollamaStatus()
    if (!status.available || !status.embedModelInstalled) return
    try {
      const dims = await this.makeClient(this.settings, undefined).probeDimensions()
      if (dims !== this.settings.embedDimensions) {
        await this.deps.settings.update({ embedDimensions: dims })
        await this.store.close()
        await this.openStore(dims)
      }
    } catch {
      // Se reintenta en la próxima indexación.
    }
  }

  /** Se instaló o encendió algo: hay que volver a leer qué modelos hay. */
  async modelsChanged(): Promise<void> {
    this.models = null
    await this.syncEmbeddingDimensions()
  }

  async close(): Promise<void> {
    clearTimeout(this.entityTimer)
    clearInterval(this.rescanTimer)
    this.setup.stopServer()
    this.abort?.abort()
    await this.running?.catch(() => undefined)
    await this.stopWatchers()
    await this.store.close()
  }

  private async openStore(dimensions: number): Promise<void> {
    try {
      this.store = new SqliteStore(this.dbFile, { dimensions })
    } catch (error) {
      if (!/dimensiones/.test(messageOf(error))) throw error
      // Otro modelo de embeddings: se conserva el índice anterior como respaldo y se empieza de nuevo.
      await rename(this.dbFile, `${this.dbFile}.bak-${this.now()}`)
      this.store = new SqliteStore(this.dbFile, { dimensions })
    }
    this.entityService = new EntityService(this.store)
  }

  // --- Modelos -----------------------------------------------------------

  private async installedModels(force = false): Promise<string[] | null> {
    const host = this.settings.ollamaHost
    if (!force && this.models && this.models.host === host && this.now() - this.models.at < MODEL_CACHE_MS) return this.models.list
    try {
      const list = await this.makeClient(this.settings, undefined).listModels()
      this.models = { at: this.now(), list, host }
      return list
    } catch {
      this.models = null
      return null
    }
  }

  /** Ollama con el mejor modelo de chat instalado (o el elegido). `chatModel` es `undefined` si no hay ninguno. */
  private async localClient(): Promise<{ client: ModelClient; chatModel: string | undefined }> {
    const models = await this.installedModels()
    const wanted = this.settings.chatModel
    const chatModel = wanted && models?.some((m) => m === wanted || m.startsWith(`${wanted}:`)) ? wanted : models ? pickChatModel(models) : undefined
    return { client: this.makeClient(this.settings, chatModel), chatModel }
  }

  /**
   * Cliente para buscar y responder. Los embeddings son siempre locales. El modelo de lenguaje es el
   * local o el del servicio externo elegido; si falta la clave, no hay modelo de lenguaje (modo ligero).
   */
  private async client(): Promise<{ client: ModelClient; chatModel: string | undefined; remote: boolean }> {
    const local = await this.localClient()
    if (this.settings.ai.mode !== 'remote') return { ...local, remote: false }
    const remote = this.ai.remote()
    if (!remote) return { client: this.makeClient(this.settings, undefined), chatModel: undefined, remote: true }
    const hybrid: ModelClient = {
      embed: (texts) => local.client.embed(texts),
      probeDimensions: () => local.client.probeDimensions(),
      listModels: () => local.client.listModels(),
      complete: (prompt, options) => remote.llm.complete(prompt, options)
    }
    return { client: hybrid, chatModel: `${remote.provider}:${remote.model}`, remote: true }
  }

  /**
   * Modelo para reconocer personas y resumir documentos, que lee el texto de cada archivo. Con un
   * servicio externo solo se usa si el usuario lo permitió; si no, el local, y si no hay, nada.
   */
  private async documentLlm(): Promise<ModelClient | null> {
    const main = await this.client()
    if (!main.remote) return main.chatModel ? main.client : null
    if (main.chatModel && this.settings.ai.remoteDocuments) return main.client
    const local = await this.localClient()
    return local.chatModel ? local.client : null
  }

  async ollamaStatus(): Promise<OllamaStatus> {
    const s = this.settings
    const models = await this.installedModels(true)
    if (!models) {
      return { available: false, host: s.ollamaHost, models: [], embedModel: s.embedModel, embedModelInstalled: false, hints: [{ code: 'start-ollama' }] }
    }
    const embedModelInstalled = models.some((m) => m === s.embedModel || m.startsWith(`${s.embedModel}:`))
    const remote = s.ai.mode === 'remote'
    const chatModel = remote ? undefined : (await this.localClient()).chatModel
    const hints: OllamaHint[] = []
    if (!embedModelInstalled) hints.push({ code: 'pull-embed', command: `ollama pull ${s.embedModel}` })
    if (!chatModel && !remote) hints.push({ code: 'pull-chat', command: 'ollama pull qwen3.5:4b' })
    return { available: true, host: s.ollamaHost, models, embedModel: s.embedModel, embedModelInstalled, chatModel, hints }
  }

  // --- Preguntas ---------------------------------------------------------

  async ask(question: string): Promise<SearchAnswer> {
    const { client, chatModel } = await this.client()
    // Si el servicio externo falla (clave inválida, sin saldo…), se responde en modo ligero y se avisa por qué.
    let aiProblem: AiError['code'] | undefined
    const llm: Llm | undefined = chatModel
      ? {
          complete: async (prompt, options) => {
            try {
              return await client.complete(prompt, options)
            } catch (error) {
              if (error instanceof AiError) aiProblem = error.code
              throw error
            }
          }
        }
      : undefined
    const orchestrator = new Orchestrator({ store: this.store, embedder: client, llm, entities: this.entityService })
    const r = await orchestrator.ask(question, { lang: this.settings.lang })
    return {
      answer: r.answer,
      found: r.found,
      mode: r.mode,
      warnings: r.warnings,
      aiProblem,
      matches: r.matches.map((h, i) => {
        const { container, inner } = parseVPath(h.doc.path)
        return {
          id: `${i}:${h.doc.path}`,
          name: basename(inner ?? container),
          path: h.doc.path,
          container: inner ? container : undefined,
          snippet: h.snippetKind === 'meta' ? '' : h.snippet,
          mtime: h.doc.mtime,
          size: h.doc.size,
          ext: h.doc.ext,
          resurrected: h.doc.resurrected,
          confidence: h.doc.confidence,
          viaEntity: h.viaEntity
        }
      })
    }
  }

  // --- Fantasmas y personas ----------------------------------------------

  async ghosts(): Promise<Ghost[]> {
    const report = await new GhostHunter(this.store).scan({ now: this.now(), staleAfterMs: this.settings.staleYears * YEAR_MS })

    // Personas y lugares/proyectos por archivo, para la necrológica.
    const byFile = new Map<string, { people: Set<string>; topics: Set<string> }>()
    for (const m of await this.store.entityMentions()) {
      const e = byFile.get(m.path) ?? { people: new Set<string>(), topics: new Set<string>() }
      ;(m.kind === 'person' ? e.people : e.topics).add(m.name)
      byFile.set(m.path, e)
    }

    return report.ghosts.map((entry) => {
      const extra = byFile.get(entry.doc.path)
      const o = buildObituary(entry, { people: [...(extra?.people ?? [])], topics: [...(extra?.topics ?? [])] })
      return {
        id: o.path,
        name: o.name,
        path: o.path,
        container: o.container,
        kind: o.kind,
        born: o.born,
        lastUsed: o.lastUsed,
        summary: o.summary,
        people: o.people,
        topics: o.topics,
        related: o.related,
        resurrected: o.resurrected || undefined,
        confidence: o.confidence,
        group: o.group
      }
    })
  }

  async people(): Promise<PersonSummary[]> {
    return (await this.entityService.people()).map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, fileCount: e.paths.length }))
  }

  async timeline(id: string): Promise<Person | null> {
    const t = await this.entityService.timeline(id)
    if (!t) return null
    return {
      id: t.entity.id,
      name: t.entity.name,
      aliases: t.entity.aliases,
      fileCount: t.entity.paths.length,
      files: t.items.map((i) => {
        const { container, inner } = parseVPath(i.doc.path)
        return { name: basename(inner ?? container), path: i.doc.path, mtime: i.doc.mtime, snippet: i.context }
      })
    }
  }

  async decideNames(decision: NameDecision, a: string, b: string): Promise<void> {
    if (decision === 'merge') await this.entityService.merge('person', a, b)
    else if (decision === 'split') await this.entityService.split('person', a, b)
    else await this.entityService.clearDecision('person', a, b)
  }

  // --- Archivos ----------------------------------------------------------

  /** Solo se actúa sobre rutas que están en el índice: la interfaz no puede pedir archivos arbitrarios. */
  async requireIndexed(path: string): Promise<void> {
    if (!(await this.store.hasPath(path))) throw new Error('El archivo no está en el índice')
  }

  private async readIndexed(path: string): Promise<{ name: string; data: Buffer }> {
    await this.requireIndexed(path)
    const { container, inner } = parseVPath(path)
    if (!inner) return { name: basename(container), data: await readFile(container) }

    const c = await openContainer(container)
    const entry = c.entries.find((e) => e.name === inner)
    if (!entry) throw new Error('El archivo ya no está dentro del respaldo')
    return { name: basename(inner), data: await entry.read() }
  }

  /** Devuelve una ruta real que el sistema puede abrir. Para archivos dentro de un respaldo, una copia temporal. */
  async preparePathToOpen(path: string): Promise<string> {
    await this.requireIndexed(path)
    if (!isVirtualPath(path)) {
      await access(path).catch(() => {
        throw new Error('El archivo ya no existe en su ubicación')
      })
      return path
    }
    const { name, data } = await this.readIndexed(path)
    const dir = join(this.tempDir, createHash('sha1').update(path).digest('hex').slice(0, 16))
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, name)
    await writeFile(file, data, { mode: 0o600 })
    return file
  }

  /** Carpeta o archivo que se muestra en el explorador: el contenedor si el archivo vive en uno. */
  async pathToReveal(path: string): Promise<string> {
    await this.requireIndexed(path)
    const { container } = parseVPath(path)
    await access(container).catch(() => {
      throw new Error('El archivo ya no existe en su ubicación')
    })
    return container
  }

  /** Copia el archivo (o la entrada del respaldo) a `destDir` sin sobrescribir nada. Devuelve la ruta creada. */
  async exportTo(path: string, destDir: string): Promise<string> {
    await this.requireIndexed(path)
    const { name, data } = await this.readIndexed(path)
    await mkdir(destDir, { recursive: true })
    const ext = extname(name)
    const stem = name.slice(0, name.length - ext.length)
    for (let n = 0; n < 1000; n++) {
      const target = join(destDir, n === 0 ? name : `${stem} (${n})${ext}`)
      try {
        await writeFile(target, data, { flag: 'wx', mode: 0o600 }) // 'wx': falla si ya existe
        return target
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new Error('No se pudo encontrar un nombre libre en la carpeta de destino')
  }

  // --- Cambios detectados -------------------------------------------------

  private readonly changeSink = {
    record: (c: Parameters<SqliteStore['recordChange']>[0]): void => {
      this.store.recordChange(c)
      for (const l of this.changeListeners) l()
    }
  }

  onChanges(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  recentChanges(limit = 30): ChangeDto[] {
    return this.store.recentChanges(limit).map((c) => ({ id: c.id, ts: c.ts, kind: c.kind, name: c.name, path: c.path, ext: c.ext, size: c.size, summary: c.summary, exists: c.exists }))
  }

  /**
   * Red de seguridad: la vigilancia en vivo puede perderse algo (disco desconectado, límite del
   * sistema operativo, cambios con OUIJA cerrado), así que cada tanto se revisan las carpetas.
   * Es barato: lo que no cambió se salta por tamaño y fecha.
   */
  private startSafetyRescan(): void {
    const every = this.deps.rescanEveryMs ?? 15 * 60_000
    if (every <= 0) return
    this.rescanTimer = setInterval(() => {
      if (this.running || this.settings.folders.length === 0 || !this.settings.onboarded) return
      void this.indexNow()
    }, every)
    this.rescanTimer.unref?.()
  }

  // --- La papelera ---------------------------------------------------------

  async trashOverview(): Promise<TrashOverview> {
    if (!this.trash.supported) return { supported: false, items: [], totalCount: 0, totalSize: 0, byKind: {}, locations: 0 }
    const { items, locations } = await this.trash.list()

    // Lo que OUIJA sabía de cada archivo antes de que se borrara.
    const known = this.store.knownSummaries(items.flatMap((i) => (i.originalPath ? [i.originalPath] : [])))
    const byKind: Partial<Record<FileKind, number>> = {}
    let totalSize = 0
    let oldest: number | undefined
    const dtos: TrashItemDto[] = items.map((i) => {
      const kind: FileKind = i.isDir ? 'other' : kindOf(i.ext)
      byKind[kind] = (byKind[kind] ?? 0) + 1
      totalSize += i.size
      if (i.trashedAt !== undefined && (oldest === undefined || i.trashedAt < oldest)) oldest = i.trashedAt
      return {
        id: i.id,
        name: i.name,
        originalPath: i.originalPath,
        originalFolder: i.originalPath ? dirname(i.originalPath) : undefined,
        trashedAt: i.trashedAt,
        size: i.size,
        sizeApprox: i.sizeApprox,
        isDir: i.isDir,
        ext: i.ext,
        kind,
        summary: i.originalPath ? known.get(i.originalPath) : undefined
      }
    })
    return { supported: true, items: dtos, totalCount: dtos.length, totalSize, byKind, oldest, locations }
  }

  /** Trae de vuelta elementos de la papelera. `destDir` vacío = a su lugar original. */
  async restoreFromTrash(ids: string[], destDir?: string): Promise<RestoreOutcome[]> {
    const results: RestoreOutcome[] = []
    for (const id of ids.slice(0, 200)) results.push(await this.trash.restore(id, destDir))
    return results
  }

  // --- Indexación ---------------------------------------------------------

  getState(): IndexState {
    return { ...this.state }
  }

  onState(listener: (s: IndexState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setState(patch: Partial<IndexState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.getState())
  }

  /** Indexa todas las carpetas y luego extrae entidades y resúmenes. Si ya hay una en curso, espera esa. */
  indexNow(): Promise<void> {
    this.running ??= this.runIndex().finally(() => {
      this.running = null
      this.abort = null
    })
    return this.running
  }

  cancelIndex(): void {
    this.abort?.abort()
  }

  private async runIndex(): Promise<void> {
    const abort = (this.abort = new AbortController())
    const s = this.settings
    this.setState({ ...EMPTY_STATE, phase: 'scanning', lastRunAt: this.state.lastRunAt })
    try {
      const { client } = await this.client()
      const pipeline = new IndexPipeline({ store: this.store, embedder: client, changes: this.changeSink })

      let doneBefore = 0
      let totalBefore = 0
      let indexed = 0
      let skipped = 0
      let errors = 0
      for (const folder of s.folders) {
        if (abort.signal.aborted) break
        const report = await pipeline.indexFolder(folder, {
          excludeDirs: s.excludeDirs,
          includeHidden: s.includeHidden,
          signal: abort.signal,
          onProgress: (p) =>
            this.setState({
              phase: p.phase === 'scanning' ? 'scanning' : 'indexing',
              processed: doneBefore + p.processed,
              total: totalBefore + p.total,
              current: p.current,
              indexed: indexed + p.indexed,
              skipped: skipped + p.skipped,
              errors: errors + p.errors
            })
        })
        doneBefore += report.scanned
        totalBefore += report.scanned
        indexed += report.indexed
        skipped += report.skipped
        errors += report.errors
      }

      if (s.ocrImages && !abort.signal.aborted) await this.readImages(client, abort.signal)
      const documentLlm = abort.signal.aborted ? null : await this.documentLlm()
      if (documentLlm) await this.extractEntities(documentLlm, abort.signal)
      this.setState({ phase: 'idle', current: undefined, lastRunAt: this.now() })
    } catch (error) {
      const fatal = error instanceof FatalIndexError || (error instanceof OllamaError && error.fatal)
      this.setState({ phase: 'error', current: undefined, message: fatal ? 'ollama' : messageOf(error) })
    }
  }

  /** Lee el texto de las imágenes pequeñas, varias a la vez. Es lento, por eso va después de dejar todo buscable. */
  private async readImages(embedder: Embedder, signal?: AbortSignal): Promise<void> {
    await new ImageReader(this.store, embedder).run({
      signal,
      onProgress: (p) => this.setState({ phase: 'reading', processed: p.processed, total: p.total, current: p.current })
    })
  }

  private async extractEntities(llm: Llm, signal?: AbortSignal): Promise<void> {
    const before = this.state
    await new EntityExtractor(this.store, llm).indexPending({
      signal,
      onProgress: (p) => this.setState({ phase: 'entities', processed: p.processed, total: p.total, current: p.current, errors: before.errors + p.errors })
    })
  }

  /** Vigila las carpetas configuradas y mantiene el índice al día. */
  async startWatchers(): Promise<void> {
    await this.stopWatchers()
    const s = this.settings
    const { client } = await this.client()
    const pipeline = new IndexPipeline({ store: this.store, embedder: client, changes: this.changeSink })
    for (const folder of s.folders) {
      try {
        await access(folder)
        this.watchers.push(
          await watchFolder(folder, pipeline, {
            excludeDirs: s.excludeDirs,
            includeHidden: s.includeHidden,
            onIndexed: () => this.extractEntitiesSoon(),
            onError: () => undefined
          })
        )
      } catch {
        // Carpeta ausente (por ejemplo, un disco desconectado): se omite sin fallar.
      }
    }
  }

  private async stopWatchers(): Promise<void> {
    const old = this.watchers
    this.watchers = []
    await Promise.all(old.map((w) => w.close().catch(() => undefined)))
  }

  private extractEntitiesSoon(): void {
    clearTimeout(this.entityTimer)
    this.entityTimer = setTimeout(() => {
      if (this.running) return
      void (async () => {
        const { client } = await this.client()
        if (this.settings.ocrImages) await new ImageReader(this.store, client).run().catch(() => undefined)
        const documentLlm = await this.documentLlm()
        if (documentLlm) await new EntityExtractor(this.store, documentLlm).indexPending().catch(() => undefined)
      })()
    }, ENTITY_DEBOUNCE_MS)
    this.entityTimer.unref?.()
  }

  // --- Configuración y datos ----------------------------------------------

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const before = this.settings
    const after = await this.deps.settings.update(patch)
    const foldersChanged = JSON.stringify(before.folders) !== JSON.stringify(after.folders)
    const scanChanged = before.ocrImages !== after.ocrImages || before.includeHidden !== after.includeHidden || JSON.stringify(before.excludeDirs) !== JSON.stringify(after.excludeDirs)
    const modelsChanged = before.ollamaHost !== after.ollamaHost || before.embedModel !== after.embedModel || before.chatModel !== after.chatModel
    if (modelsChanged) this.models = null

    // Las imágenes ya indexadas quedan pendientes de lectura: al activar el OCR basta con indexar de nuevo.
    if (after.ocrImages && !before.ocrImages) void this.indexNow()

    if (after.watchFolders && (foldersChanged || scanChanged || !before.watchFolders)) await this.startWatchers()
    else if (!after.watchFolders && before.watchFolders) await this.stopWatchers()
    return after
  }

  async addFolder(folder: string): Promise<Settings> {
    return this.updateSettings({ folders: [...this.settings.folders, folder] })
  }

  /** Quita la carpeta y olvida lo que se indexó de ella. */
  async removeFolder(folder: string): Promise<Settings> {
    const after = await this.updateSettings({ folders: this.settings.folders.filter((f) => f !== folder) })
    const pipeline = new IndexPipeline({ store: this.store, embedder: { embed: async () => [] } })
    await pipeline.forgetFolder(folder)
    return after
  }

  /** "Olvidar todo": índice, entidades, decisiones manuales y copias temporales. */
  async forgetAll(): Promise<void> {
    this.abort?.abort()
    await this.running?.catch(() => undefined)
    await this.stopWatchers()
    await this.store.forgetAll()
    await rm(this.tempDir, { recursive: true, force: true })
    this.setState({ ...EMPTY_STATE })
    if (this.settings.watchFolders) await this.startWatchers()
  }
}
