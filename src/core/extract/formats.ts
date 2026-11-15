import { bufferSource, readZip } from '../media'
import { decodeBest } from './encoding'
import { ExtractError } from './types'

const MAX_TEXT_CHARS = 2_000_000
const MAX_SHEET_ROWS = 20_000

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);/g, (_, e: string) => {
    switch (e) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      case 'nbsp':
        return ' '
      default: {
        const code = e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
      }
    }
  })
}

const BLOCK = /<\/?(?:p|div|br|li|ul|ol|tr|table|h[1-6]|section|article|header|footer|blockquote|pre|hr|title)\b[^>]*>/gi

/** Texto visible de un HTML: sin scripts, estilos ni etiquetas. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(BLOCK, '\n')
      .replace(/<td\b[^>]*>/gi, '\t')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n[\s]*/g, '\n')
    .trim()
}

/** Texto de un SVG: etiquetas `<text>`, `<title>` y `<desc>`. */
export function svgToText(svg: string): string {
  const parts: string[] = []
  for (const m of svg.matchAll(/<(text|title|desc|tspan)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim()
    if (t) parts.push(t)
  }
  return [...new Set(parts)].join('\n')
}

async function entriesOf(buf: Buffer) {
  const container = await readZip(bufferSource(buf))
  if (container.entries.length === 0) throw new ExtractError('El archivo no es un contenedor válido')
  return container.entries
}

const readUtf8 = async (e: { read(): Promise<Buffer> }) => (await e.read()).toString('utf8')

/** OpenDocument (odt, ods, odp): texto de `content.xml`. */
export async function odfToText(buf: Buffer): Promise<string> {
  const entry = (await entriesOf(buf)).find((e) => e.name === 'content.xml')
  if (!entry) throw new ExtractError('No es un documento OpenDocument válido')
  const xml = await readUtf8(entry)
  return decodeEntities(
    xml
      .replace(/<\/text:(p|h)>|<text:line-break\s*\/>/g, '\n')
      .replace(/<text:tab\s*\/>|<\/table:table-cell>/g, '\t')
      .replace(/<\/table:table-row>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Libro de Excel (xlsx): nombres de hoja y valores de las celdas, fila por fila. */
export async function xlsxToText(buf: Buffer): Promise<string> {
  const entries = await entriesOf(buf)
  const get = (name: string) => entries.find((e) => e.name === name)

  const shared: string[] = []
  const ss = get('xl/sharedStrings.xml')
  if (ss) {
    for (const si of (await readUtf8(ss)).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      shared.push(decodeEntities([...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
    }
  }

  const wb = get('xl/workbook.xml')
  const sheetNames = wb ? [...(await readUtf8(wb)).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeEntities(m[1])) : []

  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(a.name.match(/\d+/)?.[0]) - Number(b.name.match(/\d+/)?.[0]))

  const out: string[] = []
  let rows = 0
  for (const [i, sheet] of sheets.entries()) {
    out.push(`# ${sheetNames[i] ?? `Hoja ${i + 1}`}`)
    for (const row of (await readUtf8(sheet)).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (++rows > MAX_SHEET_ROWS) break
      const cells: string[] = []
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = c[1].match(/\bt="([^"]*)"/)?.[1]
        const inner = c[2] ?? ''
        const value =
          type === 's'
            ? (shared[Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1])] ?? '')
            : type === 'inlineStr'
              ? decodeEntities([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
              : decodeEntities(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
        if (value) cells.push(value)
      }
      if (cells.length > 0) out.push(cells.join('\t'))
    }
    if (rows > MAX_SHEET_ROWS) break
  }
  return out.join('\n')
}

/** Presentación de PowerPoint (pptx): texto de cada diapositiva. */
export async function pptxToText(buf: Buffer): Promise<string> {
  const slides = (await entriesOf(buf))
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(a.name.match(/\d+/)?.[0]) - Number(b.name.match(/\d+/)?.[0]))
  const out: string[] = []
  for (const [i, slide] of slides.entries()) {
    const xml = await readUtf8(slide)
    const text = decodeEntities(
      xml
        .replace(/<\/a:p>/g, '\n')
        .replace(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<[^>]+>/g, (_, t: string | undefined) => t ?? '')
    ).trim()
    if (text) out.push(`Diapositiva ${i + 1}\n${text}`)
  }
  return out.join('\n\n')
}

/** Libro electrónico (epub): texto de sus capítulos. */
export async function epubToText(buf: Buffer): Promise<string> {
  const chapters = (await entriesOf(buf)).filter((e) => /\.(x?html?)$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))
  const out: string[] = []
  let size = 0
  for (const chapter of chapters) {
    const text = htmlToText(await readUtf8(chapter))
    if (!text) continue
    out.push(text)
    size += text.length
    if (size > MAX_TEXT_CHARS) break
  }
  return out.join('\n\n')
}

// --- Correo (.eml) -------------------------------------------------------

function decodeTransfer(body: string, encoding: string, charset: string): string {
  const enc = encoding.toLowerCase()
  let bytes: Buffer
  if (enc === 'base64') bytes = Buffer.from(body.replace(/\s+/g, ''), 'base64')
  else if (enc === 'quoted-printable') {
    const joined = body.replace(/=\r?\n/g, '')
    bytes = Buffer.from(joined.replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16))), 'latin1')
  } else bytes = Buffer.from(body, 'latin1')
  const cs = charset.toLowerCase()
  return /utf-?8/.test(cs) || enc === '7bit' || enc === '' ? decodeBest(bytes).text : bytes.toString('latin1')
}

