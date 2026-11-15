import { extractText, getDocumentProxy } from 'unpdf'
import { ocrPdf } from './ocr'
import { ExtractError, type ExtractResult } from './types'

const MIN_TEXT_CHARS = 20

export async function extractPdf(buf: Buffer): Promise<ExtractResult> {
  let text: string
  try {
    // pdf.js toma posesión del buffer: se le entrega una copia.
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    text = (await extractText(pdf, { mergePages: true })).text
  } catch (error) {
    throw new ExtractError(`PDF ilegible: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }

  if (text.replace(/\s/g, '').length >= MIN_TEXT_CHARS) {
    return { text, confidence: 'high', resurrected: false, method: 'pdf', warnings: [] }
  }

  // Sin capa de texto: probablemente escaneado.
  const ocr = await ocrPdf(buf)
  return { text: ocr.text, confidence: 'medium', resurrected: true, method: 'ocr', warnings: ocr.warnings }
}
