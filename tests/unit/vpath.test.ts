import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makeVPath, parseVPath, sanitizeInnerName } from '@core/media'

describe('rutas virtuales', () => {
  it('compone y descompone', () => {
    const v = makeVPath('/d/respaldo.zip', 'docs/poema.doc')
    expect(parseVPath(v)).toEqual({ container: '/d/respaldo.zip', inner: 'docs/poema.doc' })
    expect(parseVPath('/d/normal.txt')).toEqual({ container: '/d/normal.txt' })
  })

  it('sanitiza nombres', () => {
    expect(sanitizeInnerName('a\\b//c')).toBe('a/b/c')
    expect(sanitizeInnerName('/abs/x')).toBe('abs/x')
    expect(sanitizeInnerName('a/../b')).toBeNull()
    expect(sanitizeInnerName('')).toBeNull()
    expect(sanitizeInnerName('a::b')).toBeNull()
  })

  it('roundtrip para cualquier nombre sanitizado', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (raw) => {
        const inner = sanitizeInnerName(raw)
        fc.pre(inner !== null)
        const parsed = parseVPath(makeVPath('/c/x.zip', inner!))
        expect(parsed).toEqual({ container: '/c/x.zip', inner })
      })
    )
  })
})
