/** Tipos compartidos entre el proceso principal y la interfaz. Solo datos serializables. */

export type Confidence = 'high' | 'medium' | 'low'

export type { Lang } from './langs'

/** Coincidencia mostrada en la paleta. */
export interface Match {
  id: string
  name: string
  /** Ruta real o virtual (`contenedor::ruta`). */
  path: string
  /** Ruta del contenedor si el archivo vive dentro de uno. */
  container?: string
  /** Fragmento del contenido. Vacío si el archivo solo se conoce por su nombre y tipo. */
  snippet: string
  mtime: number
  size: number
  ext: string
  resurrected?: boolean
  confidence?: Confidence
  /** Persona, lugar o proyecto nombrado en la pregunta por el que llegó este archivo. */
  viaEntity?: string
}

export interface SearchAnswer {
  answer: string
  matches: Match[]
  found: boolean
  /** `light` = sin modelo de lenguaje. */
  mode: 'full' | 'light'
  warnings: string[]
  /** El servicio externo falló y se respondió en modo ligero. */
  aiProblem?: import('./ai').AiErrorCode
}

export type GhostKind = 'stale' | 'duplicate' | 'version'

export interface RelatedFile {
  name: string
  path: string
}

/** Archivo fantasma con los datos de su necrológica. Todo viene del índice. */
export interface Ghost {
  id: string
  name: string
  path: string
  container?: string
  kind: GhostKind
  born?: number
  lastUsed: number
  summary?: string
  people: string[]
  topics: string[]
  related: RelatedFile[]
  resurrected?: boolean
  confidence?: Confidence
  /** Copias exactas o versiones casi idénticas del mismo documento. */
  group?: { kind: 'duplicate' | 'version'; count: number; keeper: RelatedFile }
}

export interface PersonFile {
  name: string
  path: string
  mtime: number
  snippet?: string
}

export interface PersonSummary {
  id: string
  name: string
  aliases: string[]
  fileCount: number
}

export interface Person extends PersonSummary {
  /** Del más antiguo al más reciente. */
  files: PersonFile[]
}
