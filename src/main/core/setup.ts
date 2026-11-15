import { createHash } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, chmod, mkdir, readdir, realpath, rename, rm, statfs } from 'node:fs/promises'
import { homedir, totalmem } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createZstdDecompress } from 'node:zlib'
import { assertLocalHost, OllamaClient } from '@core/ai/ollama'
import { find7z } from '@core/media'
import { findSoffice } from '@core/extract/legacy'
import { findTesseract } from '@core/extract/ocr'
import type {
  FolderSuggestion,
  OptionalTool,
  Settings,
  SetupErrorCode,
  SetupState,
  SetupStep,
  SetupStepId
} from '@shared/ipc'

/** Tamaños aproximados, solo para avisar antes de descargar. */
export const SIZES = { runtime: 1.6e9, embed: 1.2e9, chat: 3.3e9 } as const
export const CHAT_MODEL = 'qwen3.5:4b'
/** Con menos memoria que esto el modelo de respuestas no corre bien: se omite y OUIJA sigue en modo ligero. */
export const MIN_RAM_FOR_CHAT = 7e9
const RELEASES_API = 'https://api.github.com/repos/ollama/ollama/releases/latest'
const ALLOWED_DOWNLOAD_PREFIX = 'https://github.com/ollama/ollama/releases/download/'
const START_TIMEOUT_MS = 45_000

export class SetupError extends Error {
  constructor(
    readonly code: SetupErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'SetupError'
  }
}

export interface SetupDeps {
  /** Carpeta de datos de la aplicación: ahí vive el motor que OUIJA instala. */
  dataDir: string
  getSettings: () => Settings
  /** Reemplazables en pruebas. */
  fetch?: typeof fetch
  platform?: NodeJS.Platform
  arch?: string
  totalMemory?: () => number
  freeSpace?: (dir: string) => Promise<number>
  /** Dónde buscar un Ollama ya instalado. Por defecto, las rutas habituales del sistema. */
  systemBinaries?: string[]
  /** Se llama cuando cambió algo que afecta a los modelos (para que el núcleo los vuelva a leer). */
  onModelsChanged?: () => void | Promise<void>
}

interface ReleaseAsset {
  name: string
  size: number
  digest?: string
  browser_download_url: string
}

/** Qué archivo del release corresponde a este sistema. */
export function pickAsset(assets: ReleaseAsset[], platform: NodeJS.Platform, arch: string): ReleaseAsset | undefined {
  const cpu = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'amd64' : undefined
  if (!cpu) return undefined
  const name = platform === 'linux' ? `ollama-linux-${cpu}.tar.zst` : platform === 'win32' ? `ollama-windows-${cpu}.zip` : undefined
  return name ? assets.find((a) => a.name === name) : undefined
}

const EMPTY = (id: SetupStepId, sizeBytes: number): SetupStep => ({ id, status: 'pending', completed: 0, total: 0, sizeBytes })

/** Comandos para instalar los complementos opcionales según el sistema. */
export function toolHint(id: OptionalTool['id'], platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return { libreoffice: 'winget install TheDocumentFoundation.LibreOffice', tesseract: 'winget install UB-Mannheim.TesseractOCR', poppler: 'winget install oschwartz10612.Poppler', '7zip': 'winget install 7zip.7zip' }[id]
  }
  return { libreoffice: 'sudo apt install libreoffice', tesseract: 'sudo apt install tesseract-ocr tesseract-ocr-spa', poppler: 'sudo apt install poppler-utils', '7zip': 'sudo apt install p7zip-full' }[id]
}

/**
 * Deja OUIJA funcionando sin que el usuario instale nada a mano: usa el Ollama del sistema si ya
 * está, o descarga uno propio (verificado con SHA-256) en la carpeta de datos, lo enciende y baja los
 * modelos. Es lo único que usa internet, y solo durante esta puesta en marcha.
 */
export class SetupManager {
  private state: SetupState
  private listeners = new Set<(s: SetupState) => void>()
  private running: Promise<SetupState> | null = null
  private abort: AbortController | null = null
  private child: ChildProcess | null = null
  private readonly doFetch: typeof fetch
  private readonly platform: NodeJS.Platform
  private readonly arch: string

