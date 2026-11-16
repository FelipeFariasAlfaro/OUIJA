import type { Confidence } from '../memory/types'

export type ExtractMethod = 'text' | 'rtf' | 'docx' | 'pdf' | 'ocr' | 'legacy' | 'carve' | 'office'

export interface ExtractResult {
  text: string
  confidence: Confidence
  /** `true` si el texto se recuperó de un formato antiguo, dañado o con codificación corrupta. */
  resurrected: boolean
  method: ExtractMethod
  /** Programa antiguo que guardó el archivo, si se reconoce (para la Cripta y las "voces"). */
  origin?: 'msn' | 'mbox' | 'outlook-express'
  warnings: string[]
}

export interface ExtractInput {
  /** Nombre del archivo (para deducir la extensión). */
  name: string
  /** Entrega el contenido. No se escribe nunca sobre el origen. */
  read(): Promise<Buffer>
}

export class ExtractError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExtractError'
  }
}
