import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { INDEX_VERSION, SqliteStore } from '@core/memory'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'

const dir = mkdtempSync(join(tmpdir(), 'ouija-version-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('versión del índice', () => {
  it('un índice creado con una lógica anterior se descarta, pero se conservan las decisiones sobre nombres', async () => {
    const file = join(dir, 'viejo.sqlite')
    const first = new SqliteStore(file, { dimensions: FAKE_DIM })
    const text = 'documento de prueba con bastante texto'
    await first.upsert({ path: '/x/a.txt', hash: 'h', size: 1, mtime: 1, ext: 'txt' }, [{ ord: 0, text, embedding: FakeEmbedder.vector(text) }])
    await first.setEntityLink({ kind: 'person', a: 'rosa', b: 'rosita', relation: 'same' })
    await first.close()

    const raw = new DatabaseSync(file)
    raw.exec("update meta set value = '1' where key = 'index_version'")
    raw.close()

    const reopened = new SqliteStore(file, { dimensions: FAKE_DIM })
    expect(await reopened.listFiles()).toEqual([])
    expect(await reopened.search({ text: 'documento' })).toEqual([])
    expect(await reopened.entityLinks()).toHaveLength(1)
    await reopened.close()

    const again = new SqliteStore(file, { dimensions: FAKE_DIM })
    await again.upsert({ path: '/x/b.txt', hash: 'h2', size: 1, mtime: 1, ext: 'txt' }, [])
    await again.close()
    expect(await new SqliteStore(file, { dimensions: FAKE_DIM }).listFiles()).toHaveLength(1) // la versión actual ya no borra nada
  })

  it('una base nueva queda en la versión actual', async () => {
    const file = join(dir, 'nuevo.sqlite')
    await new SqliteStore(file, { dimensions: FAKE_DIM }).close()
    const raw = new DatabaseSync(file)
    expect(raw.prepare("select value from meta where key = 'index_version'").get()).toEqual({ value: String(INDEX_VERSION) })
    raw.close()
  })
})
