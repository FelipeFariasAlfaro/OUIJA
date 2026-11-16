import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IndexPipeline, watchFolder, type ChangeInput } from '@core/indexing'
import { SqliteStore } from '@core/memory'
import { OuijaCore, type ModelClient } from '../../src/main/core/ouija'
import { SecretStore } from '../../src/main/core/secrets'
import { SettingsStore } from '../../src/main/core/settings'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'
import { buildZip } from '../helpers/zipBuilder'

let root: string
let store: SqliteStore
let pipeline: IndexPipeline

const put = (rel: string, data: string | Buffer, when?: Date) => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, data)
  if (when) utimesSync(full, when, when)
  return full
}
const log = () => store.recentChanges(100).map((c) => `${c.kind}:${c.name}`)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ouija-changes-'))
  store = new SqliteStore(':memory:', { dimensions: FAKE_DIM })
  pipeline = new IndexPipeline({ store, embedder: new FakeEmbedder(), changes: { record: (c: ChangeInput) => store.recordChange(c) } })
})
afterEach(async () => {
  await store.close()
  rmSync(root, { recursive: true, force: true })
})

describe('detección de cambios al indexar', () => {
  it('la primera indexación de una carpeta no anota nada: todo sería "nuevo"', async () => {
    put('a.txt', 'Un documento con texto suficiente para indexar en la carpeta.')
    put('b.txt', 'Otro documento con texto suficiente para indexar en la carpeta.')
    await pipeline.indexFolder(root)
    expect(log()).toEqual([])
  })

  it('después sí: archivos nuevos, modificados y eliminados', async () => {
    const a = put('a.txt', 'Texto original del documento a, con suficiente contenido.', new Date('2020-01-01'))
    put('b.txt', 'Texto del documento b, con suficiente contenido para indexar.')
    await pipeline.indexFolder(root)

    put('nuevo.txt', 'Un documento recién llegado con suficiente contenido.')
    writeFileSync(a, 'Texto completamente distinto y modificado del documento a.')
    utimesSync(a, new Date('2021-01-01'), new Date('2021-01-01'))
    unlinkSync(join(root, 'b.txt'))
    const report = await pipeline.indexFolder(root)

    expect(report).toMatchObject({ indexed: 2, removed: 1 })
    expect(log().sort()).toEqual(['added:nuevo.txt', 'modified:a.txt', 'removed:b.txt'])
  })

  it('un archivo sin cambios no genera ruido', async () => {
    put('a.txt', 'Un documento con texto suficiente para indexar en la carpeta.')
    await pipeline.indexFolder(root)
    await pipeline.indexFolder(root)
    await pipeline.indexFolder(root)
    expect(log()).toEqual([])
  })

  it('al eliminarse se guarda lo que OUIJA sabía del archivo, para poder mostrarlo después', async () => {
    const file = put('contrato.txt', 'Contrato de arriendo de departamento por doce meses con renovación.')
    put('otro.txt', 'Otro documento para que la carpeta ya tenga contenido indexado.')
    await pipeline.indexFolder(root)
    await store.setEntities(file, [], 'Contrato de arriendo de un departamento por doce meses.')

    unlinkSync(file)
    await pipeline.indexFolder(root)

    const removed = store.recentChanges().find((c) => c.kind === 'removed')
    expect(removed).toMatchObject({ name: 'contrato.txt', summary: 'Contrato de arriendo de un departamento por doce meses.', exists: false })
    expect(store.knownSummaries([file]).get(file)).toBe('Contrato de arriendo de un departamento por doce meses.')
  })

  it('un respaldo que cambia cuenta como un solo cambio, no uno por archivo de dentro', async () => {
    put('otro.txt', 'Otro documento para que la carpeta ya tenga contenido indexado.')
    const zip = put('respaldo.zip', buildZip([{ name: 'uno.txt', data: 'Primer archivo dentro del respaldo, con texto.' }, { name: 'dos.txt', data: 'Segundo archivo dentro del respaldo, con texto.' }]), new Date('2020-01-01'))
    await pipeline.indexFolder(root)
    writeFileSync(zip, buildZip([{ name: 'uno.txt', data: 'Primer archivo dentro del respaldo, con texto.' }, { name: 'tres.txt', data: 'Tercer archivo nuevo dentro del respaldo, con texto.' }]))
    utimesSync(zip, new Date('2022-01-01'), new Date('2022-01-01'))
    await pipeline.indexFolder(root)
    expect(log()).toEqual(['modified:respaldo.zip'])
  })

  it('olvidar una carpeta desde Ajustes no cuenta como que los archivos se borraron', async () => {
    put('a.txt', 'Un documento con texto suficiente para indexar en la carpeta.')
    await pipeline.indexFolder(root)
    await pipeline.forgetFolder(root)
    expect(log()).toEqual([])
  })
})

