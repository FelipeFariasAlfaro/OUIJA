import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { repairMojibake } from '@core/extract'

/** Letras, dígitos, espacio y puntuación ASCII, con tildes y eñes; sin símbolos que parezcan continuación UTF-8. */
const LETTERS = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?-_áéíóúüñÁÉÍÓÚÜÑ']
const cleanText = fc.array(fc.constantFrom(...LETTERS), { maxLength: 80 }).map((a) => a.join(''))

/** Texto con caracteres que sí pueden aparecer en mojibake real. */
const RICH = [...'abcxyz áéíóúüñÁÉÍÓÚÑ¿¡«»€“”‘’–—…ªº°·½']
const richText = fc.array(fc.constantFrom(...RICH), { maxLength: 60 }).map((a) => a.join(''))

const mojibake = (s: string) => new TextDecoder('windows-1252').decode(Buffer.from(s, 'utf8'))

describe('P6: reparación de codificación', () => {
  it('es idempotente', () => {
    fc.assert(
      fc.property(richText, (s) => {
        const once = repairMojibake(mojibake(s))
        expect(repairMojibake(once)).toBe(once)
      }),
      { numRuns: 500 }
    )
  })

  it('no altera texto ya correcto', () => {
    fc.assert(
      fc.property(cleanText, (s) => {
        expect(repairMojibake(s)).toBe(s)
      }),
      { numRuns: 500 }
    )
  })

  it('revierte exactamente la corrupción típica de UTF-8 leído como Windows-1252', () => {
    fc.assert(
      fc.property(richText, (s) => {
        // Si el original ya parece mojibake (ej. "Ñ“"), la reparación es ambigua por naturaleza.
        fc.pre(repairMojibake(s) === s)
        expect(repairMojibake(mojibake(s))).toBe(s)
      }),
      { numRuns: 500 }
    )
  })

  it('nunca lanza con cadenas arbitrarias', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        expect(typeof repairMojibake(s)).toBe('string')
      }),
      { numRuns: 500 }
    )
  })
})
