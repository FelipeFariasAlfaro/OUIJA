import { createHash } from 'node:crypto'
import { basename, resolve, sep } from 'node:path'
import { extensionOf as extOf, isIgnoredFile, kindOf, type FileKind } from '@shared/filetypes'
import { OllamaError } from '../ai/ollama'
import { hashFileQuiet, readFileQuiet } from '../fsQuiet'
import { extractText as defaultExtract, isSupportedExtension, type ExtractInput, type ExtractOptions, type ExtractResult } from '../extract'
import { isContainerPath, isVirtualPath, makeVPath, openContainer, parseVPath } from '../media'
import type { Chunk, Confidence, IndexedDoc } from '../memory'
import type { MemoryStore } from '../memory'
import { chunkText, type ChunkOptions } from './chunker'
import { buildMetaText } from './meta'
import { scanFolder, type ScanOptions } from './scanner'
import {
  FatalIndexError,
  type ChangeSink,
  type Embedder,
  type IndexProgress,
  type IndexReport,
  type ScannedFile,
  type Summarizer
} from './types'

export interface PipelineDeps {
  store: MemoryStore
  embedder: Embedder
  summarizer?: Summarizer
  /** Reemplazable en pruebas. */
  extract?: (input: ExtractInput, options?: ExtractOptions) => Promise<ExtractResult>
  chunking?: ChunkOptions
  /** Dónde anotar lo que cambia (archivos nuevos, modificados y eliminados). */
  changes?: ChangeSink
}

export interface IndexFolderOptions extends ScanOptions {
  signal?: AbortSignal
  onProgress?: (progress: IndexProgress) => void
}

type Outcome = 'indexed' | 'skipped' | 'error'

const CONFIDENCE_ORDER: Confidence[] = ['low', 'medium', 'high']
const capConfidence = (c: Confidence, max: Confidence): Confidence =>
  CONFIDENCE_ORDER[Math.min(CONFIDENCE_ORDER.indexOf(c), CONFIDENCE_ORDER.indexOf(max))]

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

const sha256File = (path: string, size: number): Promise<string> => hashFileQuiet(path, () => createHash('sha256'), size > FULL_HASH_LIMIT ? { partialAbove: FULL_HASH_LIMIT } : undefined)

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isFatal(error: unknown): boolean {
  return error instanceof FatalIndexError || (error instanceof OllamaError && error.fatal)
}

/** Archivos más grandes que esto se identifican con su inicio y final, no con todo su contenido. */
const FULL_HASH_LIMIT = 64 * 1024 * 1024
/** Lo máximo que se lee de un archivo para extraer su contenido. */
const READ_LIMIT_DOCS = 200 * 1024 * 1024
const READ_LIMIT_TEXT = 1024 * 1024
const READ_LIMIT_CODE = 256 * 1024
/** Cuántos fragmentos de contenido se guardan según el tipo: del código basta el comienzo. */
const MAX_CONTENT_CHUNKS: Partial<Record<FileKind, number>> = { code: 3, data: 3, web: 60, other: 3 }
const MAX_CONTAINER_ENTRIES = 5000

function contentReadLimit(kind: FileKind, ext: string, size: number): number | null {
  if (kind === 'code' || kind === 'data') return READ_LIMIT_CODE
  if (kind === 'text' || kind === 'web' || ext === 'csv' || ext === 'tsv' || ext === 'eml') return READ_LIMIT_TEXT
  if (kind === 'image') return null // el texto de las imágenes se lee aparte, en segundo plano
  return isSupportedExtension(ext) && size <= READ_LIMIT_DOCS ? READ_LIMIT_DOCS : null
}

/** Texto plano sin extensión (LICENSE, Makefile, README): se reconoce mirando el inicio del archivo. */
function looksLikeText(head: Buffer): boolean {
  if (head.length === 0) return false
  let odd = 0
  for (const b of head) if (b === 0 || (b < 9) || (b > 13 && b < 32)) odd++
  return odd / head.length < 0.02
}

export class IndexPipeline {
  private readonly store: MemoryStore
  private readonly embedder: Embedder
  private readonly summarizer?: Summarizer
  private readonly extract: (input: ExtractInput, options?: ExtractOptions) => Promise<ExtractResult>
  private readonly chunking?: ChunkOptions
  private readonly changes?: ChangeSink

  constructor(deps: PipelineDeps) {
    this.store = deps.store
    this.embedder = deps.embedder
    this.summarizer = deps.summarizer
    this.extract = deps.extract ?? defaultExtract
    this.chunking = deps.chunking
    this.changes = deps.changes
  }

