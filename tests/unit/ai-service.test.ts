import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AiSettings } from '@shared/ai'
import { AiService } from '../../src/main/core/ai'
import { SecretStore, type SecretCrypto } from '../../src/main/core/secrets'
import { DEFAULT_SETTINGS, SettingsStore } from '../../src/main/core/settings'
import { MediumCore, type ModelClient } from '../../src/main/core/medium'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'

const KEY = 'sk-ant-api03-SECRETO-1234567890'
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a))
const crypto = (available: boolean): SecretCrypto => ({ available: () => available, encrypt: (p) => xor(Buffer.from(p)), decrypt: (d) => xor(d).toString() })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'medium-ai-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SecretStore', () => {
  it('con cifrado disponible, guarda cifrado en disco y lo recupera', async () => {
    const file = join(dir, 'secrets.json')
    const a = new SecretStore(file, crypto(true))
    await a.set('ai:anthropic', KEY)
    expect(a.secure).toBe(true)

    const onDisk = readFileSync(file, 'utf8')
    expect(onDisk).not.toContain(KEY)
    expect(onDisk).not.toContain('SECRETO')

    const b = new SecretStore(file, crypto(true))
    await b.load()
    expect(b.get('ai:anthropic')).toBe(KEY)
    expect(b.ids()).toEqual(['ai:anthropic'])
  })

  it('sin cifrado seguro, la clave vive solo en memoria y nada se escribe a disco', async () => {
    const file = join(dir, 'secrets.json')
    const s = new SecretStore(file, crypto(false))
    await s.set('ai:openai', KEY)
    expect(s.secure).toBe(false)
    expect(s.get('ai:openai')).toBe(KEY)
    expect(existsSync(file)).toBe(false)

    const again = new SecretStore(file, crypto(false))
    await again.load()
    expect(again.get('ai:openai')).toBeUndefined() // se pierde al cerrar: así es más seguro que guardarla en claro
  })

  it('borrar una clave la quita también del archivo; un archivo dañado no rompe nada', async () => {
    const file = join(dir, 'secrets.json')
    const s = new SecretStore(file, crypto(true))
    await s.set('a', 'uno-12345678')
    await s.set('b', 'dos-12345678')
    await s.delete('a')
    const r = new SecretStore(file, crypto(true))
    await r.load()
    expect(r.ids()).toEqual(['b'])

    writeFileSync(file, '{ roto')
    const broken = new SecretStore(file, crypto(true))
    await expect(broken.load()).resolves.toBeUndefined()
    expect(broken.ids()).toEqual([])
  })

  it('el archivo solo lo puede leer el dueño', async () => {
    const file = join(dir, 'secrets.json')
    await new SecretStore(file, crypto(true)).set('a', 'uno-12345678')
    expect((await import('node:fs')).statSync(file).mode & 0o077).toBe(0)
  })
})