describe('detección en vivo (vigilancia)', () => {
  const until = async (cond: () => boolean, ms = 10_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (cond()) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('tiempo agotado')
  }

  it('anota nuevos, modificados y eliminados mientras la aplicación está abierta, incluso carpetas enteras', async () => {
    put('base.txt', 'Un documento base con texto suficiente para indexar en la carpeta.')
    await pipeline.indexFolder(root)
    const watcher = await watchFolder(root, pipeline, { stabilityMs: 100 })
    try {
      const file = put('en-vivo.txt', 'Un archivo que aparece mientras OUIJA vigila la carpeta.')
      await until(() => log().includes('added:en-vivo.txt'))

      writeFileSync(file, 'El mismo archivo, pero con un contenido completamente distinto ahora.')
      await until(() => log().includes('modified:en-vivo.txt'))

      unlinkSync(file)
      await until(() => log().includes('removed:en-vivo.txt'))

      put('carpeta/uno.txt', 'Primer archivo de una carpeta que se borrará completa más tarde.')
      put('carpeta/dos.txt', 'Segundo archivo de una carpeta que se borrará completa más tarde.')
      await until(() => log().includes('added:dos.txt') && log().includes('added:uno.txt'))
      rmSync(join(root, 'carpeta'), { recursive: true })
      await until(() => log().includes('removed:uno.txt') && log().includes('removed:dos.txt'))
    } finally {
      await watcher.close()
    }
  }, 40_000)
})

describe('registro de cambios', () => {
  it('une las escrituras seguidas del mismo archivo, pero no las eliminaciones', () => {
    const base = { path: '/x/a.txt', name: 'a.txt', ext: 'txt', size: 1 }
    store.recordChange({ ...base, kind: 'modified', ts: 1_000 })
    store.recordChange({ ...base, kind: 'modified', ts: 20_000, size: 5 })
    store.recordChange({ ...base, kind: 'modified', ts: 200_000 })
    store.recordChange({ ...base, kind: 'removed', ts: 200_100 })
    store.recordChange({ ...base, kind: 'removed', ts: 200_200 })
    const kinds = store.recentChanges().map((c) => `${c.kind}@${c.ts}`)
    expect(kinds).toEqual(['removed@200200', 'removed@200100', 'modified@200000', 'modified@20000'])
  })

  it('guarda como mucho las últimas 1000 entradas', () => {
    for (let i = 0; i < 1100; i++) store.recordChange({ kind: 'added', path: `/x/${i}.txt`, name: `${i}.txt`, ext: 'txt', size: 1, ts: i })
    expect(store.recentChanges(200)[0].name).toBe('1099.txt')
    const all = (store as unknown as { db: { prepare(s: string): { get(): { n: number } } } }).db.prepare('select count(*) as n from changes').get().n
    expect(all).toBeLessThanOrEqual(1000)
  })

  it('"olvidar todo" también borra el registro', async () => {
    store.recordChange({ kind: 'added', path: '/x/a.txt', name: 'a.txt', ext: 'txt', size: 1 })
    await store.forgetAll()
    expect(store.recentChanges()).toEqual([])
  })

  it('para lo que sigue indexado, muestra el resumen actual', async () => {
    await store.upsert({ path: '/x/a.txt', hash: 'h', size: 1, mtime: 1, ext: 'txt', summary: 'Resumen actual' }, [])
    store.recordChange({ kind: 'added', path: '/x/a.txt', name: 'a.txt', ext: 'txt', size: 1 })
    expect(store.recentChanges()[0]).toMatchObject({ summary: 'Resumen actual', exists: true })
  })
})

// --- En la aplicación completa -------------------------------------------------

function fakeClient(): ModelClient {
  const embedder = new FakeEmbedder()
  return {
    embed: (t) => embedder.embed(t),
    probeDimensions: async () => FAKE_DIM,
    listModels: async () => ['bge-m3:latest', 'qwen3.5:4b'],
    async complete(prompt) {
      if (prompt.includes('Analiza el texto')) return JSON.stringify({ people: [], places: [], projects: [], summary: 'Resumen generado del documento.' })
      if (prompt.includes('únicos archivos candidatos')) return JSON.stringify({ found: true, relevant: [1], answer: '' })
      return JSON.stringify({ query: 'x', extensions: [], kind: '', dateFrom: null, dateTo: null })
    }
  }
}

