import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { IndexPipeline } from '@core/indexing'
import { SqliteStore } from '@core/memory'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'
import { buildZip } from '../helpers/zipBuilder'

const root = mkdtempSync(join(tmpdir(), 'ouija-atime-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('indexar no altera la fecha de último acceso', () => {
  it.skipIf(process.platform !== 'linux')('archivos sueltos y ZIP conservan su atime', async () => {
    const old = new Date('2012-05-05T10:00:00Z')
    const modified = new Date('2013-01-01T10:00:00Z') // atime < mtime: con relatime, leer lo actualizaría
    const files = [join(root, 'a.txt'), join(root, 'b.zip')]
    writeFileSync(files[0], 'Texto antiguo sobre rosas y poemas de marzo para probar el acceso.')
    writeFileSync(files[1], buildZip([{ name: 'x.txt', data: 'Contenido dentro del zip para la prueba de acceso.' }]))
    for (const f of files) utimesSync(f, old, modified)
    const before = files.map((f) => statSync(f).atimeMs)

    const store = new SqliteStore(':memory:', { dimensions: FAKE_DIM })
    try {
      await new IndexPipeline({ store, embedder: new FakeEmbedder() }).indexFolder(root)
      expect(files.map((f) => statSync(f).atimeMs)).toEqual(before)

      const doc = await store.getDoc(files[0])
      expect(doc?.atime).toBe(Math.round(before[0]))
      expect(doc?.born).toBeLessThanOrEqual(doc?.mtime ?? 0)
    } finally {
      await store.close()
    }
  })
})