/** Un proveedor falso que imita a Anthropic y registra lo que recibe. */
function anthropicFake(options: { validKey?: string; models?: string[]; failComplete?: { status: number; message: string } } = {}) {
  const valid = options.validKey ?? KEY
  const seen: { path: string; key: string | null; body: unknown }[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    const key = headers['x-api-key'] ?? null
    seen.push({ path: url.pathname, key, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (key !== valid) return Response.json({ error: { message: 'invalid x-api-key' } }, { status: 401 })
    if (url.pathname.endsWith('/models')) return Response.json({ data: (options.models ?? ['claude-haiku-4-5', 'claude-opus-4-1']).map((id) => ({ id, display_name: id })), has_more: false })
    if (options.failComplete) return Response.json({ error: { message: options.failComplete.message } }, { status: options.failComplete.status })
    const body = JSON.parse(String(init?.body)) as { tools?: unknown[] }
    return Response.json({ content: body.tools ? [{ type: 'tool_use', name: 'responder', input: { ok: true, found: true, relevant: [1], answer: '', query: 'x', extensions: [], kind: '', dateFrom: null, dateTo: null } }] : [{ type: 'text', text: 'hola' }] })
  }) as typeof fetch
  return { f, seen }
}

function service(fetchFake: typeof fetch, secure = true) {
  const settings = new SettingsStore(join(dir, 'settings.json'))
  const secrets = new SecretStore(join(dir, 'secrets.json'), crypto(secure))
  const ai = new AiService(secrets, () => settings.value, (a: AiSettings) => settings.update({ ai: a }), { fetch: fetchFake })
  return { ai, settings, secrets }
}

describe('AiService: validar, elegir modelo y guardar', () => {
  it('el flujo completo: validar la clave, ver los modelos de esa clave y guardar', async () => {
    const { f, seen } = anthropicFake()
    const { ai, settings, secrets } = service(f)
    await settings.load()

    const v = await ai.validate('anthropic', KEY)
    expect(v).toMatchObject({ ok: true })
    expect(v.ok && v.models.map((m) => m.id)).toEqual(['claude-haiku-4-5', 'claude-opus-4-1'])
    expect(secrets.has('ai:anthropic')).toBe(false) // validar no guarda nada todavía

    const saved = await ai.save({ mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(saved.ok).toBe(true)
    expect(seen.some((s) => s.path.endsWith('/messages'))).toBe(true) // se probó el modelo antes de guardar
    expect(secrets.get('ai:anthropic')).toBe(KEY)
    expect(settings.value.ai).toEqual({ mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5', remoteDocuments: false })
    expect(ai.config()).toMatchObject({ mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5', hasKey: true, keyedProviders: ['anthropic'], secureStorage: true })
    expect(ai.remote()).not.toBeNull()
  })

  it('la clave nunca aparece en la configuración ni en settings.json', async () => {
    const { f } = anthropicFake()
    const { ai, settings } = service(f)
    await settings.load()
    await ai.validate('anthropic', KEY)
    await ai.save({ mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(JSON.stringify(ai.config())).not.toContain('SECRETO')
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).not.toContain('SECRETO')
  })

  it('una clave inválida no avanza y devuelve el motivo', async () => {
    const { f } = anthropicFake()
    const { ai, secrets } = service(f)
    const bad = await ai.validate('anthropic', 'sk-ant-clave-equivocada-123')
    expect(bad).toMatchObject({ ok: false, error: 'invalid-key' })
    expect(await ai.save({ mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5' })).toMatchObject({ ok: false, error: 'missing-key' })
    expect(secrets.ids()).toEqual([])
  })

  it('rechaza claves con formato imposible sin llamar al proveedor', async () => {
    const { f, seen } = anthropicFake()
    const { ai } = service(f)
    for (const bad of ['', 'corta', 'tiene espacios en medio 12345', 'x'.repeat(500)]) expect(await ai.validate('anthropic', bad)).toMatchObject({ ok: false, error: 'invalid-input' })
    expect(await ai.validate('otro' as never, KEY)).toMatchObject({ ok: false, error: 'invalid-input' })
    expect(seen).toEqual([])
  })

  it('si el modelo no responde al probarlo, no se guarda nada', async () => {
    const { f } = anthropicFake({ failComplete: { status: 429, message: 'Your credit balance is too low' } })
    const { ai, settings, secrets } = service(f)
    await settings.load()
    await ai.validate('anthropic', KEY)
    const saved = await ai.save({ mode: 'remote', provider: 'anthropic', model: 'claude-opus-4-1' })
    expect(saved).toMatchObject({ ok: false, error: 'quota' })
    expect(secrets.ids()).toEqual([])
    expect(settings.value.ai.mode).toBe('local')
  })

  it('no deja guardar un modelo que la clave no tiene', async () => {
    const { f } = anthropicFake()
    const { ai, settings } = service(f)
    await settings.load()
    await ai.validate('anthropic', KEY)
    expect(await ai.save({ mode: 'remote', provider: 'anthropic', model: 'modelo-inventado' })).toMatchObject({ ok: false, error: 'model-unavailable' })
  })

  it('cambiar de modelo después usa la clave guardada, sin volver a pedirla', async () => {
    const { f } = anthropicFake()
    const { ai, settings } = service(f)
    await settings.load()
    await ai.validate('anthropic', KEY)
    await ai.save({ mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5' })

    const models = await ai.listModels('anthropic')
    expect(models.ok && models.models).toHaveLength(2)
    const changed = await ai.save({ mode: 'remote', provider: 'anthropic', model: 'claude-opus-4-1', remoteDocuments: true })
    expect(changed.ok).toBe(true)
    expect(settings.value.ai).toMatchObject({ model: 'claude-opus-4-1', remoteDocuments: true })
  })

  it('volver al modelo local conserva la clave para poder regresar; olvidarla la borra', async () => {
    const { f } = anthropicFake()
    const { ai, settings, secrets } = service(f)
    await settings.load()
    await ai.validate('anthropic', KEY)
    await ai.save({ mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5', remoteDocuments: true })

    const local = await ai.save({ mode: 'local' })
    expect(local.ok && local.config).toMatchObject({ mode: 'local', remoteDocuments: false, keyedProviders: ['anthropic'] })
    expect(ai.remote()).toBeNull()
    expect(secrets.has('ai:anthropic')).toBe(true)

    await ai.save({ mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5' }) // usa la clave guardada
    expect(ai.remote()).not.toBeNull()

    const after = await ai.forgetKey('anthropic')
    expect(after).toMatchObject({ mode: 'local', hasKey: false, keyedProviders: [] })
    expect(secrets.ids()).toEqual([])
  })

  it('sin almacén seguro avisa que la clave no se guardará en disco', async () => {
    const { f } = anthropicFake()
    const { ai, settings } = service(f, false)
    await settings.load()
    await ai.validate('anthropic', KEY)
    await ai.save({ mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5' })
    expect(ai.config().secureStorage).toBe(false)
    expect(existsSync(join(dir, 'secrets.json'))).toBe(false)
  })

  it('una validación de otro proveedor no se aprovecha para guardar', async () => {
    const { f } = anthropicFake()
    const { ai, settings } = service(f)
    await settings.load()
    await ai.validate('anthropic', KEY)
    expect(await ai.save({ mode: 'remote', provider: 'openai', model: 'gpt-4o' })).toMatchObject({ ok: false, error: 'missing-key' })
  })

  it('sin la clave guardada (por ejemplo, tras reiniciar sin almacén seguro), no hay modelo remoto', async () => {
    const { f } = anthropicFake()
    const { ai, settings } = service(f, false)
    await settings.load()
    await settings.update({ ai: { mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5', remoteDocuments: false } })
    expect(ai.remote()).toBeNull()
    expect(ai.config()).toMatchObject({ mode: 'remote', hasKey: false })
  })
})

describe('ajustes: el modo remoto exige proveedor y modelo', () => {
  it('sanea valores inválidos', async () => {
    const s = new SettingsStore(join(dir, 'settings.json'))
    await s.load()
    expect((await s.update({ ai: { mode: 'remote', remoteDocuments: true } })).ai).toEqual({ mode: 'local', remoteDocuments: false })
    expect((await s.update({ ai: { mode: 'remote', provider: 'otro' as never, model: 'x', remoteDocuments: true } })).ai.mode).toBe('local')
    expect((await s.update({ ai: { mode: 'remote', provider: 'gemini', model: 'gemini-2.5-flash', remoteDocuments: true } })).ai).toEqual({ mode: 'remote', provider: 'gemini', model: 'gemini-2.5-flash', remoteDocuments: true })
    expect(DEFAULT_SETTINGS.ai).toEqual({ mode: 'local', remoteDocuments: false })
  })
})

// --- Integración con el núcleo -------------------------------------------------

function localClient(chat = true): ModelClient & { prompts: string[]; embedder: FakeEmbedder } {
  const embedder = new FakeEmbedder()
  const prompts: string[] = []
  return {
    prompts,
    embedder,
    embed: (t) => embedder.embed(t),
    probeDimensions: async () => FAKE_DIM,
    listModels: async () => (chat ? ['bge-m3:latest', 'qwen3.5:4b'] : ['bge-m3:latest']),
    async complete(prompt) {
      prompts.push(prompt)
      if (prompt.includes('Analiza el texto')) return JSON.stringify({ people: ['Rosa'], places: [], projects: [], summary: 'Resumen local del documento.' })
      if (prompt.includes('Convierte la pregunta')) return JSON.stringify({ query: 'poema Rosa', extensions: [], kind: '', dateFrom: null, dateTo: null })
      return JSON.stringify({ found: true, relevant: [1], answer: '' })
    }
  }
}

describe('MediumCore con un servicio externo', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'medium-ai-root-'))
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'poema.txt'), 'Poema para Rosa. Tus manos guardan la luz de marzo, y yo aprendo a nombrarla despacio.')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  async function boot(opts: { local?: ReturnType<typeof localClient>; remote: ReturnType<typeof anthropicFake>; remoteDocuments?: boolean; keyInMemory?: boolean; mode?: 'local' | 'remote' }) {
    const settings = new SettingsStore(join(dir, 'settings.json'))
    await settings.load()
    await settings.update({ folders: [root], watchFolders: false, indexOnStart: false, ocrImages: false, onboarded: true })
    const secrets = new SecretStore(join(dir, 'secrets.json'), crypto(true))
    if (opts.keyInMemory !== false) await secrets.set('ai:anthropic', KEY)
    if (opts.mode !== 'local') await settings.update({ ai: { mode: 'remote', provider: 'anthropic', model: 'claude-haiku-4-5', remoteDocuments: opts.remoteDocuments ?? false } })
    const local = opts.local ?? localClient()
    const core = new MediumCore({ dataDir: dir, settings, secrets, createClient: () => local, aiDeps: { fetch: opts.remote.f } })
    await core.init()
    return { core, local }
  }

  it('responde con el servicio externo; los embeddings siguen siendo locales', async () => {
    const remote = anthropicFake()
    const { core, local } = await boot({ remote })
    await core.indexNow()
    remote.seen.length = 0
    local.prompts.length = 0

    const r = await core.ask('¿dónde está el poema para Rosa?')

    expect(r).toMatchObject({ found: true, mode: 'full' })
    expect(r.aiProblem).toBeUndefined()
    expect(remote.seen.filter((s) => s.path.endsWith('/messages'))).toHaveLength(2) // interpretar la pregunta + redactar
    expect(local.prompts).toEqual([]) // el modelo local no se usó para responder
    expect(local.embedder.calls).toBeGreaterThan(0) // pero los vectores se calcularon en el equipo
    await core.close()
  })

  it('al servicio solo viaja la pregunta y fragmentos cortos, no rutas completas ni el contenido entero', async () => {
    const remote = anthropicFake()
    const { core } = await boot({ remote })
    await core.indexNow()
    remote.seen.length = 0
    await core.ask('¿dónde está el poema para Rosa?')

    const sent = JSON.stringify(remote.seen.filter((s) => s.path.endsWith('/messages')).map((s) => s.body))
    expect(sent).toContain('poema.txt')
    expect(sent).not.toContain(root) // sin la ruta completa de tu equipo
    await core.close()
  })

  it('sin permiso para documentos, el texto de los archivos no sale: personas y resúmenes se hacen con el modelo local', async () => {
    const remote = anthropicFake()
    const { core, local } = await boot({ remote, remoteDocuments: false })
    await core.indexNow()
    expect(remote.seen.filter((s) => s.path.endsWith('/messages'))).toEqual([]) // nada de contenido al servicio
    expect(local.prompts.some((p) => p.includes('Analiza el texto'))).toBe(true)
    await core.close()
  })

  it('con permiso explícito, personas y resúmenes se hacen con el servicio externo', async () => {
    const remote = anthropicFake()
    const { core, local } = await boot({ remote, remoteDocuments: true })
    await core.indexNow()
    expect(remote.seen.filter((s) => s.path.endsWith('/messages')).length).toBeGreaterThan(0)
    expect(local.prompts.filter((p) => p.includes('Analiza el texto'))).toEqual([])
    await core.close()
  })

  it('sin permiso y sin modelo local, no se reconocen personas (y no se envía nada)', async () => {
    const remote = anthropicFake()
    const { core } = await boot({ remote, remoteDocuments: false, local: localClient(false) })
    await core.indexNow()
    expect(remote.seen.filter((s) => s.path.endsWith('/messages'))).toEqual([])
    expect(await core.people()).toEqual([])
    await core.close()
  })

  it('si el servicio rechaza la clave, responde en modo ligero y dice por qué', async () => {
    const remote = anthropicFake({ validKey: 'otra-clave-distinta-123' }) // la clave guardada ya no sirve
    const { core } = await boot({ remote })
    await core.indexNow()
    const r = await core.ask('¿dónde está el poema para Rosa?')
    expect(r).toMatchObject({ found: true, mode: 'light', aiProblem: 'invalid-key' })
    await core.close()
  })

  it('sin la clave (modo remoto sin clave), no llama a nadie y responde en modo ligero', async () => {
    const remote = anthropicFake()
    const { core } = await boot({ remote, keyInMemory: false })
    await core.indexNow()
    const r = await core.ask('¿dónde está el poema para Rosa?')
    expect(r.mode).toBe('light')
    expect(remote.seen).toEqual([])
    await core.close()
  })

  it('en modo local no se llama a ningún servicio externo, aunque haya una clave guardada', async () => {
    const remote = anthropicFake()
    const { core } = await boot({ remote, mode: 'local' })
    await core.indexNow()
    await core.ask('¿dónde está el poema para Rosa?')
    expect(remote.seen).toEqual([])
    await core.close()
  })

  it('con un servicio externo no se pide el modelo de respuestas local', async () => {
    const remote = anthropicFake()
    const { core } = await boot({ remote, local: localClient(false) })
    const status = await core.ollamaStatus()
    expect(status.hints).toEqual([])
    expect(status.chatModel).toBeUndefined()
    const setup = await core.setup.check()
    expect(setup.steps.find((s) => s.id === 'chat')).toMatchObject({ status: 'skipped', note: 'remote' })
    await core.close()
  })
})
