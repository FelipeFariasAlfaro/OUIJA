import { afterEach, describe, expect, it } from 'vitest'
import { SqliteStore } from '@core/memory'
import type { Chunk, IndexedDoc } from '@core/memory'

const DIM = 3
const vec = (...n: number[]): Float32Array => Float32Array.from(n)

function doc(path: string, over: Partial<IndexedDoc> = {}): IndexedDoc {
  return { path, hash: 'h-' + path, size: 10, mtime: 1_000, ext: 'txt', ...over }
}
const chunk = (ord: number, text: string, embedding: Float32Array): Chunk => ({ ord, text, embedding })

let store: SqliteStore
afterEach(async () => {
  await store?.close()
})

describe('SqliteStore', () => {
  it('encuentra por texto, ignorando tildes y mayúsculas', async () => {
    store = new SqliteStore(':memory:', { dimensions: DIM })
    await store.upsert(doc('/a/poema.txt'), [chunk(0, 'Poema para Rosa: acción y luz', vec(1, 0, 0))])
    await store.upsert(doc('/a/otro.txt'), [chunk(0, 'lista de compras', vec(0, 1, 0))])

    const hits = await store.search({ text: 'accion rosa' })
    expect(hits.map((h) => h.doc.path)).toEqual(['/a/poema.txt'])
    expect(hits[0].snippet).toContain('Rosa')
  })

  it('encuentra por significado con vectores', async () => {
    store = new SqliteStore(':memory:', { dimensions: DIM })
    await store.upsert(doc('/a/x.txt'), [chunk(0, 'aaa', vec(1, 0, 0))])
    await store.upsert(doc('/a/y.txt'), [chunk(0, 'bbb', vec(0, 1, 0))])

    const hits = await store.search({ embedding: vec(0.9, 0.1, 0), limit: 1 })
    expect(hits[0].doc.path).toBe('/a/x.txt')
  })

  it('aplica filtros de extensión, carpeta y fecha', async () => {
    store = new SqliteStore(':memory:', { dimensions: DIM })
    await store.upsert(doc('/a/uno.txt', { mtime: 100 }), [chunk(0, 'rosa', vec(1, 0, 0))])
    await store.upsert(doc('/b/dos.md', { ext: 'md', mtime: 900 }), [chunk(0, 'rosa', vec(1, 0, 0))])

    expect((await store.search({ text: 'rosa', filter: { extensions: ['md'] } })).map((h) => h.doc.path)).toEqual([
      '/b/dos.md'
    ])
    expect((await store.search({ text: 'rosa', filter: { folder: '/a' } })).map((h) => h.doc.path)).toEqual([
      '/a/uno.txt'
    ])
    expect((await store.search({ text: 'rosa', filter: { dateFrom: 500 } })).map((h) => h.doc.path)).toEqual([
      '/b/dos.md'
    ])
  })

  it('olvidar un contenedor olvida su contenido', async () => {
    store = new SqliteStore(':memory:', { dimensions: DIM })
    await store.upsert(doc('/d/disco.img'), [])
    await store.upsert(doc('/d/disco.img::POEMA.WPD'), [chunk(0, 'rosa', vec(1, 0, 0))])
    await store.upsert(doc('/d/disco.img2'), [chunk(0, 'rosa', vec(1, 0, 0))])

    await store.forget('/d/disco.img')
    expect(await store.hasPath('/d/disco.img::POEMA.WPD')).toBe(false)
    expect(await store.hasPath('/d/disco.img2')).toBe(true)
  })

  it('rechaza embeddings de dimensión incorrecta sin dejar basura', async () => {
    store = new SqliteStore(':memory:', { dimensions: DIM })
    await expect(store.upsert(doc('/a/x.txt'), [chunk(0, 'a', vec(1, 2))])).rejects.toThrow(/dimensiones/)
    expect(await store.hasPath('/a/x.txt')).toBe(false)
  })

  it('conserva metadatos de resurrección', async () => {
    store = new SqliteStore(':memory:', { dimensions: DIM })
    const d = doc('/d/a.img::X.DOC', { resurrected: true, confidence: 'medium', container: '/d/a.img' })
    await store.upsert(d, [])
    expect(await store.listFiles()).toEqual([d])
  })
})
describe('tipos de archivo en las búsquedas', () => {
  it('excluye extensiones y cuenta lo que hay por extensión', async () => {
    store = new SqliteStore(':memory:', { dimensions: DIM })
    await store.upsert(doc('/a/uno.txt'), [chunk(0, 'rosa', vec(1, 0, 0))])
    await store.upsert(doc('/a/dos.csv', { ext: 'csv' }), [chunk(0, 'rosa', vec(1, 0, 0))])
    await store.upsert(doc('/a/tres.csv', { ext: 'csv' }), [chunk(0, 'rosa', vec(1, 0, 0))])
    expect((await store.search({ text: 'rosa', filter: { excludeExtensions: ['csv'] } })).map((h) => h.doc.path)).toEqual(['/a/uno.txt'])
    expect((await store.search({ embedding: vec(1, 0, 0), filter: { excludeExtensions: ['csv'] } })).map((h) => h.doc.path)).toEqual(['/a/uno.txt'])
    expect((await store.search({ text: 'rosa', filter: { excludeExtensions: [] } })).length).toBe(3)
    expect((await store.extensionCounts()).sort((a, b) => a.ext.localeCompare(b.ext))).toEqual([
      { ext: 'csv', count: 2 },
      { ext: 'txt', count: 1 }
    ])
  })
})
