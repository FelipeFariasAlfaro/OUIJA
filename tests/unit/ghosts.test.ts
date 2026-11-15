import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildObituary, GhostHunter, THREE_YEARS_MS } from '@core/ghosts'
import { SqliteStore, type IndexedDoc } from '@core/memory'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'

const NOW = Date.UTC(2026, 10, 14)
const YEAR = 365.25 * 24 * 3600 * 1000
const ago = (years: number) => Math.round(NOW - years * YEAR)

const POEM = `Poema para Rosa. Tus manos guardan la luz de marzo, y yo, torpe, aprendo a nombrarla.
Hay una calle larga donde el viento se detiene a mirar tu ventana, y el cielo se vuelve de papel.
Quiero decirte que la tarde se parece a ti cuando llueve despacio sobre los techos de la ciudad vieja.
Cada palabra que escribo busca el camino de regreso hacia tus manos, hacia la luz, hacia marzo.`
const POEM_V2 = POEM.replace('torpe', 'lento').replace('papel', 'ceniza').replace('despacio', 'sin prisa')
const CONTRACT = `Contrato de arriendo de departamento ubicado en calle Lira. Vigencia de doce meses renovable por acuerdo.
El arrendatario se obliga a pagar el canon mensual dentro de los primeros cinco días de cada mes.
El arrendador entregará el inmueble en buen estado de conservación y con los servicios al día.`

let store: SqliteStore

async function add(path: string, text: string, over: Partial<IndexedDoc> = {}) {
  const doc: IndexedDoc = { path, hash: `h:${text.length}:${text.slice(0, 20)}:${text.slice(-20)}`, size: text.length, mtime: ago(1), atime: ago(1), ext: 'txt', ...over }
  await store.upsert(doc, text ? [{ ord: 0, text, embedding: FakeEmbedder.vector(text) }] : [])
  return doc
}

beforeEach(() => {
  store = new SqliteStore(':memory:', { dimensions: FAKE_DIM })
})
afterEach(async () => store.close())

const hunter = () => new GhostHunter(store)
const paths = (r: { ghosts: { doc: IndexedDoc }[] }) => r.ghosts.map((g) => g.doc.path)

