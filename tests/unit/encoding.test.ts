import { describe, expect, it } from 'vitest'
import { CP437, CP850 } from '@core/extract/codepages'
import { decodeBest, repairMojibake } from '@core/extract'

/** Codifica texto con una tabla DOS (solo para fabricar fixtures). */
function encodeWith(table: string, text: string): Buffer {
  return Buffer.from(
    [...text].map((ch) => {
      const i = table.indexOf(ch)
      return i >= 0 ? 0x80 + i : ch.charCodeAt(0)
    })
  )
}

const SAMPLE = 'El poema para Rosa está en la carta que escribí con mucha ilusión, canción de niño.'

describe('páginas de códigos', () => {
  it('tienen 128 caracteres y valores conocidos', () => {
    expect([...CP437]).toHaveLength(128)
    expect([...CP850]).toHaveLength(128)
    expect(CP437[0xa4 - 0x80]).toBe('ñ')
    expect(CP850[0xa4 - 0x80]).toBe('ñ')
    expect(CP437[0x82 - 0x80]).toBe('é')
    expect(CP850[0xd0 - 0x80]).toBe('ð')
    expect(CP437[0xe1 - 0x80]).toBe('ß')
  })
})

describe('decodeBest', () => {
  it('UTF-8 válido y ASCII: confianza alta', () => {
    expect(decodeBest(Buffer.from(SAMPLE, 'utf8'))).toMatchObject({ text: SAMPLE, confidence: 'high', repaired: false })
  })

  it('quita el BOM de UTF-8 y lee UTF-16 con BOM', () => {
    expect(decodeBest(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hola ñandú')])).text).toBe('hola ñandú')
    expect(decodeBest(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hola ñandú', 'utf16le')])).text).toBe('hola ñandú')
  })

  it('detecta UTF-16 sin BOM', () => {
    expect(decodeBest(Buffer.from(SAMPLE, 'utf16le')).text).toBe(SAMPLE)
  })

  it('detecta Windows-1252 / Latin-1', () => {
    const d = decodeBest(Buffer.from(SAMPLE, 'latin1'))
    expect(d.text).toBe(SAMPLE)
    expect(d.legacy).toBe(false)
  })

  it('detecta texto DOS (CP437/CP850) y lo marca como antiguo', () => {
    for (const table of [CP437, CP850]) {
      const d = decodeBest(encodeWith(table, SAMPLE))
      expect(d.text).toBe(SAMPLE)
      expect(d.legacy).toBe(true)
    }
  })

  it('un texto DOS corto con tildes no se confunde con Windows-1252 ("d¡a", "Concepci¢n")', () => {
    const d = decodeBest(encodeWith(CP437, 'Tus manos guardan la luz del día en Concepción,\ny yo aprendo a nombrarla.'))
    expect(d.text).toBe('Tus manos guardan la luz del día en Concepción,\ny yo aprendo a nombrarla.')
    expect(d.legacy).toBe(true)
  })

  it('repara texto UTF-8 guardado con codificación doble', () => {
    const broken = 'La canciÃ³n del niÃ±o dice: Â¿dÃ³nde estÃ¡ el poema para Rosa?'
    const d = decodeBest(Buffer.from(broken, 'utf8'))
    expect(d.text).toBe('La canción del niño dice: ¿dónde está el poema para Rosa?')
    expect(d.repaired).toBe(true)
    expect(d.confidence).toBe('medium')
  })

  it('un buffer vacío no falla', () => {
    expect(decodeBest(Buffer.alloc(0)).text).toBe('')
  })
})

describe('repairMojibake', () => {
  it('repara comillas, euro y puntos suspensivos', () => {
    expect(repairMojibake('â€œholaâ€\u009d precio 5 â‚¬ y mÃ¡sâ€¦')).toContain('“hola')
    expect(repairMojibake('mÃ¡s')).toBe('más')
  })

  it('repara solo lo dañado en un texto mixto', () => {
    expect(repairMojibake('bien: ñandú, mal: seÃ±or')).toBe('bien: ñandú, mal: señor')
  })

  it('no toca texto correcto', () => {
    const ok = 'La canción: ¿dónde está? «Rosa» – “sí”'
    expect(repairMojibake(ok)).toBe(ok)
  })
})
