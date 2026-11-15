import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { findInvalidCitations, Orchestrator, type Llm } from '@core/ai/orchestrator'
import { SqliteStore } from '@core/memory'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'

const PATHS = ['/h/a/poema_rosa.docx', '/h/b/carta.txt', '/h/c/zip.zip::dentro/rosa_v1.wpd']
const FAKE_NAMES = ['inventado.docx', 'secreto.pdf', 'otra_cosa.txt', '/etc/passwd', '/home/x/y.docx', 'C:\\Users\\x\\z.doc']
const REAL_NAMES = ['poema_rosa.docx', 'carta.txt', 'rosa_v1.wpd', 'zip.zip', '/h/a/poema_rosa.docx']

const fragment = fc.oneof(
  fc.constantFrom(...FAKE_NAMES).map((n) => `«${n}»`),
  fc.constantFrom(...FAKE_NAMES),
  fc.constantFrom(...REAL_NAMES).map((n) => `«${n}»`),
  fc.constantFrom(...REAL_NAMES),
  fc.constantFrom('Hola', 'el poema', 'está en', 'y también', '(p.ej.)', 'y/o', 'versión 3.5', '.', ',')
)
const llmAnswer = fc.array(fragment, { minLength: 0, maxLength: 8 }).map((a) => a.join(' '))

describe('P1: toda ruta citada existe en el índice', () => {
  it('la respuesta final nunca cita archivos que no sean resultados indexados', async () => {
    await fc.assert(
      fc.asyncProperty(llmAnswer, fc.array(fc.integer({ min: -2, max: 6 }), { maxLength: 6 }), async (answer, relevant) => {
        const store = new SqliteStore(':memory:', { dimensions: FAKE_DIM })
        try {
          for (const p of PATHS) {
            const text = `poema para Rosa en ${p}`
            await store.upsert({ path: p, hash: p, size: 1, mtime: 1_000, ext: 'txt' }, [{ ord: 0, text, embedding: FakeEmbedder.vector(text) }])
          }
          const llm: Llm = {
            async complete(prompt) {
              if (prompt.includes('Convierte la pregunta')) return JSON.stringify({ query: 'poema Rosa', extensions: [], dateFrom: null, dateTo: null })
              return JSON.stringify({ found: true, relevant, answer })
            }
          }
          const r = await new Orchestrator({ store, embedder: new FakeEmbedder(), llm }).ask('poema Rosa')

          expect(findInvalidCitations(r.answer, r.matches)).toEqual([])
          for (const m of r.matches) expect(await store.hasPath(m.doc.path)).toBe(true)
        } finally {
          await store.close()
        }
      }),
      { numRuns: 150 }
    )
  })
})
