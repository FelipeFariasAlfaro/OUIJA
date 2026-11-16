import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OllamaError } from '@core/ai/ollama'
import type { IndexState } from '@shared/ipc'
import { OuijaCore, type ModelClient } from '../../src/main/core/ouija'
import { SecretStore } from '../../src/main/core/secrets'
import { SettingsStore } from '../../src/main/core/settings'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'
import { buildZip } from '../helpers/zipBuilder'

interface FakeOptions {
  models?: string[] | Error
  embedFail?: Error
  dims?: number
}

function fakeClient(options: FakeOptions = {}): ModelClient & { embedder: FakeEmbedder } {
  const embedder = new FakeEmbedder()
  if (options.embedFail) embedder.failWith = options.embedFail
  return {
    embedder,
    embed: (texts) => embedder.embed(texts),
    probeDimensions: async () => options.dims ?? FAKE_DIM,
    async listModels() {
      if (options.models instanceof Error) throw options.models
      return options.models ?? ['bge-m3:latest', 'qwen3.5:4b']
    },
    async complete(prompt) {
      if (prompt.includes('Convierte la pregunta')) return JSON.stringify({ query: 'poema Rosa', extensions: [], dateFrom: null, dateTo: null })
      if (prompt.includes('Analiza el texto')) {
        const people = ['Rosa', 'Matías'].filter((n) => prompt.includes(n))
        return JSON.stringify({ people, places: [], projects: [], summary: 'Un documento de prueba sobre cartas y poemas.' })
      }
      return JSON.stringify({ found: true, relevant: [1], answer: '' })
    }
  }
}

let root: string
let data: string
let settings: SettingsStore
let core: OuijaCore
let client: ReturnType<typeof fakeClient>

const put = (rel: string, content: string | Buffer, when?: Date) => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  if (when) utimesSync(full, when, when)
  return full
}