describe('GhostHunter', () => {
  it('agrupa duplicados exactos y deja el más reciente como el que se conserva', async () => {
    await add('/a/presupuesto.txt', CONTRACT, { mtime: ago(5), atime: ago(0.1) })
    await add('/a/presupuesto_FINAL.txt', CONTRACT, { mtime: ago(2), atime: ago(0.1) })
    await add('/a/presupuesto_FINAL2.txt', CONTRACT, { mtime: ago(1), atime: ago(0.1) })

    const r = await hunter().scan({ now: NOW })

    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]).toMatchObject({ kind: 'duplicate' })
    expect(r.groups[0].keeper.path).toBe('/a/presupuesto_FINAL2.txt')
    expect(paths(r).sort()).toEqual(['/a/presupuesto.txt', '/a/presupuesto_FINAL.txt'])
    expect(r.ghosts.every((g) => g.kind === 'duplicate')).toBe(true)
  })

  it('detecta versiones casi idénticas pero no textos distintos', async () => {
    await add('/a/poema_v1.txt', POEM, { hash: 'p1', mtime: ago(8), atime: ago(0.1) })
    await add('/a/poema_v2.txt', POEM_V2, { hash: 'p2', mtime: ago(2), atime: ago(0.1) })
    await add('/a/contrato.txt', CONTRACT, { hash: 'c1', atime: ago(0.1) })

    const r = await hunter().scan({ now: NOW })

    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].kind).toBe('version')
    expect(r.groups[0].members.map((m) => m.path)).toEqual(['/a/poema_v1.txt', '/a/poema_v2.txt'])
    expect(paths(r)).toEqual(['/a/poema_v1.txt'])
    expect(r.ghosts[0].kind).toBe('version')
  })

  it('marca como sin uso lo que pasó el umbral, usando el mayor entre acceso y modificación', async () => {
    await add('/a/viejo.txt', CONTRACT, { hash: 'x1', mtime: ago(5), atime: ago(4) })
    await add('/a/abierto_hace_poco.txt', POEM, { hash: 'x2', mtime: ago(5), atime: ago(0.2) })
    await add('/a/justo_antes.txt', 'texto distinto sobre sombras y cartas del invierno pasado en la ciudad', { hash: 'x3', mtime: ago(2.9), atime: ago(2.9) })

    const r = await hunter().scan({ now: NOW })
    expect(paths(r)).toEqual(['/a/viejo.txt'])
    expect(r.ghosts[0]).toMatchObject({ kind: 'stale', lastUsed: ago(4) })
  })

  it('el umbral es configurable', async () => {
    await add('/a/a.txt', CONTRACT, { hash: 'y1', mtime: ago(1.5), atime: ago(1.5) })
    expect(paths(await hunter().scan({ now: NOW }))).toEqual([])
    expect(paths(await hunter().scan({ now: NOW, staleAfterMs: YEAR }))).toEqual(['/a/a.txt'])
  })

  it('ordena del más olvidado al menos olvidado', async () => {
    await add('/a/c.txt', 'tercer documento sobre lluvia y calles de ciudades lejanas', { hash: 'o3', mtime: ago(4), atime: ago(4) })
    await add('/a/a.txt', 'primer documento sobre mares y barcos de madera antiguos', { hash: 'o1', mtime: ago(9), atime: ago(9) })
    await add('/a/b.txt', 'segundo documento sobre montañas y caminos de piedra viejos', { hash: 'o2', mtime: ago(6), atime: ago(6) })
    expect(paths(await hunter().scan({ now: NOW }))).toEqual(['/a/a.txt', '/a/b.txt', '/a/c.txt'])
  })

  it('un archivo puede ser versión y sin uso a la vez, y el más reciente de un grupo no es duplicado', async () => {
    await add('/a/v1.txt', POEM, { hash: 'p1', mtime: ago(9), atime: ago(9) })
    await add('/a/v2.txt', POEM_V2, { hash: 'p2', mtime: ago(8), atime: ago(8) })

    const r = await hunter().scan({ now: NOW })
    const v1 = r.ghosts.find((g) => g.doc.path === '/a/v1.txt')
    const v2 = r.ghosts.find((g) => g.doc.path === '/a/v2.txt')
    expect(v1?.kinds).toEqual(['version', 'stale'])
    expect(v2?.kinds).toEqual(['stale']) // es el que se conserva, pero lleva años sin uso
  })

  it('compara el contenido de un ZIP con los archivos sueltos y no cuenta el respaldo en sí', async () => {
    await add('/b/respaldo.zip', '', { hash: 'zip1', ext: 'zip', mtime: ago(10), atime: ago(10) })
    await add('/b/respaldo.zip::poema.txt', POEM, { hash: 'same', mtime: ago(10), atime: ago(10), container: '/b/respaldo.zip' })
    await add('/b/poema_actual.txt', POEM, { hash: 'same', mtime: ago(1), atime: ago(0.1) })
    await add('/b/roto.pdf', '', { hash: 'bad', ext: 'pdf', error: 'PDF ilegible', mtime: ago(10), atime: ago(10) })

    const r = await hunter().scan({ now: NOW })
    // El respaldo en sí no cuenta (importa lo que contiene); el PDF ilegible sí: también es un archivo olvidado.
    expect(paths(r)).toEqual(['/b/respaldo.zip::poema.txt', '/b/roto.pdf'])
    expect(r.scanned).toBe(3)
  })

  it('no modifica el índice (R6.5)', async () => {
    await add('/a/a.txt', POEM, { hash: 'p1', mtime: ago(9), atime: ago(9) })
    await add('/a/b.txt', POEM_V2, { hash: 'p2', mtime: ago(8), atime: ago(8) })
    const before = await store.listFiles()
    await hunter().scan({ now: NOW })
    expect(await store.listFiles()).toEqual(before)
  })

  it('un texto muy corto solo se agrupa si es idéntico', async () => {
    await add('/a/nota1.txt', 'hola mundo', { hash: 'n1', atime: ago(0.1) })
    await add('/a/nota2.txt', 'hola mundo!', { hash: 'n2', atime: ago(0.1) })
    expect((await hunter().scan({ now: NOW })).groups).toEqual([])
  })

  it('propiedad: "sin uso" equivale a que el último uso supere el umbral', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 12 * 365 }), fc.integer({ min: 0, max: 12 * 365 })), { minLength: 1, maxLength: 8 }),
        async (ages) => {
          const s = new SqliteStore(':memory:', { dimensions: FAKE_DIM })
          try {
            for (const [i, [mDays, aDays]] of ages.entries()) {
              const text = `documento numero ${i} con contenido unico ${'x'.repeat(i)} sobre tema ${i * 7919}`
              await s.upsert(
                { path: `/p/${i}.txt`, hash: `u${i}`, size: 1, mtime: NOW - mDays * 86_400_000, atime: NOW - aDays * 86_400_000, ext: 'txt' },
                [{ ord: 0, text, embedding: FakeEmbedder.vector(text) }]
              )
            }
            const report = await new GhostHunter(s).scan({ now: NOW })
            const stale = new Set(report.ghosts.filter((g) => g.kinds.includes('stale')).map((g) => g.doc.path))
            for (const [i, [mDays, aDays]] of ages.entries()) {
              const lastUsedMs = NOW - Math.min(mDays, aDays) * 86_400_000
              expect(stale.has(`/p/${i}.txt`)).toBe(NOW - lastUsedMs > THREE_YEARS_MS)
            }
          } finally {
            await s.close()
          }
        }
      ),
      { numRuns: 60 }
    )
  })
})

