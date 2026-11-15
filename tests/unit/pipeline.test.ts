import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FatalIndexError, IndexPipeline, watchFolder, type IndexProgress } from '@core/indexing'
import { OllamaError } from '@core/ai/ollama'
import { SqliteStore } from '@core/memory'
import { buildZip } from '../helpers/zipBuilder'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'

let root: string
let store: SqliteStore
let embedder: FakeEmbedder
let pipeline: IndexPipeline

const put = (rel: string, data: string | Buffer) => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, data)
  return full
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'medium-pipe-'))
  store = new SqliteStore(':memory:', { dimensions: FAKE_DIM })
  embedder = new FakeEmbedder()
  pipeline = new IndexPipeline({ store, embedder })
})
afterEach(async () => {
  await store.close()
  rmSync(root, { recursive: true, force: true })
})

const paths = async () => (await store.listFiles()).map((d) => d.path.slice(root.length + 1))

describe('IndexPipeline', () => {
  it('indexa archivos, contenidos de ZIP y registra errores sin detenerse', async () => {
    put('poema.txt', 'Poema para Rosa. Tus manos guardan la luz de marzo.')
    put('contrato.txt', 'Contrato de arriendo por doce meses, con renovación.')
    put('roto.pdf', '%PDF-1.4 basura')
    put('respaldo.zip', buildZip([{ name: 'viejo/rosa_v1.txt', data: 'Para Rosa, primer borrador del poema.' }, { name: 'foto.jpg', data: 'x' }]))

    const progress: IndexProgress[] = []
    const report = await pipeline.indexFolder(root, { onProgress: (p) => progress.push(p) })

    expect(report).toMatchObject({ scanned: 4, indexed: 3, skipped: 0, errors: 1, removed: 0 })
    expect((await paths()).sort()).toEqual(['contrato.txt', 'poema.txt', 'respaldo.zip', 'respaldo.zip::foto.jpg', 'respaldo.zip::viejo/rosa_v1.txt', 'roto.pdf'].sort())

    const broken = await store.getDoc(join(root, 'roto.pdf'))
    expect(broken?.error).toBeTruthy()

    // El progreso nunca retrocede y termina completo.
    for (let i = 1; i < progress.length; i++) expect(progress[i].processed).toBeGreaterThanOrEqual(progress[i - 1].processed)
    expect(progress.at(-1)).toMatchObject({ phase: 'done', processed: 4, total: 4 })
  })

  it('encuentra por significado y por texto, incluso dentro de un ZIP', async () => {
    put('poema.txt', 'Poema para Rosa. Tus manos guardan la luz de marzo.')
    put('contrato.txt', 'Contrato de arriendo por doce meses, con renovación.')
    put('respaldo.zip', buildZip([{ name: 'rosa_v1.txt', data: 'Para Rosa, primer borrador del poema.' }]))
    await pipeline.indexFolder(root)

    const hits = await store.search({ text: 'poema Rosa', embedding: FakeEmbedder.vector('poema para Rosa') })
    const found = hits.map((h) => h.doc.path.slice(root.length + 1))
    expect(found.slice(0, 2).sort()).toEqual(['poema.txt', 'respaldo.zip::rosa_v1.txt'].sort())
    // El umbral de relevancia lo aplica el orquestador; aquí solo importa el orden.
    expect(found.indexOf('contrato.txt')).toBeGreaterThan(1)
  })

  it('reindexar sin cambios no recalcula nada ni altera el índice (P2)', async () => {
    put('a.txt', 'Hola Rosa, esto es una carta larga con palabras para probar.')
    put('b.zip', buildZip([{ name: 'x.txt', data: 'Contenido dentro del zip para la prueba.' }]))
    await pipeline.indexFolder(root)
    const before = await store.listFiles()
    const embedded = embedder.textsEmbedded

    const again = await pipeline.indexFolder(root)

    expect(again).toMatchObject({ indexed: 0, errors: 0, removed: 0 })
    expect(again.skipped).toBe(2)
    expect(embedder.textsEmbedded).toBe(embedded)
    expect(await store.listFiles()).toEqual(before)
  })

  it('reindexa solo lo modificado', async () => {
    const a = put('a.txt', 'Texto original sobre rosas y poemas de marzo.')
    put('b.txt', 'Otro documento distinto sobre contratos.')
    await pipeline.indexFolder(root)

    writeFileSync(a, 'Texto nuevo completamente distinto sobre sombras y cartas.')
    utimesSync(a, new Date(), new Date(Date.now() + 5000))
    const report = await pipeline.indexFolder(root)

    expect(report).toMatchObject({ indexed: 1, skipped: 1 })
    const hits = await store.search({ text: 'sombras' })
    expect(hits.map((h) => h.doc.path)).toEqual([a])
    expect(await store.search({ text: 'rosas' })).toEqual([])
  })

  it('olvida lo que ya no existe, incluido el contenido de un ZIP borrado', async () => {
    const a = put('a.txt', 'Documento que desaparecerá pronto de la carpeta.')
    const z = put('b.zip', buildZip([{ name: 'x.txt', data: 'Contenido dentro del zip que también desaparece.' }]))
    put('c.txt', 'Este se queda en la carpeta para siempre.')
    await pipeline.indexFolder(root)

    rmSync(a)
    rmSync(z)
    const report = await pipeline.indexFolder(root)

    expect(report.removed).toBe(3)
    expect(await paths()).toEqual(['c.txt'])
  })

  it('un ZIP modificado olvida las entradas que ya no tiene', async () => {
    const z = put('b.zip', buildZip([{ name: 'uno.txt', data: 'Primer archivo dentro del contenedor.' }, { name: 'dos.txt', data: 'Segundo archivo dentro del contenedor.' }]))
    await pipeline.indexFolder(root)
    expect(await paths()).toContain('b.zip::dos.txt')

    writeFileSync(z, buildZip([{ name: 'uno.txt', data: 'Primer archivo dentro del contenedor.' }]))
    utimesSync(z, new Date(), new Date(Date.now() + 5000))
    await pipeline.indexFolder(root)

    expect(await paths()).toEqual(['b.zip', 'b.zip::uno.txt'])
  })

  it('marca como resucitado y con confianza limitada lo rescatado de un ZIP dañado', async () => {
    const zip = buildZip([{ name: 'carta.txt', data: 'Querida Rosa, esta carta sobrevivió a un respaldo dañado.' }])
    put('roto.zip', zip.subarray(0, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))))
    await pipeline.indexFolder(root)

    const doc = await store.getDoc(join(root, 'roto.zip::carta.txt'))
    expect(doc).toMatchObject({ resurrected: true })
    expect(doc?.confidence).not.toBe('high')
  })

  it('si el embedder falla por infraestructura, detiene la indexación sin marcar el archivo como erróneo', async () => {
    put('a.txt', 'Un documento cualquiera con texto suficiente para indexar.')
    embedder.failWith = new OllamaError('unavailable', 'Ollama no responde')

    await expect(pipeline.indexFolder(root)).rejects.toBeInstanceOf(FatalIndexError)
    expect(await store.listFiles()).toEqual([])

    // Al recuperarse, el archivo se indexa normalmente.
    embedder.failWith = null
    expect((await pipeline.indexFolder(root)).indexed).toBe(1)
  })

  it('un fallo puntual del embedder se registra en el archivo y sigue', async () => {
    put('a.txt', 'Un documento cualquiera con texto suficiente para indexar.')
    embedder.failWith = new OllamaError('bad-response', 'contexto demasiado largo')
    const report = await pipeline.indexFolder(root)
    expect(report.errors).toBe(1)
    expect((await store.getDoc(join(root, 'a.txt')))?.error).toMatch(/significado/)
  })

  it('se puede cancelar', async () => {
    put('a.txt', 'Primer documento de la carpeta con algo de texto.')
    put('b.txt', 'Segundo documento de la carpeta con algo de texto.')
    const controller = new AbortController()
    controller.abort()
    const report = await pipeline.indexFolder(root, { signal: controller.signal })
    expect(report.indexed).toBe(0)
    expect(await store.listFiles()).toEqual([])
  })
})

describe('watchFolder', () => {
  const until = async (cond: () => Promise<boolean>, ms = 10_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await cond()) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('tiempo agotado esperando la condición')
  }

  it('indexa lo nuevo, actualiza lo modificado y olvida lo borrado', async () => {
    const watcher = await watchFolder(root, pipeline, { stabilityMs: 100 })
    try {
      const file = put('nuevo.txt', 'Un poema recién escrito para Rosa en la tarde.')
      await until(async () => (await store.getDoc(file)) !== undefined)

      writeFileSync(file, 'Un texto completamente distinto sobre sombras del invierno.')
      await until(async () => (await store.search({ text: 'sombras' })).length === 1)
      expect(await store.search({ text: 'Rosa' })).toEqual([])

      rmSync(file)
      await until(async () => (await store.getDoc(file)) === undefined)

      put('.git/ignorado.txt', 'No debe indexarse porque está en una carpeta excluida.')
      put('otro.txt', 'Este otro documento sí debe indexarse en la carpeta.')
      await until(async () => (await paths()).includes('otro.txt'))
      await watcher.idle()
      expect(await paths()).toEqual(['otro.txt'])
    } finally {
      await watcher.close()
    }
  }, 30_000)
})