async function boot(options: FakeOptions = {}) {
  client = fakeClient(options)
  core = new OuijaCore({ dataDir: data, settings, secrets: new SecretStore(join(data, 'secrets.json'), { available: () => false, encrypt: (p) => Buffer.from(p), decrypt: (b) => b.toString() }), createClient: () => client })
  await core.init()
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ouija-core-root-'))
  data = mkdtempSync(join(tmpdir(), 'ouija-core-data-'))
  settings = new SettingsStore(join(data, 'settings.json'))
  await settings.load()
  await settings.update({ folders: [root], watchFolders: false })
})
afterEach(async () => {
  await core?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

const fill = () => {
  put('poema.txt', 'Poema para Rosa. Tus manos guardan la luz de marzo, y yo aprendo a nombrarla despacio.', new Date('2019-03-12'))
  put('diario.txt', 'Diario de viaje. Rosa y Matías esperaban en Arequipa con una lista de lugares para visitar.', new Date('2011-08-05'))
  put('respaldo.zip', buildZip([{ name: 'Poemas/rosa_v1.txt', data: 'Para Rosa, primer borrador del poema. Tus manos guardan la luz.' }]), new Date('2008-06-03'))
}

describe('OuijaCore: arranque', () => {
  it('adopta la dimensión real del modelo de embeddings y guarda el cambio', async () => {
    await boot({ dims: FAKE_DIM })
    expect(settings.value.embedDimensions).toBe(FAKE_DIM)
  })

  it('si cambia el modelo de embeddings, conserva el índice anterior como respaldo y empieza uno nuevo', async () => {
    await boot()
    await core.indexNow()
    await core.close()
    expect(existsSync(join(data, 'index.sqlite'))).toBe(true)

    await settings.update({ embedDimensions: FAKE_DIM })
    await boot({ dims: 32 })
    expect(settings.value.embedDimensions).toBe(32)
    expect(readdirSync(data).some((f) => f.startsWith('index.sqlite.bak-'))).toBe(true)
  })

  it('borra las copias temporales de la sesión anterior', async () => {
    mkdirSync(join(data, 'open', 'x'), { recursive: true })
    writeFileSync(join(data, 'open', 'x', 'viejo.txt'), 'x')
    await boot()
    expect(existsSync(join(data, 'open'))).toBe(false)
  })
})

describe('OuijaCore: indexar y preguntar', () => {
  it('indexa, informa el progreso y responde con archivos reales y de dentro de un ZIP', async () => {
    fill()
    await boot()
    const states: IndexState[] = []
    core.onState((s) => states.push(s))

    await core.indexNow()

    expect(states[0].phase).toBe('scanning')
    expect(states.some((s) => s.phase === 'indexing' && s.total === 3)).toBe(true)
    expect(states.some((s) => s.phase === 'entities')).toBe(true)
    expect(core.getState()).toMatchObject({ phase: 'idle', errors: 0 })
    expect(core.getState().lastRunAt).toBeTypeOf('number')

    const r = await core.ask('¿dónde está el poema para Rosa?')
    expect(r.found).toBe(true)
    expect(r.mode).toBe('full')
    const names = r.matches.map((m) => m.name)
    expect(names).toContain('poema.txt')
    const zipped = r.matches.find((m) => m.name === 'rosa_v1.txt')
    expect(zipped).toMatchObject({ container: join(root, 'respaldo.zip'), path: `${join(root, 'respaldo.zip')}::Poemas/rosa_v1.txt` })
  })

  it('una segunda indexación no repite trabajo', async () => {
    fill()
    await boot()
    await core.indexNow()
    const embedded = client.embedder.textsEmbedded
    await core.indexNow()
    expect(client.embedder.textsEmbedded).toBe(embedded)
    expect(core.getState()).toMatchObject({ phase: 'idle', skipped: 3, indexed: 0 })
  })

  it('dos pedidos simultáneos comparten una sola indexación', async () => {
    fill()
    await boot()
    const a = core.indexNow()
    const b = core.indexNow()
    expect(a).toBe(b)
    await a
  })

  it('si Ollama cae durante la indexación, queda en error con el motivo y no marca archivos como fallidos', async () => {
    fill()
    await boot({ embedFail: new OllamaError('unavailable', 'sin conexión') })
    await core.indexNow()
    expect(core.getState()).toMatchObject({ phase: 'error', message: 'ollama' })
    expect((await core.ghosts()).length).toBe(0)
  })

  it('sin Ollama, responde en modo ligero y explica qué falta', async () => {
    fill()
    await boot({ models: new Error('ECONNREFUSED') })
    const status = await core.ollamaStatus()
    expect(status).toMatchObject({ available: false, hints: [{ code: 'start-ollama' }] })

    await core.indexNow().catch(() => undefined) // no hay embeddings: la indexación se detiene
    expect(core.getState().phase).toBe('error')
  })

  it('indica qué modelos faltan', async () => {
    await boot({ models: ['llama3.1:8b'] })
    const s = await core.ollamaStatus()
    expect(s).toMatchObject({ available: true, embedModelInstalled: false, chatModel: 'llama3.1:8b' })
    expect(s.hints).toEqual([{ code: 'pull-embed', command: 'ollama pull bge-m3' }])

    await boot({ models: ['bge-m3:latest'] })
    expect((await core.ollamaStatus()).hints).toEqual([{ code: 'pull-chat', command: 'ollama pull qwen3.5:4b' }])
  })

  it('se puede cancelar', async () => {
    fill()
    await boot()
    const run = core.indexNow()
    core.cancelIndex()
    await run
    expect(core.getState().phase).toBe('idle')
  })
})

describe('OuijaCore: fantasmas, personas y resúmenes', () => {
  it('genera resúmenes, personas con línea de tiempo y fantasmas con necrológica', async () => {
    fill()
    await boot()
    await core.indexNow()

    const people = await core.people()
    const rosa = people.find((p) => p.name === 'Rosa')
    expect(rosa?.fileCount).toBe(3)
    const timeline = await core.timeline(rosa!.id)
    expect(timeline!.files.map((f) => f.name)).toEqual(['rosa_v1.txt', 'diario.txt', 'poema.txt'])

    const ghosts = await core.ghosts()
    expect(ghosts.map((g) => g.name).sort()).toEqual(['diario.txt', 'poema.txt', 'rosa_v1.txt'])
    const zipped = ghosts.find((g) => g.name === 'rosa_v1.txt')!
    expect(zipped).toMatchObject({ kind: 'stale', container: join(root, 'respaldo.zip'), summary: 'Un documento de prueba sobre cartas y poemas.' })
    expect(zipped.people).toEqual(['Rosa'])
  })

  it('las decisiones manuales cambian el resultado', async () => {
    put('a.txt', 'Rosa Campos escribió a Rosa en Arequipa durante toda la primavera pasada.', new Date('2019-01-01'))
    put('b.txt', 'Matías visitó a Rosa en Cusco y le llevó una carta escrita a mano.', new Date('2020-01-01'))
    await boot()
    await core.indexNow()
    const before = (await core.people()).length

    await core.decideNames('merge', 'Rosa', 'Matías')
    expect((await core.people()).length).toBe(before - 1)
    await core.decideNames('clear', 'Rosa', 'Matías')
    expect((await core.people()).length).toBe(before)
  })
})

describe('OuijaCore: abrir y exportar solo lo indexado', () => {
  it('rechaza rutas que no están en el índice', async () => {
    fill()
    await boot()
    await core.indexNow()
    for (const bad of ['/etc/passwd', join(root, '..', 'otro.txt'), `${join(root, 'respaldo.zip')}::../../etc/passwd`, `${join(root, 'respaldo.zip')}::Poemas/no_existe.txt`]) {
      await expect(core.preparePathToOpen(bad)).rejects.toThrow(/no está en el índice/)
      await expect(core.pathToReveal(bad)).rejects.toThrow(/no está en el índice/)
      await expect(core.exportTo(bad, join(data, 'out'))).rejects.toThrow(/no está en el índice/)
    }
  })

  it('un archivo real se abre en su lugar; uno de un respaldo, desde una copia temporal', async () => {
    fill()
    await boot()
    await core.indexNow()

    expect(await core.preparePathToOpen(join(root, 'poema.txt'))).toBe(join(root, 'poema.txt'))

    const virtual = `${join(root, 'respaldo.zip')}::Poemas/rosa_v1.txt`
    const copy = await core.preparePathToOpen(virtual)
    expect(copy.startsWith(join(data, 'open'))).toBe(true)
    expect(readFileSync(copy, 'utf8')).toBe('Para Rosa, primer borrador del poema. Tus manos guardan la luz.')
    expect(statSync(copy).mode & 0o077).toBe(0) // solo el dueño puede leerla
    expect(await core.pathToReveal(virtual)).toBe(join(root, 'respaldo.zip'))
  })

  it('avisa si el archivo ya no existe en su lugar', async () => {
    fill()
    await boot()
    await core.indexNow()
    rmSync(join(root, 'poema.txt'))
    await expect(core.preparePathToOpen(join(root, 'poema.txt'))).rejects.toThrow(/ya no existe/)
  })

  it('exporta sin sobrescribir nunca nada', async () => {
    fill()
    await boot()
    await core.indexNow()
    const virtual = `${join(root, 'respaldo.zip')}::Poemas/rosa_v1.txt`
    const dest = join(data, 'exportados')

    const first = await core.exportTo(virtual, dest)
    const second = await core.exportTo(virtual, dest)
    expect(first).toBe(join(dest, 'rosa_v1.txt'))
    expect(second).toBe(join(dest, 'rosa_v1 (1).txt'))
    expect(readFileSync(second, 'utf8')).toBe(readFileSync(first, 'utf8'))

    writeFileSync(join(dest, 'poema.txt'), 'archivo del usuario que no debe perderse')
    const copy = await core.exportTo(join(root, 'poema.txt'), dest)
    expect(copy).toBe(join(dest, 'poema (1).txt'))
    expect(readFileSync(join(dest, 'poema.txt'), 'utf8')).toBe('archivo del usuario que no debe perderse')
  })
})

describe('OuijaCore: todos los tipos de archivo', () => {
  it('conoce imágenes, audios y videos por su nombre y las muestra sin fragmento', async () => {
    put('Logos Hakas/Logo Haka Lens blanco (1).png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    put('Descargas/ElevenLabs_Camila.mp3', Buffer.from('ID3'))
    put('informe.txt', 'Informe de avance sobre las pruebas automáticas de la aplicación durante el mes de octubre.')
    await settings.update({ ocrImages: false })
    await boot()
    await core.indexNow()

    const r = await core.ask('donde tengo el logo de haka lens')
    expect(r.found).toBe(true)
    const logo = r.matches.find((m) => m.name === 'Logo Haka Lens blanco (1).png')
    expect(logo).toMatchObject({ ext: 'png', size: 4, snippet: '' })
  })

  it('la lectura de texto en imágenes es una fase aparte: no ocurre con la opción apagada y sí al encenderla', async () => {
    put('captura.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await settings.update({ ocrImages: false })
    await boot()
    const phases: string[] = []
    core.onState((s) => phases.push(s.phase))

    await core.indexNow()
    expect(phases).not.toContain('reading')

    await core.updateSettings({ ocrImages: true }) // lanza una indexación
    await core.indexNow() // la misma ejecución
    expect(phases).toContain('reading')
    expect(core.getState().phase).toBe('idle')
  })
})

describe('OuijaCore: configuración y privacidad', () => {
  it('quitar una carpeta olvida lo que se indexó de ella, sin tocar los archivos', async () => {
    fill()
    await boot()
    await core.indexNow()
    await core.removeFolder(root)
    expect(settings.value.folders).toEqual([])
    expect((await core.ghosts()).length).toBe(0)
    expect(existsSync(join(root, 'poema.txt'))).toBe(true)
  })

  it('"Olvidar todo" borra índice, personas y copias temporales, y deja las carpetas configuradas', async () => {
    fill()
    await boot()
    await core.indexNow()
    await core.preparePathToOpen(`${join(root, 'respaldo.zip')}::Poemas/rosa_v1.txt`)
    await core.decideNames('merge', 'Rosa', 'Matías')

    await core.forgetAll()

    expect(await core.people()).toEqual([])
    expect(await core.ghosts()).toEqual([])
    expect(existsSync(join(data, 'open'))).toBe(false)
    expect(settings.value.folders).toEqual([root])
    expect(core.getState().phase).toBe('idle')
    expect((await core.ask('poema Rosa')).found).toBe(false)
    expect(existsSync(join(root, 'poema.txt'))).toBe(true) // los archivos del usuario siguen ahí
  })

  it('rechaza un servidor de modelos remoto', async () => {
    await boot()
    await core.updateSettings({ ollamaHost: 'https://api.example.com' })
    expect(settings.value.ollamaHost).toBe('http://127.0.0.1:11434')
    await core.updateSettings({ ollamaHost: 'http://localhost:9999' })
    expect(settings.value.ollamaHost).toBe('http://localhost:9999')
  })
})
