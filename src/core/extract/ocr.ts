import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ExtractError } from './types'

const execFileAsync = promisify(execFile)

const OCR_TIMEOUT_MS = 120_000
const MAX_PDF_PAGES = 30
const PREFERRED_LANGS = ['spa', 'eng']

interface TesseractInfo {
  langs: string
  /** Idiomas preferidos que faltan en la instalación. */
  missing: string[]
}

let tesseractCache: Promise<TesseractInfo | null> | undefined
let pdftoppmCache: Promise<boolean> | undefined

export function findTesseract(): Promise<TesseractInfo | null> {
  tesseractCache ??= (async () => {
    try {
      const { stdout } = await execFileAsync('tesseract', ['--list-langs'], { timeout: 15_000 })
      const available = new Set(stdout.split(/\r?\n/).map((l) => l.trim()))
      const chosen = PREFERRED_LANGS.filter((l) => available.has(l))
      if (chosen.length === 0) return null
      return { langs: chosen.join('+'), missing: PREFERRED_LANGS.filter((l) => !available.has(l)) }
    } catch {
      return null
    }
  })()
  return tesseractCache
}

function hasPdftoppm(): Promise<boolean> {
  pdftoppmCache ??= execFileAsync('pdftoppm', ['-v'], { timeout: 10_000 }).then(
    () => true,
    (e: NodeJS.ErrnoException) => e.code !== 'ENOENT'
  )
  return pdftoppmCache
}

async function recognize(imagePath: string, langs: string): Promise<string> {
  const { stdout } = await execFileAsync('tesseract', [imagePath, 'stdout', '-l', langs], {
    timeout: OCR_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    // Un hilo por proceso: así se pueden leer varias imágenes a la vez sin que compitan entre sí.
    env: { ...process.env, OMP_THREAD_LIMIT: '1' }
  })
  return stdout
}

export interface OcrOutput {
  text: string
  warnings: string[]
}

/** OCR de un PDF escaneado. Requiere Tesseract y `pdftoppm` (Poppler) instalados. */
export async function ocrPdf(pdf: Buffer): Promise<OcrOutput> {
  const tess = await findTesseract()
  if (!tess) throw new ExtractError('El PDF no tiene texto y Tesseract no está disponible para aplicar OCR')
  if (!(await hasPdftoppm())) {
    throw new ExtractError('El PDF no tiene texto y falta `pdftoppm` (Poppler) para aplicar OCR')
  }

  const dir = await mkdtemp(join(tmpdir(), 'ouija-ocr-'))
  try {
    await writeFile(join(dir, 'in.pdf'), pdf)
    await execFileAsync('pdftoppm', ['-r', '200', '-l', String(MAX_PDF_PAGES), '-png', join(dir, 'in.pdf'), join(dir, 'page')], {
      timeout: OCR_TIMEOUT_MS
    })
    const pages = (await readdir(dir)).filter((f) => f.startsWith('page') && f.endsWith('.png')).sort()
    const texts: string[] = []
    for (const page of pages) texts.push(await recognize(join(dir, page), tess.langs))

    const warnings: string[] = []
    if (tess.missing.length > 0) warnings.push(`Tesseract sin idioma: ${tess.missing.join(', ')}. La precisión puede bajar.`)
    return { text: texts.join('\n\n'), warnings }
  } catch (error) {
    if (error instanceof ExtractError) throw error
    throw new ExtractError(`Falló el OCR: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const OCR_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff', 'gif', 'webp'])
export const canOcr = (ext: string): boolean => OCR_IMAGE_EXTENSIONS.has(ext)

/**
 * Texto dentro de una imagen (logos, capturas, documentos fotografiados). Devuelve `''` si no hay
 * Tesseract o no se reconoce texto con sentido: en una foto cualquiera el OCR inventa letras, así que
 * se descarta lo que no parece lenguaje.
 */
export async function ocrImage(data: Buffer, ext: string): Promise<OcrOutput> {
  const tess = await findTesseract()
  if (!tess || !canOcr(ext)) return { text: '', warnings: [] }

  const dir = await mkdtemp(join(tmpdir(), 'ouija-ocr-'))
  try {
    const file = join(dir, `in.${ext}`)
    await writeFile(file, data)
    const text = (await recognize(file, tess.langs)).replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
    return { text: looksLikeLanguage(text) ? text : '', warnings: tess.missing.length > 0 ? [`Tesseract sin idioma: ${tess.missing.join(', ')}`] : [] }
  } catch {
    return { text: '', warnings: [] } // formato que Tesseract no lee: no es un error del archivo
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Palabras de al menos 3 letras, mayoría de caracteres alfabéticos y sin ruido de símbolos. */
export function looksLikeLanguage(text: string): boolean {
  if (text.length < 4) return false
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  const visible = text.replace(/\s/g, '').length
  if (visible === 0 || letters / visible < 0.7) return false
  const words = text.match(/\p{L}{3,}/gu) ?? []
  return words.length >= 1 && words.join('').length / Math.max(letters, 1) >= 0.5
}
