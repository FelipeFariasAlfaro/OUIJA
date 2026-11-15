import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { chunkText } from '@core/indexing'

const words = fc.array(fc.constantFrom('rosa', 'poema', 'luz', 'contrato', 'sombra', 'carta', 'a', 'de', 'la'), {
  minLength: 1,
  maxLength: 400
})
const separators = fc.constantFrom(' ', ' ', ' ', '\n', '\n\n', '. ', ', ')
const text = fc
  .tuple(words, fc.array(separators, { minLength: 400, maxLength: 400 }))
  .map(([ws, seps]) => ws.map((w, i) => w + seps[i]).join(''))

describe('chunkText', () => {
  it('texto vacío da cero fragmentos', () => {
    expect(chunkText('   \n ')).toEqual([])
  })

  it('un texto corto es un solo fragmento', () => {
    expect(chunkText('Poema para Rosa')).toEqual(['Poema para Rosa'])
  })

  it('los fragmentos están acotados y no son vacíos', () => {
    fc.assert(
      fc.property(text, fc.integer({ min: 50, max: 600 }), (t, size) => {
        const chunks = chunkText(t, { size, overlap: 20, maxChunks: 10_000 })
        for (const c of chunks) {
          expect(c.length).toBeGreaterThan(0)
          expect(c.length).toBeLessThanOrEqual(size)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('cubre todo el contenido sin dejar huecos', () => {
    fc.assert(
      fc.property(text, fc.integer({ min: 50, max: 600 }), (t, size) => {
        const body = t.trim()
        const chunks = chunkText(t, { size, overlap: 20, maxChunks: 10_000 })
        let prevStart = -1
        let prevEnd = 0
        for (const chunk of chunks) {
          const at = body.indexOf(chunk, prevStart + 1)
          expect(at).toBeGreaterThanOrEqual(0) // cada fragmento es un trozo literal del texto
          expect(body.slice(prevEnd, at).trim()).toBe('') // entre fragmentos solo puede haber espacios
          prevStart = at
          prevEnd = Math.max(prevEnd, at + chunk.length)
        }
        expect(prevEnd).toBe(body.length)
      }),
      { numRuns: 200 }
    )
  })

  it('respeta maxChunks y siempre avanza', () => {
    const long = 'palabra '.repeat(5000)
    expect(chunkText(long, { size: 100, overlap: 90, maxChunks: 7 })).toHaveLength(7)
    expect(chunkText('x'.repeat(5000), { size: 100, overlap: 100, maxChunks: 100_000 }).length).toBeGreaterThan(1)
  })
})
