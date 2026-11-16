/// <reference lib="dom" />
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Avisa de una versión nueva publicada en GitHub. La "API de GitHub" es un servidor local. */
let app: ElectronApplication
let page: Page
let api: Server
let data: string
let latest = 'v99.0.0'

beforeAll(async () => {
  api = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ tag_name: latest, html_url: `https://github.com/FelipeFariasAlfaro/OUIJA/releases/tag/${latest}` }))
  })
  await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok))
  data = mkdtempSync(join(tmpdir(), 'medium-update-'))
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ folders: [], onboarded: true, tourDone: true, watchFolders: false, indexOnStart: false, autoUpdate: false, lang: 'es' }))
  app = await electron.launch({
    args: [resolve('.'), '--no-sandbox'],
    env: { ...process.env, MEDIUM_USER_DATA: data, MEDIUM_UPDATE_TEST_API: `http://127.0.0.1:${(api.address() as AddressInfo).port}/latest`, ELECTRON_RENDERER_URL: '' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})
afterAll(async () => {
  await app?.close().catch(() => undefined)
  await new Promise((ok) => api?.close(ok))
  rmSync(data, { recursive: true, force: true })
})

describe('actualizaciones', () => {
  it('detecta una versión nueva en GitHub y la ofrece', async () => {
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click()
    await page.getByRole('button', { name: 'Buscar ahora' }).click()
    const banner = page.getByTestId('update-banner')
    await banner.waitFor({ timeout: 15_000 })
    expect(await banner.innerText()).toContain('OUIJA 99.0.0 ha despertado')
    await page.screenshot({ path: '/tmp/update-banner.png' })
  })
  it('sin instalador que se actualice solo, abre la página de la versión (solo de GitHub de OUIJA)', async () => {
    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { opened: string[] }
      g.opened = []
      shell.openExternal = (async (u: string) => void g.opened.push(u)) as typeof shell.openExternal
    })
    await page.getByTestId('update-banner').getByRole('button', { name: 'Descargar' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual(['https://github.com/FelipeFariasAlfaro/OUIJA/releases/tag/v99.0.0'])
  })
  it('"Más tarde" lo oculta; con la versión instalada al día dice que no hay nada nuevo', async () => {
    await page.getByTestId('update-banner').getByRole('button', { name: 'Más tarde' }).click()
    await expect.poll(() => page.getByTestId('update-banner').count()).toBe(0)
    latest = 'v0.0.1'
    await page.getByRole('button', { name: 'Buscar ahora' }).click()
    await page.getByText('Tienes la última versión.').waitFor()
  })
})