describe('buildObituary', () => {
  it('usa solo datos del índice y omite lo que no existe', async () => {
    await add('/b/respaldo.zip::poema.txt', POEM, { hash: 'same', mtime: ago(10), atime: ago(10), container: '/b/respaldo.zip', summary: 'Un poema.', born: ago(11), resurrected: true, confidence: 'medium' })
    await add('/b/poema_actual.txt', POEM, { hash: 'same', mtime: ago(1), atime: ago(0.1) })
    await add('/b/otro.txt', 'otro texto sin relación alguna con el poema ni con nada más en este lugar', { hash: 'otro', mtime: ago(9), atime: ago(9) })

    const r = await hunter().scan({ now: NOW })
    const withData = buildObituary(r.ghosts.find((g) => g.doc.path.endsWith('poema.txt'))!)
    expect(withData).toMatchObject({
      name: 'poema.txt',
      container: '/b/respaldo.zip',
      kind: 'duplicate',
      born: ago(11),
      summary: 'Un poema.',
      resurrected: true,
      confidence: 'medium',
      people: [],
      topics: [],
      group: { kind: 'duplicate', count: 2, keeper: { name: 'poema_actual.txt' } }
    })
    expect(withData.related).toEqual([{ name: 'poema_actual.txt', path: '/b/poema_actual.txt' }])

    const bare = buildObituary(r.ghosts.find((g) => g.doc.path === '/b/otro.txt')!)
    expect(bare).not.toHaveProperty('born')
    expect(bare).not.toHaveProperty('summary')
    expect(bare).not.toHaveProperty('container')
    expect(bare).not.toHaveProperty('group')
    expect(bare.related).toEqual([])
  })

  it('las rutas relacionadas existen en el índice', async () => {
    await add('/a/p1.txt', POEM, { hash: 'p1', mtime: ago(9), atime: ago(9) })
    await add('/a/p2.txt', POEM_V2, { hash: 'p2', mtime: ago(8), atime: ago(8) })
    const r = await hunter().scan({ now: NOW })
    for (const g of r.ghosts) for (const rel of buildObituary(g).related) expect(await store.hasPath(rel.path)).toBe(true)
  })
})
