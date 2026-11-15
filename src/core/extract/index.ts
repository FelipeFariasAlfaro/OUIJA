import { extname } from 'node:path'
import { EXTENSIONS_BY_KIND } from '@shared/filetypes'
import { carveText } from './carve'
import { docxToText, looksLikeDocx } from './docx'
import { decodeBest } from './encoding'
import { emlToText, epubToText, htmlToText, odfToText, pptxToText, svgToText, xlsxToText } from './formats'
import { convertLegacy } from './legacy'
import { canOcr, ocrImage } from './ocr'
import { extractPdf } from './pdf'
import { rtfToText } from './rtf'
import { ExtractError, type ExtractInput, type ExtractResult } from './types'

export { carveText } from './carve'
export { decodeBest, repairMojibake, scoreText } from './encoding'
export { htmlToText } from './formats'
export { rtfToText } from './rtf'
export { ExtractError } from './types'
export type { ExtractInput, ExtractMethod, ExtractResult } from './types'

/** Texto plano: se decodifica y listo (incluye código, configuración y datos). */
export const TEXT_EXTENSIONS: readonly string[] = [
  ...EXTENSIONS_BY_KIND.text,
  ...EXTENSIONS_BY_KIND.code,
  ...EXTENSIONS_BY_KIND.data,
  'csv',
  'tsv'
]
export const LEGACY_EXTENSIONS = ['doc', 'dot', 'wpd', 'wps', 'wri', 'ws', 'lwp', 'sdw'] as const
const SHEET_LEGACY = ['xls', 'xlsb']
const OFFICE_XML = ['docx', 'dotx', 'xlsx', 'xlsm', 'pptx', 'ppsx', 'odt', 'ods', 'odp', 'epub']
const OTHER = ['pdf', 'rtf', 'html', 'htm', 'xhtml', 'mhtml', 'svg', 'eml']

/** Extensiones de las que se extrae contenido (las demás se conocen solo por nombre y metadatos). */
export const SUPPORTED_EXTENSIONS: readonly string[] = [...new Set([...TEXT_EXTENSIONS, ...LEGACY_EXTENSIONS, ...SHEET_LEGACY, ...OFFICE_XML, ...OTHER])]

const MAX_TEXT_CHARS = 5_000_000

const TEXT = new Set<string>(TEXT_EXTENSIONS)
const LEGACY = new Set<string>(LEGACY_EXTENSIONS)
const SUPPORTED = new Set<string>(SUPPORTED_EXTENSIONS)

export function extensionOf(name: string): string {
  return extname(name).slice(1).toLowerCase()
}

/** ¿Se puede extraer texto? Las imágenes dependen de que se pida OCR. */
export function isSupportedExtension(ext: string, options: { ocr?: boolean } = {}): boolean {
  const e = ext.toLowerCase()
  return SUPPORTED.has(e) || (options.ocr === true && canOcr(e))
}

/** Normaliza saltos de línea, quita controles y recorta el texto excesivo. */
function normalize(text: string, warnings: string[]): string {
  let t = text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (t.length > MAX_TEXT_CHARS) {
    t = t.slice(0, MAX_TEXT_CHARS)
    warnings.push('Texto recortado por exceder el tamaño máximo')
  }
  return t
}

function finish(result: ExtractResult): ExtractResult {
  const warnings = [...result.warnings]
  const text = normalize(result.text, warnings)
  if (text.length === 0) throw new ExtractError('No se encontró texto en el archivo')
  return { ...result, text, warnings }
}

