/** Detección de textos casi idénticos: shingles de palabras + MinHash + LSH. Todo en memoria y determinista. */

export const NUM_PERM = 128
const BANDS = 32
const ROWS = NUM_PERM / BANDS // 4

function fnv1a(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mix(h: number, seed: number): number {
  let x = (h ^ seed) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return x >>> 0
}

/** Generador pseudoaleatorio con semilla fija: las firmas son reproducibles entre ejecuciones. */
function seeds(n: number): Uint32Array {
  let a = 0x9e3779b9
  const out = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out[i] = (t ^ (t >>> 14)) >>> 0
  }
  return out
}
const SEEDS = seeds(NUM_PERM)

/** Conjunto de hashes de k palabras consecutivas, sin mayúsculas ni tildes. */
export function shingles(text: string, k = 3): Set<number> {
  const words = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? []
  const out = new Set<number>()
  if (words.length < k) return out
  for (let i = 0; i + k <= words.length; i++) out.add(fnv1a(words.slice(i, i + k).join(' ')))
  return out
}

export function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  let inter = 0
  for (const x of small) if (big.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** Firma MinHash. `null` si el texto es demasiado corto para tener shingles. */
export function signature(set: Set<number>): Uint32Array | null {
  if (set.size === 0) return null
  const sig = new Uint32Array(NUM_PERM).fill(0xffffffff)
  for (const h of set) {
    for (let i = 0; i < NUM_PERM; i++) {
      const v = mix(h, SEEDS[i])
      if (v < sig[i]) sig[i] = v
    }
  }
  return sig
}

/** Estimación de la similitud de Jaccard a partir de dos firmas. */
export function estimateJaccard(a: Uint32Array, b: Uint32Array): number {
  let same = 0
  for (let i = 0; i < NUM_PERM; i++) if (a[i] === b[i]) same++
  return same / NUM_PERM
}

/** Claves de bandas LSH: dos firmas parecidas comparten al menos una clave con alta probabilidad. */
export function bandKeys(sig: Uint32Array): string[] {
  const keys: string[] = []
  for (let b = 0; b < BANDS; b++) keys.push(`${b}:${Array.from(sig.subarray(b * ROWS, (b + 1) * ROWS)).join('.')}`)
  return keys
}
