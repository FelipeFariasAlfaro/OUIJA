/** Genera vectores para textos. Implementación local: Ollama. */
export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>
}

/** Resume un documento en una o dos frases. Opcional. */
export interface Summarizer {
  summarize(text: string): Promise<string | undefined>
}

export interface ScannedFile {
  path: string
  size: number
  /** ms desde epoch */
  mtime: number
  atime: number
  /** Primer registro conocido: la fecha más antigua entre creación y modificación. */
  born: number
  /** minúscula, sin punto */
  ext: string
}

export interface IndexProgress {
  phase: 'scanning' | 'indexing' | 'done'
  processed: number
  total: number
  current?: string
  indexed: number
  skipped: number
  errors: number
}

export interface IndexReport {
  scanned: number
  indexed: number
  skipped: number
  errors: number
  removed: number
}

/** Fallo de infraestructura (por ejemplo, Ollama caído): detiene la indexación en vez de marcar archivos como erróneos. */
export class FatalIndexError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FatalIndexError'
  }
}

export type ChangeKind = 'added' | 'modified' | 'removed'

export interface ChangeInput {
  kind: ChangeKind
  path: string
  name: string
  ext: string
  size: number
  /** De qué trataba el archivo (se guarda al eliminarlo, cuando ya no se puede consultar). */
  summary?: string
  ts?: number
}

/** Dónde se anotan los cambios que detecta la indexación. */
export interface ChangeSink {
  record(change: ChangeInput): void
}