  constructor(private readonly deps: SetupDeps) {
    this.doFetch = deps.fetch ?? fetch
    this.platform = deps.platform ?? process.platform
    this.arch = deps.arch ?? process.arch
    this.state = this.fresh()
  }

  private fresh(): SetupState {
    return {
      running: false,
      steps: [EMPTY('runtime', SIZES.runtime), EMPTY('embed', SIZES.embed), EMPTY('chat', SIZES.chat)],
      ready: false,
      complete: false,
      tools: []
    }
  }

  private get managedDir(): string {
    return join(this.deps.dataDir, 'ollama')
  }
  private get managedBinary(): string {
    return join(this.managedDir, this.platform === 'win32' ? 'ollama.exe' : join('bin', 'ollama'))
  }

  // --- Estado ---------------------------------------------------------------

  getState(): SetupState {
    return JSON.parse(JSON.stringify(this.state)) as SetupState
  }

  onState(listener: (s: SetupState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private patch(id: SetupStepId, change: Partial<SetupStep>): void {
    this.state.steps = this.state.steps.map((s) => (s.id === id ? { ...s, ...change } : s))
    this.recompute()
    this.emit()
  }

  private recompute(): void {
    const by = (id: SetupStepId) => this.state.steps.find((s) => s.id === id) as SetupStep
    const ok = (s: SetupStep) => s.status === 'done'
    this.state.ready = ok(by('runtime')) && ok(by('embed'))
    this.state.complete = this.state.steps.every((s) => s.status === 'done' || s.status === 'skipped')
    this.state.running = this.running !== null
  }

  private emit(): void {
    const snapshot = this.getState()
    for (const l of this.listeners) l(snapshot)
  }

  private client(): OllamaClient {
    const s = this.deps.getSettings()
    return new OllamaClient({ host: s.ollamaHost, embedModel: s.embedModel, timeoutMs: 8000, fetch: this.doFetch })
  }

  private async installedModels(): Promise<string[] | null> {
    try {
      return await this.client().listModels()
    } catch {
      return null
    }
  }

  private hasModel(models: string[], name: string): boolean {
    return models.some((m) => m === name || m.startsWith(`${name}:`))
  }

  /** Mira qué hay instalado sin descargar ni encender nada. */
  async check(): Promise<SetupState> {
    if (this.running) return this.getState()
    const s = this.deps.getSettings()
    const models = await this.installedModels()
    const runtimeDone = models !== null
    this.state.steps = [
      { ...EMPTY('runtime', SIZES.runtime), status: runtimeDone ? 'done' : 'pending', note: runtimeDone ? 'ollama' : undefined },
      { ...EMPTY('embed', SIZES.embed), status: models && this.hasModel(models, s.embedModel) ? 'done' : 'pending', note: s.embedModel },
      this.chatStep(models)
    ]
    this.state.tools = await this.detectTools()
    this.recompute()
    return this.getState()
  }

  private chatStep(models: string[] | null): SetupStep {
    const base = EMPTY('chat', SIZES.chat)
    if (this.deps.getSettings().ai.mode === 'remote') return { ...base, status: 'skipped', note: 'remote' }
    const wanted = this.deps.getSettings().chatModel || CHAT_MODEL
    if (models && (this.hasModel(models, wanted) || models.some((m) => !/embed|bge|nomic|minilm|e5|rerank/i.test(m)))) {
      return { ...base, status: 'done', note: wanted }
    }
    if ((this.deps.totalMemory ?? totalmem)() < MIN_RAM_FOR_CHAT) {
      return { ...base, status: 'skipped', note: 'low-memory' }
    }
    return { ...base, note: wanted }
  }

  async detectTools(): Promise<OptionalTool[]> {
    const has = (cmd: string) => spawnSync(cmd, ['-v'], { stdio: 'ignore' }).error === undefined
    const found: Record<OptionalTool['id'], boolean> = {
      libreoffice: (await findSoffice()) !== null,
      tesseract: (await findTesseract()) !== null,
      poppler: has('pdftoppm'),
      '7zip': (await find7z()) !== null
    }
    return (Object.keys(found) as OptionalTool['id'][]).map((id) => ({ id, found: found[id], hint: toolHint(id, this.platform) }))
  }

  // --- Ejecución ------------------------------------------------------------

  /** Instala lo que falte. Si ya hay una ejecución en curso, espera esa. Nunca lanza: los fallos quedan en cada paso. */
  start(): Promise<SetupState> {
    this.running ??= this.run().finally(() => {
      this.running = null
      this.abort = null
      this.recompute()
      this.emit()
    })
    this.recompute()
    return this.running
  }

  cancel(): void {
    this.abort?.abort()
  }

  private async run(): Promise<SetupState> {
    const abort = (this.abort = new AbortController())
    const signal = abort.signal
    await this.check().catch(() => undefined)
    this.state.running = true
    this.emit()

    const settings = this.deps.getSettings()
    const guard = async (id: SetupStepId, fn: () => Promise<void>): Promise<boolean> => {
      const current = this.state.steps.find((s) => s.id === id)?.status
      if (current === 'done' || current === 'skipped') return true
      this.patch(id, { status: 'running', detail: 'checking', completed: 0, total: 0, error: undefined, errorMessage: undefined })
      try {
        await fn()
        this.patch(id, { status: 'done', detail: undefined, completed: 0, total: 0 })
        return true
      } catch (error) {
        const e = error instanceof SetupError ? error : new SetupError('unknown', error instanceof Error ? error.message : String(error), { cause: error })
        this.patch(id, { status: 'error', detail: undefined, error: e.code, errorMessage: signal.aborted ? 'cancelled' : e.message })
        return false
      }
    }

    const runtimeOk = await guard('runtime', () => this.ensureRuntime(signal))
    if (runtimeOk) {
      const embedOk = await guard('embed', () => this.pull(settings.embedModel, 'embed', signal))
      if (embedOk) await this.deps.onModelsChanged?.()
      if (embedOk) {
        await guard('chat', () => this.pull(settings.chatModel || CHAT_MODEL, 'chat', signal))
        await this.deps.onModelsChanged?.()
      }
    } else {
      for (const id of ['embed', 'chat'] as const) this.patch(id, { status: 'pending' })
    }
    this.state.tools = await this.detectTools()
    return { ...this.getState(), running: false }
  }

  // --- Motor local -----------------------------------------------------------

  /** Enciende (o instala y enciende) el motor. */
  async ensureRuntime(signal?: AbortSignal): Promise<void> {
    if ((await this.installedModels()) !== null) return // ya hay uno funcionando

    let binary = await this.findBinary()
    if (!binary) {
      binary = await this.install(signal)
    }
    this.patch('runtime', { detail: 'starting', completed: 0, total: 0 })
    await this.spawnServer(binary, binary === this.managedBinary)
  }

  /** Para el arranque normal: si el motor está instalado pero apagado, lo enciende. No instala nada. */
  async startIfInstalled(): Promise<boolean> {
    if ((await this.installedModels()) !== null) return true
    const binary = await this.findBinary()
    if (!binary) return false
    try {
      await this.spawnServer(binary, binary === this.managedBinary)
      return true
    } catch {
      return false
    }
  }

  private async findBinary(): Promise<string | null> {
    try {
      await access(this.managedBinary)
      return this.managedBinary
    } catch {
      // sigue con el del sistema
    }
    const candidates =
      this.deps.systemBinaries ??
      (this.platform === 'win32' ? ['ollama', join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Ollama', 'ollama.exe')] : ['ollama', '/usr/local/bin/ollama', '/usr/bin/ollama'])
    for (const bin of candidates) {
      if (spawnSync(bin, ['--version'], { stdio: 'ignore' }).error === undefined) return bin
    }
    return null
  }

  private async spawnServer(binary: string, managed: boolean): Promise<void> {
    const url = assertLocalHost(this.deps.getSettings().ollamaHost)
    const env: NodeJS.ProcessEnv = { ...process.env, OLLAMA_HOST: `${url.hostname}:${url.port || '11434'}` }
    if (managed) env['OLLAMA_MODELS'] = join(this.managedDir, 'models')
    const child = spawn(binary, ['serve'], { env, stdio: 'ignore', windowsHide: true })
    this.child = child
    let exited = false
    child.once('exit', () => {
      exited = true
      if (this.child === child) this.child = null
    })
    child.once('error', () => (exited = true))

    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if ((await this.installedModels()) !== null) return
      if (exited) throw new SetupError('start', 'El motor local se cerró al arrancar')
      await new Promise((r) => setTimeout(r, 400))
    }
    child.kill()
    throw new SetupError('start', 'El motor local no respondió a tiempo')
  }

  /** Apaga el motor solo si lo encendió OUIJA. */
  stopServer(): void {
    this.child?.kill()
    this.child = null
  }

  private async install(signal?: AbortSignal): Promise<string> {
    if (this.platform !== 'linux' && this.platform !== 'win32') {
      throw new SetupError('unsupported', 'La instalación automática solo está disponible en Linux y Windows')
    }
    await this.requireSpace(SIZES.runtime * 2.5, 'runtime')

    this.patch('runtime', { detail: 'checking' })
    let release: { assets?: ReleaseAsset[] }
    try {
      const res = await this.doFetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json' }, signal })
      if (!res.ok) throw new Error(`GitHub respondió ${res.status}`)
      release = (await res.json()) as { assets?: ReleaseAsset[] }
    } catch (error) {
      throw this.networkError(error, signal)
    }
    const asset = pickAsset(release.assets ?? [], this.platform, this.arch)
    if (!asset) throw new SetupError('unsupported', `No hay motor local para ${this.platform} ${this.arch}`)
    if (!asset.browser_download_url.startsWith(ALLOWED_DOWNLOAD_PREFIX)) throw new SetupError('blocked', 'Dirección de descarga no permitida')
    const sha = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined
    if (!sha) throw new SetupError('checksum', 'La descarga no trae una huella para verificarla')

    await mkdir(this.managedDir, { recursive: true })
    const archive = join(this.managedDir, asset.name + '.part')
    await rm(archive, { force: true })
    try {
      await this.download(asset.browser_download_url, archive, sha, asset.size, signal)
      this.patch('runtime', { detail: 'extracting', completed: 0, total: 0 })
      const staging = join(this.deps.dataDir, 'ollama.staging')
      await rm(staging, { recursive: true, force: true })
      await mkdir(staging, { recursive: true })
      await this.extract(archive, staging)
      await rm(this.managedDir + '.old', { recursive: true, force: true })
      await rm(join(this.managedDir, 'bin'), { recursive: true, force: true })
      await rm(join(this.managedDir, 'lib'), { recursive: true, force: true })
      for (const entry of await readdir(staging)) await rename(join(staging, entry), join(this.managedDir, entry))
      await rm(staging, { recursive: true, force: true })
      if (this.platform === 'linux') await chmod(this.managedBinary, 0o755)
      await access(this.managedBinary)
    } catch (error) {
      if (error instanceof SetupError) throw error
      throw new SetupError('extract', `No se pudo instalar el motor local: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    } finally {
      await rm(archive, { force: true })
    }
    return this.managedBinary
  }

  /** Descarga verificando la huella SHA-256. Si no coincide, borra el archivo y falla. */
  private async download(url: string, dest: string, sha256: string, size: number, signal?: AbortSignal): Promise<void> {
    let res: Response
    try {
      res = await this.doFetch(url, { signal })
    } catch (error) {
      throw this.networkError(error, signal)
    }
    if (!res.ok || !res.body) throw new SetupError('offline', `La descarga falló (${res.status})`)
    const total = Number(res.headers.get('content-length')) || size
    const hash = createHash('sha256')
    let done = 0
    this.patch('runtime', { detail: 'downloading', completed: 0, total })
    const source = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
    source.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      done += chunk.length
      if (done % (1 << 20) < chunk.length) this.patch('runtime', { completed: done, total })
    })
    try {
      await pipeline(source, createWriteStream(dest), { signal })
    } catch (error) {
      await rm(dest, { force: true })
      throw this.networkError(error, signal)
    }
    this.patch('runtime', { detail: 'verifying', completed: total, total })
    if (hash.digest('hex') !== sha256) {
      await rm(dest, { force: true })
      throw new SetupError('checksum', 'La descarga está dañada o fue alterada: la huella no coincide')
    }
  }

  private async extract(archive: string, into: string): Promise<void> {
    if (this.platform === 'win32') {
      await run('tar', ['-x', '-f', archive, '-C', into])
      return
    }
    const tar = spawn('tar', ['-x', '-C', into], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    tar.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    const closed = new Promise<void>((ok, fail) => {
      tar.once('error', fail)
      tar.once('close', (code) => (code === 0 ? ok() : fail(new Error(`tar terminó con código ${code}: ${stderr.slice(0, 200)}`))))
    })
    await Promise.all([pipeline(createReadStream(archive), createZstdDecompress(), tar.stdin), closed])
  }

  // --- Modelos ---------------------------------------------------------------

  private async pull(model: string, id: 'embed' | 'chat', signal?: AbortSignal): Promise<void> {
    const models = await this.installedModels()
    if (models && this.hasModel(models, model)) return
    await this.requireSpace((id === 'embed' ? SIZES.embed : SIZES.chat) * 1.3, id)

    const host = assertLocalHost(this.deps.getSettings().ollamaHost).origin
    this.patch(id, { detail: 'pulling', note: model })
    let res: Response
    try {
      res = await this.doFetch(`${host}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal })
    } catch (error) {
      throw new SetupError('start', 'No se pudo hablar con el motor local', { cause: error })
    }
    if (!res.ok || !res.body) throw new SetupError('pull', `El motor local respondió ${res.status}`)

    const layers = new Map<string, { total: number; completed: number }>()
    const decoder = new TextDecoder()
    let buffer = ''
    let success = false
    const handle = (line: string): void => {
      if (!line.trim()) return
      let msg: { status?: string; digest?: string; total?: number; completed?: number; error?: string }
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.error) throw new SetupError(/dial tcp|no such host|timeout|connection|network|lookup/i.test(msg.error) ? 'offline' : 'pull', msg.error)
      if (msg.digest && msg.total) layers.set(msg.digest, { total: msg.total, completed: msg.completed ?? 0 })
      if (msg.status === 'success') success = true
      let total = 0
      let completed = 0
      for (const l of layers.values()) {
        total += l.total
        completed += l.completed
      }
      this.patch(id, { completed, total })
    }
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) handle(line)
      }
      handle(buffer)
    } catch (error) {
      if (error instanceof SetupError) throw error
      throw this.networkError(error, signal)
    }
    if (!success) throw new SetupError('pull', 'La descarga del modelo terminó sin confirmar que quedó instalado')
  }

  // --- Auxiliares ------------------------------------------------------------

  private async requireSpace(bytes: number, id: SetupStepId): Promise<void> {
    const free = await (this.deps.freeSpace ?? defaultFreeSpace)(this.deps.dataDir)
    if (free < bytes) {
      throw new SetupError('no-space', `Hace falta espacio libre: ${(bytes / 1e9).toFixed(1)} GB y hay ${(free / 1e9).toFixed(1)} GB (${id})`)
    }
  }

  private networkError(error: unknown, signal?: AbortSignal): SetupError {
    if (signal?.aborted) return new SetupError('unknown', 'cancelled', { cause: error })
    return new SetupError('offline', 'Sin conexión a internet', { cause: error })
  }
}

async function defaultFreeSpace(dir: string): Promise<number> {
  await mkdir(dir, { recursive: true })
  const s = await statfs(dir)
  return s.bavail * s.bsize
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: 'ignore', windowsHide: true })
    p.once('error', fail)
    p.once('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} terminó con código ${code}`))))
  })
}

/** Carpetas habituales del usuario que existen, para ofrecerlas con un clic. */
export async function suggestFolders(home = homedir()): Promise<FolderSuggestion[]> {
  const names = ['Documentos', 'Documents', 'Descargas', 'Downloads', 'Escritorio', 'Desktop', 'Imágenes', 'Pictures']
  const out: FolderSuggestion[] = []
  const seen = new Set<string>()
  for (const name of names) {
    const path = join(home, name)
    try {
      await access(path)
    } catch {
      continue
    }
    // Documentos/Documents y similares suelen ser enlaces a la misma carpeta; las vacías no sirven.
    const real = await realpath(path)
    if (seen.has(real) || (await readdir(path)).length === 0) continue
    seen.add(real)
    out.push({ path, name })
  }
  return out
}