  /** Indexa una carpeta completa, reutiliza lo que no cambió y olvida lo que ya no existe. */
  async indexFolder(root: string, options: IndexFolderOptions = {}): Promise<IndexReport> {
    const folder = resolve(root)
    const progress: IndexProgress = { phase: 'scanning', processed: 0, total: 0, indexed: 0, skipped: 0, errors: 0 }
    const emit = () => options.onProgress?.({ ...progress })

    // La primera vez que se indexa una carpeta todo es "nuevo": no se anota, solo lo que cambie después.
    const prefix = folder.endsWith(sep) ? folder : folder + sep
    const record = (await this.store.listFiles({ folder: prefix })).length > 0

    emit()
    const files: ScannedFile[] = []
    for await (const file of scanFolder(folder, options)) {
      if (options.signal?.aborted) break
      files.push(file)
    }
    progress.phase = 'indexing'
    progress.total = files.length
    emit()

    for (const file of files) {
      if (options.signal?.aborted) break
      progress.current = file.path
      const outcome = await this.indexFile(file, { record })
      progress.processed++
      progress[outcome === 'indexed' ? 'indexed' : outcome === 'skipped' ? 'skipped' : 'errors']++
      emit()
    }

    const removed = options.signal?.aborted ? 0 : await this.removeMissing(folder, new Set(files.map((f) => f.path)), record)
    progress.phase = 'done'
    progress.current = undefined
    emit()
    return { scanned: files.length, indexed: progress.indexed, skipped: progress.skipped, errors: progress.errors, removed }
  }

  /** Olvida lo indexado bajo `folder` cuyo archivo ya no está en `seen`. */
  async removeMissing(folder: string, seen: Set<string>, record = true): Promise<number> {
    const prefix = folder.endsWith(sep) ? folder : folder + sep
    let removed = 0
    for (const doc of await this.store.listFiles({ folder: prefix })) {
      const { container } = parseVPath(doc.path)
      if (!seen.has(container)) {
        if (record) this.noteRemoved(doc)
        await this.store.forget(doc.path)
        removed++
      }
    }
    return removed
  }

  /** Anota que un archivo desapareció, con lo que OUIJA sabía de él (después ya no se puede consultar). */
  private noteRemoved(doc: IndexedDoc): void {
    if (isVirtualPath(doc.path)) return // lo de dentro de un respaldo se cuenta con el respaldo
    this.changes?.record({ kind: 'removed', path: doc.path, name: basename(doc.path), ext: doc.ext, size: doc.size, summary: doc.summary })
  }

  /** Olvida un archivo (y lo que contenga si es un contenedor). `record`: el archivo se borró de verdad. */
  async forgetPath(path: string, record = true): Promise<void> {
    const target = resolve(path)
    const doc = await this.store.getDoc(target)
    if (doc && record) this.noteRemoved(doc)
    await this.store.forget(target)
  }

  /** Olvida todo lo indexado bajo una carpeta (por ejemplo, tras borrarla). */
  async forgetFolder(folder: string, record = false): Promise<void> {
    const prefix = resolve(folder) + sep
    for (const doc of await this.store.listFiles({ folder: prefix })) {
      if (record) this.noteRemoved(doc)
      await this.store.forget(doc.path)
    }
  }

  /** Indexa un archivo (o contenedor). Solo lanza ante fallos de infraestructura. */
  async indexFile(file: ScannedFile, options: { record?: boolean } = {}): Promise<Outcome> {
    const outcome = await this.indexFileInner(file)
    if (outcome.outcome !== 'skipped' && options.record !== false) {
      this.changes?.record({ kind: outcome.existed ? 'modified' : 'added', path: file.path, name: basename(file.path), ext: file.ext, size: file.size })
    }
    return outcome.outcome
  }

  private async indexFileInner(file: ScannedFile): Promise<{ outcome: Outcome; existed: boolean }> {
    if (isIgnoredFile(file.path)) return { outcome: 'skipped', existed: false }
    const existing = await this.store.getDoc(file.path)
    const existed = existing !== undefined
    if (existing && existing.size === file.size && existing.mtime === file.mtime) return { outcome: 'skipped', existed }

    const hash = await sha256File(file.path, file.size).catch((error: unknown) => {
      throw new Error(`No se pudo leer ${file.path}: ${messageOf(error)}`)
    })
    if (existing && existing.hash === hash) return { outcome: 'skipped', existed }

    if (isContainerPath(file.path)) return { outcome: await this.indexContainer(file, hash), existed }

    return {
      existed,
      outcome: await this.processDocument({
      path: file.path,
      name: basename(file.path),
      size: file.size,
      mtime: file.mtime,
      atime: file.atime,
      born: file.born,
      hash,
      read: (max) => readFileQuiet(file.path, max)
      })
    }
  }

