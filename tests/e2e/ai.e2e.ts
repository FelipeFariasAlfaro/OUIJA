/// <reference lib="dom" />
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AiConfig } from '../../src/shared/ai'
import type { SearchAnswer } from '../../src/shared/types'

/**
 * Elegir un servicio externo desde la interfaz real. El "proveedor" es un servidor local que imita a
 * Claude: así se prueba todo el flujo (clave, validación, modelos, prueba y guardado) sin una clave real.
 */
const KEY = 'sk-ant-api03-CLAVE-DE-PRUEBA-0123456789'
let app: ElectronApplication
let page: Page
let provider: Server
let data: string
let docs: string
const seen: { method: string; path: string; key: string | undefined; body: string }[] = []

const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([name, a]) => (window as unknown as { medium: Record<string, (...x: unknown[]) => unknown> }).medium[name as string](...(a as unknown[])) as unknown, [fn, args]) as Promise<T>

beforeAll(async () => {
  provider = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const key = req.headers['x-api-key'] as string | undefined
      seen.push({ method: req.method ?? '', path: req.url ?? '', key, body })
      res.setHeader('content-type', 'application/json')
      if (key !== KEY) return res.writeHead(401).end(JSON.stringify({ error: { message: 'invalid x-api-key' } }))
      if (req.url?.startsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }, { id: 'claude-opus-4-1', display_name: 'Claude Opus 4.1' }], has_more: false }))
      const wantsTool = JSON.parse(body).tools !== undefined
      const prompt = JSON.stringify(JSON.parse(body).messages)
      const input = prompt.includes('Convierte la pregunta')
        ? { query: 'poema Rosa', extensions: [], kind: '', dateFrom: null, dateTo: null }
        : prompt.includes('Analiza el texto')
          ? { people: [], places: [], projects: [], summary: 'x' }
          : { ok: true, found: true, relevant: [1], answer: 'Respuesta del servicio externo de prueba.' }
      res.end(JSON.stringify({ content: wantsTool ? [{ type: 'tool_use', name: 'responder', input }] : [{ type: 'text', text: 'ok' }] }))
    })
  })
  await new Promise<void>((ok) => provider.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`

  data = mkdtempSync(join(tmpdir(), 'medium-ai-data-'))
  docs = mkdtempSync(join(tmpdir(), 'medium-ai-docs-'))
  mkdirSync(docs, { recursive: true })
  writeFileSync(join(docs, 'poema.txt'), 'Poema para Rosa. Tus manos guardan la luz de marzo, y yo, torpe, aprendo a nombrarla despacio.')
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ folders: [docs], onboarded: true, watchFolders: false, indexOnStart: false, ocrImages: false, lang: 'es' }))
  app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, MEDIUM_USER_DATA: data, MEDIUM_AI_TEST_BASE: base, ELECTRON_RENDERER_URL: '' } })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})
afterAll(async () => {
  await app?.close().catch(() => undefined)
  await new Promise((ok) => provider?.close(ok))
  rmSync(data, { recursive: true, force: true })
  rmSync(docs, { recursive: true, force: true })
})

const openWizard = async () => {
  await page.getByRole('button', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Cambiar' }).click()
}

describe('modelo de lenguaje externo', () => {
  it('empieza en local', async () => {
    expect(await call<AiConfig>('aiConfig')).toMatchObject({ mode: 'local', hasKey: false })
  })

  it('proveedor → clave → validar → modelos de esa clave → probar y guardar', async () => {
    await openWizard()
    await page.getByRole('radio', { name: /Servicio externo/ }).click()
    await page.getByRole('button', { name: 'Continuar' }).click()

    // Los cuatro proveedores.
    for (const name of ['Claude', 'OpenAI', 'Gemini', 'DeepSeek']) expect(await page.getByRole('radio', { name: new RegExp(name) }).count()).toBe(1)
    await page.getByRole('radio', { name: /Claude/ }).click()
    await page.getByRole('button', { name: 'Continuar' }).click()

    // Una clave inválida no avanza.
    const input = page.getByLabel('Clave de API')
    await input.fill('sk-ant-api03-CLAVE-EQUIVOCADA-9999999999')
    await page.getByRole('button', { name: 'Validar clave' }).click()
    await page.getByRole('alert').getByText('La clave no es válida o fue revocada.').waitFor()
    expect(await page.getByRole('radio', { name: /Haiku/ }).count()).toBe(0)

    // La clave buena muestra los modelos que esa clave puede usar.
    await input.fill(KEY)
    await page.getByRole('button', { name: 'Validar clave' }).click()
    await page.getByText('2 modelos disponibles con tu clave').waitFor()
    expect(await input.count()).toBe(0) // el campo de la clave ya no está
    await page.getByRole('radio', { name: /Opus/ }).click()
    await page.screenshot({ path: join(tmpdir(), 'medium-ai-modelos.png') })
    await page.getByRole('button', { name: 'Probar y guardar' }).click()

    await page.getByText('Usando Claude · claude-opus-4-1').waitFor()
    expect(await call<AiConfig>('aiConfig')).toMatchObject({ mode: 'remote', provider: 'anthropic', model: 'claude-opus-4-1', hasKey: true, remoteDocuments: false })
  })

  it('la clave nunca llega a la interfaz ni queda en claro en disco', async () => {
    const config = JSON.stringify(await call('aiConfig'))
    expect(config).not.toContain('CLAVE-DE-PRUEBA')
    expect(JSON.stringify(await call('getSettings'))).not.toContain('CLAVE-DE-PRUEBA')
    for (const file of readdirSync(data)) {
      if (!statLike(file)) continue
      expect(readFileSync(join(data, file), 'utf8'), file).not.toContain('CLAVE-DE-PRUEBA')
    }
  })

  it('pasa por el puente: la interfaz no puede cambiar el modelo ni las claves por otro camino', async () => {
    await call('setSettings', { ai: { mode: 'remote', provider: 'openai', model: 'gpt-4o', remoteDocuments: true }, onboarded: false })
    expect(await call<AiConfig>('aiConfig')).toMatchObject({ provider: 'anthropic', model: 'claude-opus-4-1', remoteDocuments: false })
    await expect(call('aiValidate', 'otro', KEY)).rejects.toThrow(/inválido/)
  })

  it('las preguntas se responden con el servicio externo y solo viajan fragmentos', async () => {
    await call('indexNow')
    await expect.poll(async () => (await call<{ phase: string; lastRunAt?: number }>('indexState')).lastRunAt, { timeout: 90_000 }).toBeTruthy()
    seen.length = 0

    const r = await call<SearchAnswer>('ask', '¿dónde está el poema para Rosa?')
    expect(r).toMatchObject({ found: true, mode: 'full', answer: 'Respuesta del servicio externo de prueba.' })
    const sent = seen.filter((s) => s.path.startsWith('/messages'))
    expect(sent.length).toBe(2)
    expect(sent.every((s) => s.key === KEY)).toBe(true)
    expect(sent.map((s) => s.body).join(' ')).not.toContain(docs) // sin rutas completas
  })

  it('con el permiso apagado, el texto de los documentos no se envía para reconocer personas', async () => {
    expect(seen.some((s) => s.body.includes('Analiza el texto'))).toBe(false)
  })

  it('si el servicio deja de aceptar la clave, responde en modo ligero y lo dice en pantalla', async () => {
    await app.evaluate(() => undefined)
    // Se simula que la clave fue revocada: el servidor ya no la acepta.
    await page.evaluate(() => undefined)
    provider.removeAllListeners('request')
    provider.on('request', (_req, res) => res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'invalid x-api-key' } })))

    await page.getByRole('button', { name: 'Buscar', exact: true }).click()
    await page.getByPlaceholder(/Pregunta por un archivo/).fill('¿dónde está el poema para Rosa?')
    await page.keyboard.press('Enter')
    await page.getByText('La clave no es válida o fue revocada.').waitFor({ timeout: 30_000 })
    await page.getByText('El servicio externo no respondió').waitFor()
    await page.screenshot({ path: join(tmpdir(), 'medium-ai-problema.png') })
    expect(await page.getByText('poema.txt').count()).toBeGreaterThan(0) // igual encuentra el archivo
  })

  it('se puede volver al modelo local y olvidar la clave', async () => {
    await page.getByRole('button', { name: 'Ajustes' }).click()
    await page.getByRole('button', { name: 'Cambiar' }).click()
    await page.getByRole('radio', { name: /En este equipo/ }).click()
    await page.getByRole('button', { name: 'Usar el modelo local' }).click()
    await page.getByText('Usando el modelo local').waitFor()
    expect(await call<AiConfig>('aiConfig')).toMatchObject({ mode: 'local', keyedProviders: ['anthropic'] })

    await page.getByRole('button', { name: /Quitar la clave de Claude/ }).click()
    await expect.poll(async () => (await call<AiConfig>('aiConfig')).keyedProviders).toEqual([])
  })
})

/** Solo los archivos de texto de la carpeta de datos (la base SQLite y los de Chromium son binarios). */
function statLike(file: string): boolean {
  return /\.(json|txt)$/.test(file)
}
