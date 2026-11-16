export type Confidence = 'high' | 'medium' | 'low'

/** Metadatos de un archivo indexado. `path` puede ser virtual: `contenedor::ruta/interna`. */
export interface IndexedDoc {
  path: string
  hash: string
  size: number
  /** Milisegundos desde epoch. */
  mtime: number
  atime?: number
  /** Primer registro conocido del archivo (la fecha más antigua entre creación y modificación). */
  born?: number
  ext: string
  summary?: string
  container?: string
  confidence?: Confidence
  resurrected?: boolean
  error?: string
}

export interface Chunk {
  ord: number
  text: string
  embedding: Float32Array
  /** Fragmento de metadatos (nombre, carpeta, tipo): hace buscable al archivo, pero no es su contenido. */
  meta?: boolean
}

export interface FileFilter {
  /** Extensiones en minúscula, sin punto. */
  extensions?: string[]
  /** Extensiones que nunca deben aparecer (el usuario las dejó fuera de las búsquedas). */
  excludeExtensions?: string[]
  /** Prefijo de ruta. */
  folder?: string
  /** mtime mínimo (ms). */
  dateFrom?: number
  /** mtime máximo (ms). */
  dateTo?: number
}

export interface HybridQuery {
  /** Texto para la búsqueda léxica (FTS). */
  text?: string
  /** Vector para la búsqueda semántica. Debe tener la dimensión del almacén. */
  embedding?: Float32Array
  limit?: number
  filter?: FileFilter
}

export interface Hit {
  doc: IndexedDoc
  /** Puntaje de fusión (mayor es mejor). */
  score: number
  /** Fragmento más relevante del archivo. */
  snippet: string
  /** `meta` si el fragmento es solo nombre, carpeta y tipo (no hay contenido que mostrar). */
  snippetKind?: 'content' | 'meta'
  /**
   * Similitud coseno (0 a 1) del fragmento más cercano a la consulta. Solo si hubo búsqueda semántica
   * y los vectores están normalizados.
   */
  similarity?: number
  /** Alguna palabra de la consulta aparece literalmente en el archivo. */
  lexical: boolean
  /** El archivo llegó porque menciona a esta persona, lugar o proyecto nombrado en la pregunta. */
  viaEntity?: string
}