function splitHeaders(raw: string): { headers: Map<string, string>; body: string } {
  const at = raw.search(/\r?\n\r?\n/)
  const head = at < 0 ? raw : raw.slice(0, at)
  const body = at < 0 ? '' : raw.slice(at).replace(/^\r?\n\r?\n/, '')
  const headers = new Map<string, string>()
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) headers.set(line.slice(0, i).toLowerCase(), line.slice(i + 1).trim())
  }
  return { headers, body }
}

function decodeMimeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs: string, enc: string, text: string) =>
    enc.toLowerCase() === 'b' ? decodeTransfer(text, 'base64', cs) : decodeTransfer(text.replace(/_/g, ' '), 'quoted-printable', cs)
  )
}

function bodyText(raw: string, depth = 0): string {
  const { headers, body } = splitHeaders(raw)
  const type = headers.get('content-type') ?? 'text/plain'
  const encoding = headers.get('content-transfer-encoding') ?? ''
  const charset = type.match(/charset="?([^";\s]+)/i)?.[1] ?? 'utf-8'
  const boundary = type.match(/boundary="?([^";\s]+)"?/i)?.[1]
  if (/multipart\//i.test(type) && boundary && depth < 4) {
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith('--'))
    const texts = parts.map((p) => ({ type: splitHeaders(p.replace(/^\r?\n/, '')).headers.get('content-type') ?? '', text: bodyText(p.replace(/^\r?\n/, ''), depth + 1) }))
    return (texts.find((t) => /text\/plain/i.test(t.type)) ?? texts.find((t) => /text\/html|multipart/i.test(t.type)) ?? texts[0])?.text ?? ''
  }
  const decoded = decodeTransfer(body, encoding, charset)
  return /text\/html/i.test(type) ? htmlToText(decoded) : decoded
}

/** Correo (.eml): asunto, remitente, destinatario, fecha y cuerpo. */
export function emlToText(buf: Buffer): string {
  const raw = buf.toString('latin1')
  const { headers } = splitHeaders(raw)
  const lines = ['subject', 'from', 'to', 'cc', 'date']
    .map((h) => (headers.has(h) ? `${h[0].toUpperCase()}${h.slice(1)}: ${decodeMimeWords(headers.get(h) as string)}` : ''))
    .filter(Boolean)
  return `${lines.join('\n')}\n\n${bodyText(raw).trim()}`.trim()
}
