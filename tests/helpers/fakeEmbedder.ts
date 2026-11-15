import type { Embedder } from '@core/indexing'

export const FAKE_DIM = 64

function hash(word: string): number {
  let h = 2166136261
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Embedder determinista de bolsa de palabras con hashing. Texto parecido da vectores cercanos. */
export class FakeEmbedder implements Embedder {
  calls = 0
  textsEmbedded = 0
  failWith: Error | null = null

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.failWith) throw this.failWith
    this.calls++
    this.textsEmbedded += texts.length
    return texts.map((t) => FakeEmbedder.vector(t))
  }

  static vector(text: string): Float32Array {
    const v = new Float32Array(FAKE_DIM)
    for (const w of text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[a-z0-9]+/g) ?? []) {
      v[hash(w) % FAKE_DIM] += 1
    }
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < v.length; i++) v[i] /= norm
    return v
  }
}
