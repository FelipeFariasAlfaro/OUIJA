import type { Confidence } from '../memory/types'
import { CP437, CP850, decodeWithTable } from './codepages'

export interface DecodedText {
  text: string
  encoding: string
  confidence: Confidence
  /** Se corrigió texto con codificación doble (mojibake). */
  repaired: boolean
  /** La codificación es una página de códigos DOS antigua. */
  legacy: boolean
}

/** Palabras muy comunes en español e inglés, para puntuar si un texto "tiene sentido". */
const COMMON_WORDS = new Set(
  (
    'de la que el en y a los se del las un por con para una su al lo como más pero sus le ya o este sí si porque esta ' +
    'entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante es son fue ser no te mi ' +
    'tus tu yo él ella nosotros poema carta contrato ' +
    'the of and to in is that for it as was with be by on not he this are or his from at which but have an had ' +
    'they you were their one all we can her has there been if more when will would who so no'
  ).split(' ')
)

// eslint-disable-next-line no-control-regex
const WEIRD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u0080-\u009f\ufffd\u2190-\u23ff\u2500-\u259f\u0370-\u03ff\u00a4\u00a6\u00a8\u00ac\u00af\u00b4\u00b8]/g

/** Un símbolo entre dos letras ("d¡a", "Concepci¢n") delata una página de códigos equivocada. */
const SYMBOL_IN_WORD = /\p{L}[\u00a1-\u00a9\u00ab-\u00b4\u00b6-\u00b9\u00bb-\u00bf\u00d7\u00f7]\p{L}/gu

export function scoreText(text: string): { hitRatio: number; weirdRatio: number; score: number } {
  if (text.length === 0) return { hitRatio: 0, weirdRatio: 0, score: 0 }
  const tokens = text.toLowerCase().match(/\p{L}+/gu) ?? []
  let hits = 0
  for (const t of tokens) if (COMMON_WORDS.has(t)) hits++
  const hitRatio = tokens.length === 0 ? 0 : hits / tokens.length
  const weird = (text.match(WEIRD)?.length ?? 0) + 3 * (text.match(SYMBOL_IN_WORD)?.length ?? 0)
  const weirdRatio = weird / text.length
  return { hitRatio, weirdRatio, score: hitRatio - 2 * weirdRatio }
}

const SAMPLE_BYTES = 64 * 1024

function utf8Strict(buf: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf)
  } catch {
    return null
  }
}

function swapBytes(buf: Buffer): Buffer {
  const out = Buffer.from(buf)
  out.swap16()
  return out
}

function utf16Orientation(buf: Buffer): 'le' | 'be' | null {
  const n = Math.min(buf.length, 4096) & ~1
  if (n < 8) return null
  let zeroOdd = 0
  let zeroEven = 0
  for (let i = 0; i < n; i += 2) {
    if (buf[i] === 0) zeroEven++
    if (buf[i + 1] === 0) zeroOdd++
  }
  const half = n / 2
  if (zeroOdd / half > 0.3 && zeroEven / half < 0.05) return 'le'
  if (zeroEven / half > 0.3 && zeroOdd / half < 0.05) return 'be'
  return null
}

export function decodeBest(input: Buffer): DecodedText {
  let buf = input
  if (buf.length === 0) return { text: '', encoding: 'ascii', confidence: 'high', repaired: false, legacy: false }

  // BOM y UTF-16.
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3)
  else if (buf[0] === 0xff && buf[1] === 0xfe) {
    return done(buf.subarray(2).toString('utf16le'), 'utf-16le', 'high')
  } else if (buf[0] === 0xfe && buf[1] === 0xff) {
    return done(swapBytes(buf.subarray(2, 2 + ((buf.length - 2) & ~1))).toString('utf16le'), 'utf-16be', 'high')
  } else {
    const orientation = utf16Orientation(buf)
    if (orientation === 'le') return done(buf.toString('utf16le'), 'utf-16le', 'medium')
    if (orientation === 'be') return done(swapBytes(buf.subarray(0, buf.length & ~1)).toString('utf16le'), 'utf-16be', 'medium')
  }

  const utf8 = utf8Strict(buf)
  if (utf8 !== null) {
    const fixed = repairMojibake(utf8)
    if (fixed !== utf8) return { text: fixed, encoding: 'utf-8+mojibake', confidence: 'medium', repaired: true, legacy: false }
    return { text: utf8, encoding: 'utf-8', confidence: 'high', repaired: false, legacy: false }
  }

  // No es UTF-8 válido: probar páginas de códigos y elegir la que mejor puntúe.
  const sample = buf.subarray(0, SAMPLE_BYTES)
  const candidates: { name: string; legacy: boolean; decode: (b: Buffer) => string }[] = [
    { name: 'windows-1252', legacy: false, decode: (b) => new TextDecoder('windows-1252').decode(b) },
    { name: 'cp850', legacy: true, decode: (b) => decodeWithTable(b, CP850) },
    { name: 'cp437', legacy: true, decode: (b) => decodeWithTable(b, CP437) }
  ]
  let best = candidates[0]
  let bestScore = -Infinity
  let bestMetrics = { hitRatio: 0, weirdRatio: 0, score: 0 }
  for (const c of candidates) {
    const m = scoreText(c.decode(sample))
    if (m.score > bestScore + 1e-9) {
      best = c
      bestScore = m.score
      bestMetrics = m
    }
  }
  const confidence: Confidence =
    bestMetrics.hitRatio >= 0.15 && bestMetrics.weirdRatio < 0.01 ? 'high' : bestMetrics.hitRatio >= 0.05 ? 'medium' : 'low'
  return { text: best.decode(buf), encoding: best.name, confidence, repaired: false, legacy: best.legacy }

  function done(text: string, encoding: string, confidence: Confidence): DecodedText {
    return { text, encoding, confidence, repaired: false, legacy: false }
  }
}

// ---------------------------------------------------------------------------
// Reparación de mojibake: UTF-8 leído como Windows-1252 ("canciÃ³n" -> "canción").

const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ' // 0x80..0x9F
const CP1252_REVERSE = new Map<string, number>()
for (let i = 0; i < CP1252_HIGH.length; i++) CP1252_REVERSE.set(CP1252_HIGH[i], 0x80 + i)

const CONT = '[\\u0080-\\u00BF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]'
const MOJIBAKE_RUN = new RegExp(`[\\u00C2-\\u00DF]${CONT}|[\\u00E0-\\u00EF]${CONT}{2}|[\\u00F0-\\u00F4]${CONT}{3}`, 'g')

function runToUtf8(run: string): string | null {
  const bytes = Buffer.alloc(run.length)
  for (let i = 0; i < run.length; i++) {
    const ch = run[i]
    const code = run.charCodeAt(i)
    const byte = code < 256 ? code : CP1252_REVERSE.get(ch)
    if (byte === undefined) return null
    bytes[i] = byte
  }
  return utf8Strict(bytes)
}

/**
 * Repara secuencias UTF-8 que fueron decodificadas como Windows-1252. Solo cambia las secuencias
 * que forman UTF-8 válido. Es idempotente y deja intacto el texto correcto.
 */
export function repairMojibake(text: string): string {
  let current = text
  for (;;) {
    const next = current.replace(MOJIBAKE_RUN, (run) => runToUtf8(run) ?? run)
    if (next === current) return current
    current = next
  }
}
