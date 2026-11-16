/// <reference lib="dom" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SearchAnswer } from '../../src/shared/types'
import type { KindCount } from '../../src/shared/ipc'

/** Elegir en Ajustes qué tipos de archivo entran en las búsquedas. */
let app: ElectronApplication
let page: Page
let root: string
const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([name, a]) => (window as unknown as { medium: Record<string, (...x: unknown[]) => unknown> }).medium[name as string](...(a as unknown[])) as unknown, [fn, args]) as Promise<T>
const names = async (q: string) => (await call<SearchAnswer>('ask', q)).matches.map((m) => m.name).sort()

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'medium-kinds-'))
  const docs = join(root, 'docs')
  mkdirSync(docs, { recursive: true })
  writeFileSync(join(docs, 'contrato-arriendo.txt'), 'Contrato de arriendo del departamento, firmado en marzo.')
  writeFileSync(join(docs, 'gastos-comunes.csv'), 'concepto,monto\ngastos comunes,45000\nluz,12000\nagua,8000\n')
  mkdirSync(join(root, 'data'))
  writeFileSync(join(root, 'data', 'settings.json'), JSON.stringify({ folders: [docs], onboarded: true, watchFolders: false, indexOnStart: true, ocrImages: false, lang: 'es' }))
  app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, HOME: root, MEDIUM_USER_DATA: join(root, 'data'), ELECTRON_RENDERER_URL: '' } })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  for (let i = 0; i < 180; i++) {
    const st = await call<{ phase: string; indexed: number }>('indexState')
    if (st.phase === 'idle' && st.indexed >= 2) break
    await new Promise((r) => setTimeout(r, 500))
  }
})
afterAll(async () => {
  await app?.close().catch(() => undefined)
  rmSync(root, { recursive: true, force: true })
})

describe('tipos de archivo en las búsquedas', () => {
  it('por defecto incluye todo y Ajustes lista lo que hay', async () => {
    expect((await call<KindCount[]>('fileKinds')).map((k) => k.kind).sort()).toEqual(['spreadsheet', 'text'])
    expect(await names('contrato de arriendo')).toContain('contrato-arriendo.txt')
    expect(await names('planilla de gastos comunes')).toContain('gastos-comunes.csv')
    await page.getByRole('button', { name: 'Ajustes' }).click()
    const list = page.getByTestId('kind-list')
    await expect.poll(() => list.innerText()).toContain('Texto')
    expect(await page.getByRole('checkbox', { name: /Planilla/ }).isChecked()).toBe(true)
  })
  it('desmarcar un tipo lo saca de las búsquedas, sin tocar el índice', async () => {
    await page.getByRole('checkbox', { name: /Planilla/ }).click()
    await expect.poll(() => names('planilla de gastos comunes'), { timeout: 30_000 }).not.toContain('gastos-comunes.csv')
    expect(await names('contrato de arriendo')).toContain('contrato-arriendo.txt')
    await page.screenshot({ path: '/tmp/kinds.png' })
    // El índice sigue intacto: el tipo sigue listado.
    expect((await call<KindCount[]>('fileKinds')).map((k) => k.kind)).toContain('spreadsheet')
    expect((await page.getByText(/1 tipo fuera de las búsquedas/).count())).toBe(1)
  })
  it('"Incluir todos" lo vuelve a traer', async () => {
    await page.getByRole('button', { name: 'Incluir todos' }).click()
    await expect.poll(() => names('planilla de gastos comunes'), { timeout: 30_000 }).toContain('gastos-comunes.csv')
  })
})
