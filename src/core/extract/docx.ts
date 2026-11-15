import { bufferSource, readZip } from '../media'
import { ExtractError } from './types'

const TOKEN = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
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
      default: {
        const code = e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : ''
      }
    }
  })
}

export function wordXmlToText(xml: string): string {
  const out: string[] = []
  for (const m of xml.matchAll(TOKEN)) {
    const token = m[0]
    if (m[1] !== undefined) out.push(decodeEntities(m[1]))
    else if (token.startsWith('</w:p')) out.push('\n')
    else if (token.startsWith('<w:tab')) out.push('\t')
    else out.push('\n')
  }
  return out.join('')
}

export async function docxToText(buf: Buffer): Promise<string> {
  const container = await readZip(bufferSource(buf))
  const doc = container.entries.find((e) => e.name === 'word/document.xml')
  if (!doc) throw new ExtractError('No es un DOCX válido: falta word/document.xml')
  const xml = (await doc.read()).toString('utf8')
  const parts = [wordXmlToText(xml)]
  for (const name of ['word/footnotes.xml', 'word/endnotes.xml']) {
    const extra = container.entries.find((e) => e.name === name)
    if (extra) parts.push(wordXmlToText((await extra.read()).toString('utf8')))
  }
  return parts.join('\n')
}

/** `true` si el contenido es un ZIP con un documento de Word dentro. */
export async function looksLikeDocx(buf: Buffer): Promise<boolean> {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return false
  const container = await readZip(bufferSource(buf))
  return container.entries.some((e) => e.name === 'word/document.xml')
}