describe('OuijaCore: cambios y papelera', () => {
  let data: string
  let home: string
  let core: OuijaCore
  const until = async (cond: () => boolean | Promise<boolean>, ms = 10_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await cond()) return
      await new Promise((r) => setTimeout(r, 80))
    }
    throw new Error('tiempo agotado')
  }

  async function boot(rescanEveryMs: number) {
    const settings = new SettingsStore(join(data, 'settings.json'))
    await settings.load()
    await settings.update({ folders: [root], watchFolders: false, indexOnStart: false, ocrImages: false, onboarded: true })
    core = new OuijaCore({
      dataDir: data,
      settings,
      secrets: new SecretStore(join(data, 's.json'), { available: () => false, encrypt: (p) => Buffer.from(p), decrypt: (b) => b.toString() }),
      createClient: fakeClient,
      rescanEveryMs,
      trash: { platform: 'linux', home, env: {}, uid: 1000, mounts: [] }
    })
    await core.init()
  }

  beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), 'ouija-core-data-'))
    home = mkdtempSync(join(tmpdir(), 'ouija-core-home-'))
    mkdirSync(join(home, '.local', 'share', 'Trash', 'files'), { recursive: true })
    mkdirSync(join(home, '.local', 'share', 'Trash', 'info'), { recursive: true })
  })
  afterEach(async () => {
    await core?.close()
    rmSync(data, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('la revisión periódica detecta lo que pasó sin que la vigilancia en vivo lo viera, y avisa a la interfaz', async () => {
    put('base.txt', 'Un documento base con texto suficiente para indexar en la carpeta.')
    await boot(150)
    await core.indexNow()
    let notified = 0
    core.onChanges(() => notified++)

    put('llego-despues.txt', 'Este archivo llegó con OUIJA cerrado o sin vigilancia, y debe detectarse.')
    await until(() => core.recentChanges().some((c) => c.kind === 'added' && c.name === 'llego-despues.txt'))

    expect(notified).toBeGreaterThan(0)
    const change = core.recentChanges().find((c) => c.name === 'llego-despues.txt')!
    expect(change).toMatchObject({ kind: 'added', exists: true, ext: 'txt', path: join(root, 'llego-despues.txt') })
    // La información de dentro también: el archivo ya es buscable.
    expect((await core.ask('llegó sin vigilancia')).matches.map((m) => m.name)).toContain('llego-despues.txt')
  })

  it('sin carpetas, o sin terminar la bienvenida, no revisa nada', async () => {
    await boot(60)
    await core.updateSettings({ folders: [] })
    await new Promise((r) => setTimeout(r, 250))
    expect(core.getState().phase).toBe('idle')
    expect(core.getState().lastRunAt).toBeUndefined()
  })

  it('Patíbulo: lo que OUIJA sabía de un archivo se ve en la papelera, y se puede resucitar', async () => {
    const file = put('Contratos/arriendo.txt', 'Contrato de arriendo de departamento por doce meses con renovación automática.')
    put('otro.txt', 'Otro documento para que la carpeta ya tenga contenido indexado.')
    await boot(0)
    await core.indexNow()
    expect((await core.ask('contrato arriendo')).matches.map((m) => m.name)).toContain('arriendo.txt')

    // El usuario lo manda a la papelera: se mueve a Trash/files con su .trashinfo.
    const trash = join(home, '.local', 'share', 'Trash')
    writeFileSync(join(trash, 'files', 'arriendo.txt'), 'Contrato de arriendo de departamento por doce meses con renovación automática.')
    writeFileSync(join(trash, 'info', 'arriendo.txt.trashinfo'), `[Trash Info]\nPath=${encodeURI(file)}\nDeletionDate=2026-11-10T09:30:00\n`)
    unlinkSync(file)
    await core.indexNow() // OUIJA nota que desapareció

    expect(core.recentChanges()[0]).toMatchObject({ kind: 'removed', name: 'arriendo.txt', exists: false })
    const overview = await core.trashOverview()
    expect(overview).toMatchObject({ supported: true, totalCount: 1, locations: 1, byKind: { text: 1 } })
    expect(overview.items[0]).toMatchObject({ name: 'arriendo.txt', originalPath: file, originalFolder: join(root, 'Contratos'), kind: 'text' })
    expect(overview.items[0].summary).toBe('Resumen generado del documento.') // lo que OUIJA sabía antes de que se borrara

    const [result] = await core.restoreFromTrash([overview.items[0].id])
    expect(result).toMatchObject({ ok: true, restoredTo: file, renamed: false })

    // Al volver, OUIJA lo detecta como nuevo y vuelve a ser buscable.
    await core.indexNow()
    expect(core.recentChanges()[0]).toMatchObject({ kind: 'added', name: 'arriendo.txt', exists: true })
    expect((await core.ask('contrato arriendo')).matches.map((m) => m.name)).toContain('arriendo.txt')
    expect((await core.trashOverview()).totalCount).toBe(0)
  })

  it('en un sistema sin papelera legible, lo informa', async () => {
    await boot(0)
    core = Object.assign(core, { trash: new (await import('../../src/main/core/trash')).TrashService({ platform: 'darwin', home }) })
    expect(await core.trashOverview()).toMatchObject({ supported: false, items: [], totalCount: 0 })
  })

  it('no resucita más de 200 elementos por vez', async () => {
    await boot(0)
    const results = await core.restoreFromTrash(Array.from({ length: 300 }, (_, i) => `id${i}`))
    expect(results).toHaveLength(200)
    expect(results.every((r) => !r.ok && r.error === 'not-found')).toBe(true)
  })
})