async function extractLegacy(ext: string, buf: Buffer): Promise<ExtractResult> {
  // Muchos ".doc" son en realidad RTF, DOCX o texto plano.
  if (buf.subarray(0, 5).toString('latin1') === '{\\rtf') {
    return { text: rtfToText(buf.toString('latin1')), confidence: 'high', resurrected: true, method: 'rtf', warnings: [] }
  }
  if (await looksLikeDocx(buf)) {
    return { text: await docxToText(buf), confidence: 'high', resurrected: true, method: 'docx', warnings: [] }
  }

  const warnings: string[] = []
  try {
    const text = await convertLegacy(ext, buf)
    if (text.trim().length > 0) return { text, confidence: 'high', resurrected: true, method: 'legacy', warnings }
    warnings.push('LibreOffice no devolvió texto; se usó rescate forense')
  } catch (error) {
    warnings.push(`${error instanceof Error ? error.message : String(error)}; se usó rescate forense`)
  }

  const carved = carveText(buf)
  if (!carved) throw new ExtractError('No se pudo recuperar texto legible del archivo')
  warnings.push(`Texto rescatado de los bytes del archivo (${carved.encoding}); puede estar incompleto`)
  return { text: carved.text, confidence: carved.confidence, resurrected: true, method: 'carve', warnings }
}

const ok = (text: string, method: ExtractResult['method'], confidence: ExtractResult['confidence'] = 'high'): ExtractResult => ({
  text,
  confidence,
  resurrected: false,
  method,
  warnings: []
})

export interface ExtractOptions {
  /** Leer el texto que hay dentro de las imágenes con Tesseract. */
  ocr?: boolean
}

/**
 * Extrae el texto de un archivo. Lanza `ExtractError` si no se puede; el llamador debe registrar
 * el error por archivo y continuar con el resto. No escribe nunca sobre el origen.
 */
export async function extractText(input: ExtractInput, options: ExtractOptions = {}): Promise<ExtractResult> {
  const ext = extensionOf(input.name)
  if (!isSupportedExtension(ext, options)) throw new ExtractError(`Formato no soportado: .${ext}`)

  const buf = await input.read()

  if (ext === 'svg') return finish(ok(svgToText(decodeBest(buf).text), 'text'))
  if (['html', 'htm', 'xhtml', 'mhtml'].includes(ext)) return finish(ok(htmlToText(decodeBest(buf).text), 'text'))
  if (TEXT.has(ext)) {
    const decoded = decodeBest(buf)
    const warnings = decoded.repaired ? ['Se corrigió texto con codificación dañada (mojibake)'] : []
    if (decoded.legacy) warnings.push(`Codificación antigua detectada: ${decoded.encoding}`)
    return finish({
      text: decoded.text,
      confidence: decoded.confidence,
      resurrected: decoded.repaired || decoded.legacy,
      method: 'text',
      warnings
    })
  }
  if (ext === 'rtf') return finish(ok(rtfToText(buf.toString('latin1')), 'rtf'))
  if (ext === 'docx' || ext === 'dotx') return finish(ok(await docxToText(buf), 'docx'))
  if (ext === 'xlsx' || ext === 'xlsm') return finish(ok(await xlsxToText(buf), 'office'))
  if (ext === 'pptx' || ext === 'ppsx') return finish(ok(await pptxToText(buf), 'office'))
  if (ext === 'odt' || ext === 'ods' || ext === 'odp') return finish(ok(await odfToText(buf), 'office'))
  if (ext === 'epub') return finish(ok(await epubToText(buf), 'office'))
  if (ext === 'eml') return finish(ok(emlToText(buf), 'text'))
  if (ext === 'pdf') return finish(await extractPdf(buf))
  if (SHEET_LEGACY.includes(ext)) {
    const csv = await convertLegacy(ext, buf, 'csv')
    return finish({ text: csv, confidence: 'high', resurrected: true, method: 'legacy', warnings: [] })
  }
  if (LEGACY.has(ext)) return finish(await extractLegacy(ext, buf))
  if (canOcr(ext)) {
    const r = await ocrImage(buf, ext)
    return finish({ text: r.text, confidence: 'low', resurrected: false, method: 'ocr', warnings: r.warnings })
  }

  throw new ExtractError(`Formato no soportado: .${ext}`)
}
