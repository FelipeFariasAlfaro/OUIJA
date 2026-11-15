import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SqliteStore } from '@core/memory'
import type { Chunk, IndexedDoc } from '@core/memory'

const DIM = 4
const WORDS = ['rosa', 'poema', 'contrato', 'luz', 'sombra', 'carta']

const embedding = fc
  .array(fc.float({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), { minLength: DIM, maxLength: DIM })
  .map((a) => Float32Array.from(a))
const text = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 6 }).map((w) => w.join(' '))
const chunks = fc.array(fc.record({ text, embedding }), { minLength: 0, maxLength: 4 }).map(
  (cs): Chunk[] => cs.map((c, i) => ({ ord: i, ...c }))
)
const path = fc.constantFrom('/a/1.txt', '/a/2.txt', '/b/3.md', '/c/d.img::X.DOC')
const docFor = (p: string, mtime: number): IndexedDoc => ({
  path: p,
  hash: `hash-${p}-${mtime}`,
  size: 1,
  mtime,
  ext: p.endsWith('.md') ? 'md' : 'txt'
})
const entry = fc.record({ path, mtime: fc.integer({ min: 0, max: 10_000 }), chunks })

async function snapshot(store: SqliteStore) {
  return {
    files: await store.listFiles(),
    byWord: await Promise.all(WORDS.map((w) => store.search({ text: w, limit: 50 })))
  }
}

describe('P2: reindexar sin cambios no altera el índice', () => {
  it('upsert repetido deja el mismo estado observable', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(entry, { minLength: 1, maxLength: 6 }), async (entries) => {
        const store = new SqliteStore(':memory:', { dimensions: DIM })
        try {
          for (const e of entries) await store.upsert(docFor(e.path, e.mtime), e.chunks)
          const before = await snapshot(store)
          for (const e of entries) await store.upsert(docFor(e.path, e.mtime), e.chunks)
          expect(await snapshot(store)).toEqual(before)
        } finally {
          await store.close()
        }
      }),
      { numRuns: 60 }
    )
  })
})

describe('P3: tras forget(ruta), ninguna búsqueda devuelve esa ruta', () => {
  it('no queda rastro en texto, vectores ni listados', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(entry, { minLength: 1, maxLength: 6 }),
        path,
        embedding,
        async (entries, victim, probe) => {
          const store = new SqliteStore(':memory:', { dimensions: DIM })
          try {
            for (const e of entries) await store.upsert(docFor(e.path, e.mtime), e.chunks)
            await store.forget(victim)

            expect(await store.hasPath(victim)).toBe(false)
            expect((await store.listFiles()).some((f) => f.path === victim)).toBe(false)
            for (const w of WORDS) {
              const hits = await store.search({ text: w, embedding: probe, limit: 50 })
              expect(hits.some((h) => h.doc.path === victim)).toBe(false)
            }
          } finally {
            await store.close()
          }
        }
      ),
      { numRuns: 60 }
    )
  })
})
