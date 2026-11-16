/// <reference lib="dom" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Settings } from '../../src/shared/ipc'
import type { SearchAnswer } from '../../src/shared/types'

/** El modelo de respuestas puede ser cualquiera: aquí, uno de un "LM Studio" falso en este equipo. */
let app: ElectronApplication
let page: Page
let server: Server
let root: string
const calls: { model: string }[] = []
const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([name, a]) => (window as unknown as { ouija: Record<string, (...x: unknown[]) => unknown> }).ouija[name as string](...(a as unknown[])) as unknown, [fn, args]) as Promise<T>

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fantasma-7b-instruct' }, { id: 'text-embedding-nomic' }] }))
      const parsed = JSON.parse(body) as { model: string; messages: { content: string }[] }
      calls.push({ model: parsed.model })
      const prompt = parsed.messages[0].content
      const content = prompt.includes('Convierte la pregunta')
        ? { query: 'poema Rosa', extensions: [], kind: '', dateFrom: null, dateTo: null }
        : { ok: true, found: true, relevant: [1], answer: 'Respuesta del modelo de LM Studio.' }
      res.end(JSON.stringify({ choices: [{ message: { content: `<think>…</think>${JSON.stringify(content)}` } }] }))
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as AddressInfo).port
  root = mkdtempSync(join(tmpdir(), 'ouija-localsrv-'))
  const docs = join(root, 'docs')
  mkdirSync(docs)
  writeFileSync(join(docs, 'poema.txt'), 'Poema para Rosa. Tus manos guardan la luz de marzo.')
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ folders: [docs], onboarded: true, tourDone: true, watchFolders: false, indexOnStart: true, ocrImages: false, autoUpdate: false, lang: 'es' }))
  app = await electron.launch({
    args: [resolve('.'), '--no-sandbox'],
    env: { ...process.env, OUIJA_USER_DATA: root, OUIJA_TEST_LOCAL_SERVERS: `LM Studio:${port}`, ELECTRON_RENDERER_URL: '' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})
afterAll(async () => {
  await app?.close().catch(() => undefined)
  await new Promise((ok) => server?.close(ok))
  rmSync(root, { recursive: true, force: true })
})

describe('cualquier modelo local', () => {
  it('Ajustes lista los modelos de Ollama y los de otros servidores locales, y se elige uno', async () => {
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click()
    const select = page.getByTestId('local-model').locator('select')
    await expect.poll(() => select.locator('option').allInnerTexts(), { timeout: 15_000 }).toContain('fantasma-7b-instruct')
    expect(await select.locator('option').allInnerTexts()).not.toContain('text-embedding-nomic')
    const value = await select.locator('option', { hasText: 'fantasma-7b-instruct' }).getAttribute('value')
    await select.selectOption(value!)
    await expect.poll(async () => (await call<Settings>('getSettings')).localServer).toMatchObject({ model: 'fantasma-7b-instruct', name: 'LM Studio' })
    await expect.poll(() => page.getByTestId('ai-roles').innerText()).toContain('LM Studio · fantasma-7b-instruct')
    await page.screenshot({ path: '/tmp/local-model.png' })
  })
  it('las respuestas las da ese modelo', async () => {
    await expect.poll(() => call<{ phase: string; indexed: number }>('indexState').then((s) => s.phase === 'idle' && s.indexed > 0), { timeout: 90_000 }).toBe(true)
    const r = await call<SearchAnswer>('ask', '¿dónde está el poema para Rosa?')
    expect(r.answer).toBe('Respuesta del modelo de LM Studio.')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.model === 'fantasma-7b-instruct')).toBe(true)
  })
  it('"Automático" vuelve a Ollama', async () => {
    await page.getByTestId('local-model').locator('select').selectOption('auto')
    await expect.poll(async () => (await call<Settings>('getSettings')).localServer).toBeNull()
  })
})
