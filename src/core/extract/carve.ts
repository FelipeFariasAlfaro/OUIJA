import type { Confidence } from '../memory/types'
import { CP437, CP850, decodeWithTable } from './codepages'
import { repairMojibake, scoreText } from './encoding'

export interface CarveResult {
  text: string
  confidence: Confidence
  encoding: string
}

const MIN_RUN = 4
const MIN_TOTAL_CHARS = 20
const MIN_HIT_RATIO = 0.05
const MAX_SCAN_BYTES = 64 * 1024 * 1024

const RUN = /[\p{L}\p{N} ,.;:!?¿¡()"'«»\-–—/%&$#@+=*_]{4,}/gu

function acceptableRun(run: string): boolean {
  const letters = run.match(/\p{L}/gu)?.length ?? 0
  if (letters / run.length < 0.55) return false
  const words = run.match(/\p{L}+/gu) ?? []
  if (words.length === 0) return false
  const avg = words.reduce((n, w) => n + w.length, 0) / words.length
  if (avg < 2) return false
  return words.some((w) => w.length >= 3 && /[aeiouáéíóúüyAEIOUÁÉÍÓÚÜY]/.test(w))
}

function extractRuns(decoded: string): string[] {
  const runs: string[] = []
  for (const m of decoded.matchAll(RUN)) {
    const run = m[0].trim()
    if (run.length >= MIN_RUN && acceptableRun(run) && runs[runs.length - 1] !== run) runs.push(run)
  }
  return runs
}

/**
 * Rescate forense: busca texto legible dentro de un binario que no se pudo convertir
 * (por ejemplo WordStar o un WordPerfect muy dañado). Prueba varias codificaciones y se queda
 * con la que produce más texto con sentido. Nunca devuelve confianza alta.
 */
export function carveText(input: Buffer): CarveResult | null {
  const buf = input.length > MAX_SCAN_BYTES ? input.subarray(0, MAX_SCAN_BYTES) : input

  const candidates: { name: string; decode: () => string }[] = [
    { name: 'utf-8', decode: () => new TextDecoder('utf-8').decode(buf) },
    { name: 'windows-1252', decode: () => new TextDecoder('windows-1252').decode(buf) },
    { name: 'cp850', decode: () => decodeWithTable(buf, CP850) },
    { name: 'cp437', decode: () => decodeWithTable(buf, CP437) },
    { name: 'utf-16le', decode: () => buf.toString('utf16le') },
    { name: 'utf-16le+1', decode: () => buf.subarray(1).toString('utf16le') }
  ]

  let best: { text: string; encoding: string; hitRatio: number; weight: number } | null = null
  for (const c of candidates) {
    const runs = extractRuns(c.decode())
    const text = repairMojibake(runs.join('\n'))
    if (text.length < MIN_TOTAL_CHARS) continue
    const { hitRatio, weirdRatio } = scoreText(text)
    if (hitRatio < MIN_HIT_RATIO) continue
    // Texto con letras acentuadas que forma UTF-8 válido: es casi imposible por azar en otras codificaciones.
    const utf8Bonus = c.name === 'utf-8' && /[^\x20-\x7e\n\t]/.test(text) && !text.includes('\ufffd') ? 2 : 1
    const weight = text.length * (hitRatio + 0.1) * (1 - Math.min(1, weirdRatio * 5)) * utf8Bonus
    if (!best || weight > best.weight) best = { text, encoding: c.name, hitRatio, weight }
  }
  if (!best) return null
  return {
    text: best.text,
    encoding: best.encoding,
    confidence: best.hitRatio >= 0.25 ? 'medium' : 'low'
  }
}