  private async indexContainer(file: ScannedFile, hash: string): Promise<Outcome> {
    await this.store.forget(file.path) // quita entradas que ya no existan en el contenedor
    const container = await openContainer(file.path)

    const base: IndexedDoc = {
      path: file.path,
      hash,
      size: file.size,
      mtime: file.mtime,
      atime: file.atime,
      born: file.born,
      ext: file.ext
    }
    // El respaldo en sí también se puede buscar por su nombre.
    const metaOnly = await this.metaChunks(file.path, file.size)
    if (container.entries.length === 0 && container.errors.length > 0) {
      await this.store.upsert({ ...base, error: container.errors[0].message }, metaOnly)
      return 'error'
    }
    await this.store.upsert(base, metaOnly)

    for (const entry of container.entries.slice(0, MAX_CONTAINER_ENTRIES)) {
      if (isIgnoredFile(entry.name)) continue
      const ext = extOf(entry.name)
      const vpath = makeVPath(file.path, entry.name)
      let data: Buffer
      try {
        // No se descomprime lo que solo se conocerá por su nombre.
        data = contentReadLimit(kindOf(ext), ext, entry.size ?? 0) === null ? Buffer.alloc(0) : await entry.read()
      } catch (error) {
        await this.store.upsert(
          { ...base, path: vpath, ext, size: entry.size ?? 0, container: file.path, hash: `unreadable:${hash}:${entry.name}`, error: messageOf(error), resurrected: true },
          await this.metaChunks(vpath, entry.size ?? 0)
        )
        continue
      }
      await this.processDocument({
        path: vpath,
        name: entry.name,
        size: entry.size ?? data.length,
        mtime: entry.mtime ?? file.mtime,
        atime: file.atime,
        born: entry.mtime ?? file.born,
        hash: data.length > 0 ? sha256(data) : `entry:${hash}:${entry.name}:${entry.size ?? 0}`,
        read: async () => data,
        container: file.path,
        recovered: container.recovered
      })
    }
    return 'indexed'
  }

  /** Fragmento de metadatos de un archivo, ya con su vector. */
  private async metaChunks(path: string, size: number): Promise<Chunk[]> {
    const text = buildMetaText(path, size)
    try {
      const [embedding] = await this.embedder.embed([text])
      return [{ ord: 0, text, embedding, meta: true }]
    } catch (error) {
      if (isFatal(error)) throw new FatalIndexError(messageOf(error), { cause: error })
      return []
    }
  }

  private async processDocument(args: {
    path: string
    name: string
    size: number
    mtime: number
    atime: number
    born: number
    hash: string
    /** Lee el contenido; `max` limita cuántos bytes se necesitan. */
    read: (max?: number) => Promise<Buffer>
    container?: string
    /** El contenedor estaba dañado y se rescató. */
    recovered?: boolean
  }): Promise<Outcome> {
    const ext = extOf(args.name)
    const kind = kindOf(ext)
    const base: IndexedDoc = {
      path: args.path,
      hash: args.hash,
      size: args.size,
      mtime: args.mtime,
      atime: args.atime,
      born: Math.min(args.born, args.mtime),
      ext,
      container: args.container
    }

    // 1. Contenido, si se sabe leer este tipo. Todo lo demás se conoce por nombre, carpeta y tipo.
    let result: ExtractResult | undefined
    let error: string | undefined
    let name = args.name
    let limit = contentReadLimit(kind, ext, args.size)
    let head: Buffer | undefined
    if (limit === null && kind === 'other' && args.size > 0 && args.size <= READ_LIMIT_TEXT) {
      head = await args.read(READ_LIMIT_TEXT).catch(() => undefined)
      if (head && looksLikeText(head.subarray(0, 4096))) {
        name = `${args.name}.txt` // texto sin extensión conocida
        limit = READ_LIMIT_CODE
      }
    }
    if (limit !== null) {
      try {
        result = await this.extract({ name, read: async () => head ?? (await args.read(limit)) }, {})
      } catch (e) {
        // Un archivo ilegible se registra, sin dejar de poder encontrarse por su nombre (R3.6).
        error = messageOf(e)
      }
    }

    // 2. Fragmentos: metadatos primero y luego el contenido, con un tope según el tipo.
    const metaText = buildMetaText(args.path, args.size)
    const pieces = result ? chunkText(result.text, { maxChunks: MAX_CONTENT_CHUNKS[kind], ...this.chunking }) : []
    let vectors: Float32Array[]
    try {
      vectors = await this.embedder.embed([metaText, ...pieces])
    } catch (e) {
      if (isFatal(e)) throw new FatalIndexError(messageOf(e), { cause: e })
      await this.store.upsert({ ...base, error: `No se pudo calcular el significado: ${messageOf(e)}` }, [])
      return 'error'
    }
    const chunks: Chunk[] = [{ ord: 0, text: metaText, embedding: vectors[0], meta: true }, ...pieces.map((text, i) => ({ ord: i + 1, text, embedding: vectors[i + 1] }))]

    let summary: string | undefined
    if (result) {
      try {
        summary = await this.summarizer?.summarize(result.text)
      } catch (e) {
        if (isFatal(e)) throw new FatalIndexError(messageOf(e), { cause: e })
        summary = undefined // el resumen es opcional
      }
    }

    const recovered = args.recovered === true
    await this.store.upsert(
      {
        ...base,
        summary,
        error,
        resurrected: result ? result.resurrected || recovered : recovered || undefined,
        confidence: result ? (recovered ? capConfidence(result.confidence, 'medium') : result.confidence) : undefined
      },
      chunks
    )
    return error ? 'error' : 'indexed'
  }
}
