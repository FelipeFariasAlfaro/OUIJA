import { EXTENSIONS_BY_KIND } from '@shared/filetypes'
import { OllamaError } from '../ai/ollama'
import { canOcr, ocrImage } from '../extract/ocr'
import { readFileQuiet } from '../fsQuiet'
import type { MemoryStore } from '../memory'
import { chunkText } from './chunker'
import { buildMetaText } from './meta'
import { FatalIndexError, type Embedder } from './types'

/** Solo se lee el texto de imágenes pequeñas: logos, capturas, documentos escaneados. Las fotos grandes no. */
export const OCR_MAX_BYTES = 1.5 * 1024 * 1024
const MAX_OCR_CHUNKS = 2
const CONCURRENCY = 3

export interface ImageReadProgress {
  processed: number
  total: number
  current?: string
  found: number
}

export interface ImageReadOptions {
  signal?: AbortSignal
  onProgress?: (progress: ImageReadProgress) => void
}

export type OcrFn = (data: Buffer, ext: string) => Promise<{ text: string }>

/**
 * Segunda pasada, en segundo plano: lee el texto que hay dentro de las imágenes pequeñas y lo suma a
 * su entrada del índice. Así los archivos ya se pueden buscar por nombre desde el primer minuto y
 * el OCR (lento) se hace después, varias imágenes a la vez, y se puede interrumpir y retomar.
 */
export class ImageReader {
  constructor(
    private readonly store: MemoryStore,
    private readonly embedder: Embedder,
    private readonly ocr: OcrFn = ocrImage
  ) {}

  async run(options: ImageReadOptions = {}): Promise<{ processed: number; found: number }> {
    const extensions = EXTENSIONS_BY_KIND.image.filter(canOcr)
    const docs = await this.store.pendingOcrDocs(extensions, OCR_MAX_BYTES)
    const progress: ImageReadProgress = { processed: 0, total: docs.length, found: 0 }
    options.onProgress?.({ ...progress })

    let next = 0
    let fatal: unknown
    const worker = async (): Promise<void> => {
      while (!fatal && !options.signal?.aborted) {
        const doc = docs[next++]
        if (!doc) return
        try {
          if (await this.readOne(doc.path, doc.hash, doc.ext, doc.size)) progress.found++
        } catch (error) {
          if (error instanceof OllamaError && error.fatal) fatal = new FatalIndexError(error.message, { cause: error })
          // cualquier otro fallo: la imagen queda pendiente para la próxima vez
        }
        progress.processed++
        progress.current = doc.path
        options.onProgress?.({ ...progress })
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    if (fatal) throw fatal
    return { processed: progress.processed, found: progress.found }
  }

  /** `true` si se encontró texto. */
  private async readOne(path: string, hash: string, ext: string, size: number): Promise<boolean> {
    const data = await readFileQuiet(path, OCR_MAX_BYTES)
    const { text } = await this.ocr(data, ext)

    // El archivo pudo cambiar mientras se leía: en ese caso lo manejará la próxima indexación.
    const current = await this.store.getDoc(path)
    if (!current || current.hash !== hash) return false

    if (text) {
      const pieces = chunkText(text, { maxChunks: MAX_OCR_CHUNKS })
      const meta = buildMetaText(path, size)
      const vectors = await this.embedder.embed([meta, ...pieces])
      await this.store.upsert({ ...current, confidence: 'low' }, [
        { ord: 0, text: meta, embedding: vectors[0], meta: true },
        ...pieces.map((t, i) => ({ ord: i + 1, text: t, embedding: vectors[i + 1] }))
      ])
    }
    await this.store.markOcrDone(path)
    return text.length > 0
  }
}
