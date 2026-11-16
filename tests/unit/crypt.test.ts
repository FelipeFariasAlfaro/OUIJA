import { describe, expect, it } from 'vitest'
import type { ResolvedEntity } from '@core/entities'
import type { IndexedDoc } from '@core/memory'
import { buildCrypt, epitaphPrompt } from '../../src/main/core/crypt'

const d = (path: string, year: number, over: Partial<IndexedDoc> = {}): IndexedDoc => ({ path, hash: path, size: 10, mtime: Date.UTC(year, 5, 1), ext: path.split('.').pop()!, ...over })
const person = (name: string, paths: string[]): ResolvedEntity => ({ id: `person:${name}`, kind: 'person', name, aliases: [], norms: [name.toLowerCase()], paths }) as unknown as ResolvedEntity

describe('la cripta', () => {
  const docs = [
    d('/papa/2006/historial.xml', 2006, { origin: 'msn', resurrected: true, summary: 'Conversación con Rosa' }),
    d('/papa/2008/respaldo.zip::Tesis/tesis.wpd', 2008, { resurrected: true, summary: 'Tesis' }),
    d('/papa/fotos/cusco.jpg', 2020, { born: Date.UTC(2011, 7, 4) }),
    d('/papa/correo/familia.mbox', 2009, { origin: 'mbox' }),
    d('/papa/codigo/script.py', 2015)
  ]
  const r = buildCrypt({ folder: '/papa', docs, people: [person('Rosa', ['/papa/2006/historial.xml', '/papa/2008/respaldo.zip::Tesis/tesis.wpd', '/otro/x.txt']), person('Nadie', ['/otro/y.txt'])], places: [], ghosts: 2 })

  it('ordena por años, usando la fecha más antigua conocida (EXIF en las fotos)', () => {
    expect(r.years.map((y) => y.year)).toEqual([2006, 2008, 2009, 2011, 2015])
    expect(r.from).toBe(Date.UTC(2006, 5, 1))
    expect(r.years.find((y) => y.year === 2006)?.people).toEqual(['Rosa'])
  })
  it('solo cuenta almas que aparecen dentro de la cripta', () => {
    expect(r.souls).toEqual([{ name: 'Rosa', files: 2 }])
  })
  it('separa retratos, voces y resucitados', () => {
    expect(r.portraits.map((p) => p.name)).toEqual(['cusco.jpg'])
    expect(r.voices.map((v) => v.origin)).toEqual(['msn', 'mbox'])
    expect(r.resurrectedCount).toBe(2)
    expect(r.resurrected[1]).toMatchObject({ name: 'tesis.wpd', container: '/papa/2008/respaldo.zip' })
    expect(r.ghosts).toBe(2)
  })
  it('el epitafio se pide solo con datos reales y prohíbe inventar', () => {
    const prompt = epitaphPrompt(r, 'español')
    expect(prompt).toContain('No inventes')
    expect(prompt).toContain('Rosa')
    expect(prompt).toContain('2006: 1')
  })
})
