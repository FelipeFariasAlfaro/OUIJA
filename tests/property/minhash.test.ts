import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { jaccard, shingles } from '@core/ghosts'
import { estimateJaccard, signature } from '../../src/core/ghosts/minhash'

const VOCAB = Array.from({ length: 200 }, (_, i) => `palabra${i}`)
const words = (min: number, max: number) => fc.array(fc.constantFrom(...VOCAB), { minLength: min, maxLength: max })
const text = (min = 5, max = 120) => words(min, max).map((w) => w.join(' '))

describe('shingles y Jaccard', () => {
  it('ignoran mayúsculas, tildes y puntuación', () => {
    expect(shingles('Canción de la LUZ, del mar')).toEqual(shingles('cancion de la luz del mar'))
  })

  it('un texto de menos de 3 palabras no tiene shingles', () => {
    expect(shingles('hola mundo').size).toBe(0)
  })

  it('Jaccard es simétrico, está entre 0 y 1, y vale 1 con uno mismo', () => {
    fc.assert(
      fc.property(text(), text(), (a, b) => {
        const sa = shingles(a)
        const sb = shingles(b)
        const j = jaccard(sa, sb)
        expect(j).toBeGreaterThanOrEqual(0)
        expect(j).toBeLessThanOrEqual(1)
        expect(jaccard(sb, sa)).toBe(j)
        if (sa.size > 0) expect(jaccard(sa, sa)).toBe(1)
      }),
      { numRuns: 200 }
    )
  })
})

describe('MinHash', () => {
  it('textos idénticos tienen la misma firma y similitud estimada 1', () => {
    fc.assert(
      fc.property(text(10, 80), (t) => {
        const a = signature(shingles(t))
        const b = signature(shingles(t))
        expect(a).not.toBeNull()
        expect(estimateJaccard(a!, b!)).toBe(1)
      }),
      { numRuns: 100 }
    )
  })

  it('la estimación se acerca a la similitud real', () => {
    fc.assert(
      fc.property(words(40, 150), fc.nat(60), (base, edits) => {
        const changed = [...base]
        for (let i = 0; i < Math.min(edits, changed.length); i++) changed[(i * 7) % changed.length] = `zz${i}`
        const sa = shingles(base.join(' '))
        const sb = shingles(changed.join(' '))
        fc.pre(sa.size > 0 && sb.size > 0)
        const est = estimateJaccard(signature(sa)!, signature(sb)!)
        expect(Math.abs(est - jaccard(sa, sb))).toBeLessThan(0.2)
      }),
      { numRuns: 150 }
    )
  })
})
