import { carveText } from './carve'
import { emlToText } from './formats'

/**
 * "Voces": conversaciones y correos guardados por programas que ya no existen.
 * - MSN / Windows Live Messenger (1999–2014) guardaba el historial en XML (`<Log><Message>…`).
 * - Outlook Express (1996–2006) guardaba cada carpeta en un `.dbx` binario sin documentación pública.
 * - `.mbox`: buzón de correo en un solo archivo (Eudora, Netscape, Thunderbird antiguo).
 * Todo es de solo lectura.
 */

const decodeXml = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

const attr = (tag: string, name: string): string | undefined => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))
  return m ? decodeXml(m[1]) : undefined
}

/** ¿Es un historial de MSN Messenger? Mira solo el comienzo del archivo. */
export function looksLikeMsnLog(head: string): boolean {
  return /<Log\b[^>]*>/i.test(head) && /<Message\b/i.test(head) && /FriendlyName=/i.test(head)
}

/** Historial de MSN Messenger → "[2006-03-13 01:15] Rosa → Felipe: hola", un mensaje por línea. */
export function msnLogToText(xml: string): string {
  const lines: string[] = []
  const users = new Set<string>()
  for (const m of xml.matchAll(/<Message\b([^>]*)>([\s\S]*?)<\/Message>/gi)) {
    const open = m[1]
    const body = m[2]
    const when = attr(`<x ${open}>`, 'DateTime')?.replace('T', ' ').slice(0, 16) ?? [attr(`<x ${open}>`, 'Date'), attr(`<x ${open}>`, 'Time')].filter(Boolean).join(' ')
    const from = body.match(/<From>[\s\S]*?<User\b([^>]*)\/?>/i)
    const to = body.match(/<To>[\s\S]*?<User\b([^>]*)\/?>/i)
    const fromName = from ? attr(`<x ${from[1]}>`, 'FriendlyName') : undefined
    const toName = to ? attr(`<x ${to[1]}>`, 'FriendlyName') : undefined
    const text = decodeXml((body.match(/<Text\b[^>]*>([\s\S]*?)<\/Text>/i)?.[1] ?? '').replace(/<[^>]+>/g, '')).trim()
    if (!text) continue
    if (fromName) users.add(fromName)
    if (toName) users.add(toName)
    lines.push(`[${when}] ${fromName ?? '?'}${toName ? ` → ${toName}` : ''}: ${text}`)
  }
  if (lines.length === 0) return ''
  return `Conversación de MSN Messenger entre ${[...users].join(', ')}\n\n${lines.join('\n')}`
}

/** Un buzón `.mbox`: cada mensaje empieza con una línea "From " al inicio de línea. */
export function mboxToText(buf: Buffer, maxMessages = 400): string {
  const raw = buf.toString('latin1')
  const parts = raw.split(/^From [^\n]*\n/m).filter((p) => p.trim())
  return parts
    .slice(0, maxMessages)
    .map((p) => emlToText(Buffer.from(p, 'latin1')))
    .filter(Boolean)
    .join('\n\n———\n\n')
}

/** Firma de los archivos de Outlook Express (`CF AD 12 FE`). */
export function looksLikeDbx(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0xcf && buf[1] === 0xad && buf[2] === 0x12 && buf[3] === 0xfe
}

/**
 * Outlook Express `.dbx`: el formato nunca se publicó. Los mensajes están guardados en texto dentro
 * de bloques binarios, así que se rescatan como en un archivo dañado: se extraen las cadenas legibles.
 */
export function dbxToText(buf: Buffer): { text: string; confidence: 'high' | 'medium' | 'low' } | null {
  const carved = carveText(buf)
  if (!carved) return null
  return { text: carved.text, confidence: carved.confidence === 'high' ? 'medium' : carved.confidence }
}
