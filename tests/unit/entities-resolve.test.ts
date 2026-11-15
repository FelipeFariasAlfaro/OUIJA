import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { normalizeName, resolveEntities, type EntityLink, type EntityMention } from '@core/entities'

const m = (name: string, path: string, kind: EntityMention['kind'] = 'person'): EntityMention => ({ kind, name, norm: normalizeName(name), path })
const people = (mentions: EntityMention[], links: EntityLink[] = []) => resolveEntities('person', mentions, links)
const shape = (es: ReturnType<typeof people>) => es.map((e) => [e.name, ...e.aliases].sort().join(' + ')).sort()

describe('normalizeName', () => {
  it('quita tildes, mayúsculas y puntuación', () => {
    expect(normalizeName('  Sr.  Mendoza ')).toBe('sr mendoza')
    expect(normalizeName('María-José Núñez')).toBe('maria jose nunez')
  })
})

describe('unificación de nombres de personas', () => {
  it('une un nombre corto con el completo si aparecen juntos y no hay ambigüedad', () => {
    const r = people([m('Rosa Campos', 'a.txt'), m('Rosa', 'a.txt'), m('Rosa', 'b.txt')])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ name: 'Rosa Campos', aliases: ['Rosa'] })
    expect(r[0].paths).toEqual(['a.txt', 'b.txt'])
  })

  it('une diminutivos que aparecen juntos', () => {
    expect(shape(people([m('Rosa', 'a.txt'), m('Rosita', 'a.txt')]))).toEqual(['Rosa + Rosita'])
    expect(shape(people([m('Juan', 'a.txt'), m('Juanito', 'a.txt')]))).toEqual(['Juan + Juanito'])
  })

  it('no confunde nombres parecidos: Mario y María', () => {
    expect(people([m('Mario', 'a.txt'), m('María', 'a.txt')])).toHaveLength(2)
  })

  it('une tratamientos con el nombre completo', () => {
    const r = people([m('Sr. Mendoza', 'c.txt'), m('Luis Mendoza', 'c.txt')])
    expect(r).toHaveLength(1)
    expect(r[0].name).toBe('Luis Mendoza')
  })

  it('sin evidencia (nunca aparecen juntos) no une', () => {
    expect(people([m('Rosa Campos', 'a.txt'), m('Rosa', 'b.txt')])).toHaveLength(2)
    expect(people([m('Rosa', 'a.txt'), m('Rosita', 'b.txt')])).toHaveLength(2)
  })

  it('no une si hay ambigüedad: Rosa podría ser Campos o Pérez', () => {
    const r = people([m('Rosa Campos', 'a.txt'), m('Rosa Pérez', 'a.txt'), m('Rosa', 'a.txt')])
    expect(r).toHaveLength(3)
  })

  it('une cadenas coherentes: Rosa ~ Rosa Campos ~ Rosa María Campos', () => {
    const r = people([m('Rosa', 'a.txt'), m('Rosa Campos', 'a.txt'), m('Rosa María Campos', 'a.txt')])
    expect(r).toHaveLength(1)
    expect(r[0].name).toBe('Rosa María Campos')
  })

  it('solo las personas se unen de forma aproximada; lugares y proyectos solo por nombre exacto', () => {
    const places = resolveEntities('place', [m('Cusco', 'a.txt', 'place'), m('Cusco Viejo', 'a.txt', 'place'), m('cusco', 'b.txt', 'place')])
    expect(places.map((p) => p.norms)).toEqual([['cusco'], ['cusco viejo']])
    expect(places[0].paths).toEqual(['a.txt', 'b.txt'])
  })

  it('el usuario puede forzar la unión y la separación', () => {
    const base = [m('Rosa', 'a.txt'), m('Rosita', 'b.txt'), m('Rosa Campos', 'c.txt'), m('Rosa', 'c.txt')]
    expect(people(base)).toHaveLength(2) // Rosa+Rosa Campos, Rosita

    const merged = people(base, [{ kind: 'person', a: 'rosa', b: 'rosita', relation: 'same' }])
    expect(merged).toHaveLength(1)

    const split = people(base, [{ kind: 'person', a: 'rosa', b: 'rosa campos', relation: 'different' }])
    expect(split).toHaveLength(3)
  })

  it('una decisión manual ignora nombres que ya no existen', () => {
    expect(people([m('Rosa', 'a.txt')], [{ kind: 'person', a: 'rosa', b: 'fantasma', relation: 'same' }])).toHaveLength(1)
  })
})

describe('propiedades de la resolución', () => {
  const NAMES = ['Rosa', 'Rosita', 'Rosa Campos', 'Rosa Pérez', 'Luis Mendoza', 'Sr. Mendoza', 'Juan', 'Juanito', 'Ana', 'Dra. Salinas']
  const mention = fc.record({ name: fc.constantFrom(...NAMES), path: fc.constantFrom('a', 'b', 'c', 'd') }).map((x) => m(x.name, x.path))
  const mentions = fc.array(mention, { minLength: 1, maxLength: 20 })

  it('cada nombre pertenece a una sola entidad y no se pierden archivos', () => {
    fc.assert(
      fc.property(mentions, (ms) => {
        const r = people(ms)
        const norms = r.flatMap((e) => e.norms)
        expect(new Set(norms).size).toBe(norms.length)
        expect(new Set(norms)).toEqual(new Set(ms.map((x) => x.norm)))
        expect(new Set(r.flatMap((e) => e.paths))).toEqual(new Set(ms.map((x) => x.path)))
        for (const e of r) expect(e.paths.length).toBeGreaterThan(0)
      }),
      { numRuns: 300 }
    )
  })

  it('no depende del orden de las menciones', () => {
    fc.assert(
      fc.property(mentions, fc.integer(), (ms, seed) => {
        const shuffled = [...ms].sort((a, b) => ((a.path + a.norm).length * seed) % 7 - ((b.path + b.norm).length * seed) % 7)
        expect(people(shuffled)).toEqual(people(ms))
      }),
      { numRuns: 200 }
    )
  })

  it('"distinto" manual nunca queda unido automáticamente', () => {
    fc.assert(
      fc.property(mentions, fc.constantFrom(...NAMES), fc.constantFrom(...NAMES), (ms, x, y) => {
        fc.pre(normalizeName(x) !== normalizeName(y))
        const r = people(ms, [{ kind: 'person', a: normalizeName(x), b: normalizeName(y), relation: 'different' }])
        for (const e of r) expect(e.norms.includes(normalizeName(x)) && e.norms.includes(normalizeName(y))).toBe(false)
      }),
      { numRuns: 300 }
    )
  })
})
