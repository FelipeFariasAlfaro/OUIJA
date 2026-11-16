/// <reference lib="dom" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Settings } from '../../src/shared/ipc'

/** Primera ejecución: idioma, diapositivas y puesta en marcha, con la aplicación y Ollama reales. */
let app: ElectronApplication
let page: Page
let data: string
let home: string

const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([name, a]) => (window as unknown as { ouija: Record<string, (...x: unknown[]) => unknown> }).ouija[name as string](...(a as unknown[])) as unknown, [fn, args]) as Promise<T>

beforeAll(async () => {
  data = mkdtempSync(join(tmpdir(), 'ouija-ob-data-'))
  home = mkdtempSync(join(tmpdir(), 'ouija-ob-home-'))
  mkdirSync(join(home, 'Documentos'))
  writeFileSync(join(home, 'Documentos', 'carta.txt'), 'Una carta de prueba con suficiente texto para indexar en la bienvenida.')
  app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, OUIJA_USER_DATA: data, HOME: home, ELECTRON_RENDERER_URL: '' } })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})
afterAll(async () => {
  await app?.close().catch(() => undefined)
  rmSync(data, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('bienvenida', () => {
  it('empieza por elegir el idioma, y todo lo que sigue cambia con él', async () => {
    expect(await page.getByRole('heading', { name: /Bienvenido a OUIJA|Welcome to OUIJA/ }).count()).toBe(1)
    await page.getByRole('radio', { name: /English/ }).click()
    await expect.poll(async () => (await call<Settings>('getSettings')).lang).toBe('en')
    expect(await page.getByRole('heading', { name: 'Welcome to OUIJA' }).count()).toBe(1)

    await page.getByRole('radio', { name: /Español/ }).click()
    await expect.poll(async () => (await call<Settings>('getSettings')).lang).toBe('es')
    await page.getByRole('button', { name: 'Continuar' }).click()
  })

  it('las cuatro diapositivas se recorren con los botones, los puntos y el teclado', async () => {
    const titles = ['Pregunta como hablas', 'Resucita lo que parecía perdido', 'Fantasmas y personas', 'Todo se queda en tu equipo']
    await page.getByRole('heading', { name: titles[0] }).waitFor()
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await page.getByRole('heading', { name: titles[1] }).waitFor()
    await page.getByRole('tab', { name: '3' }).click()
    await page.getByRole('heading', { name: titles[2] }).waitFor()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('heading', { name: titles[3] }).waitFor()
    await page.keyboard.press('ArrowLeft')
    await page.getByRole('heading', { name: titles[2] }).waitFor()
    await page.keyboard.press('ArrowRight')
    await page.getByRole('button', { name: 'Continuar' }).click()
  })

  it('pregunta si el modelo de lenguaje será local o de un servicio externo, y se puede decidir después', async () => {
    await page.getByRole('heading', { name: 'Modelo de lenguaje' }).waitFor()
    await page.getByRole('radio', { name: /En este equipo/ }).waitFor()
    expect(await page.getByRole('radio', { name: /En este equipo/ }).count()).toBe(1)
    expect(await page.getByRole('radio', { name: /Servicio externo/ }).count()).toBe(1)
    await page.getByRole('radio', { name: /En este equipo/ }).click()
    await page.getByRole('button', { name: 'Usar el modelo local' }).click()
    await expect.poll(async () => (await call<{ mode: string }>('aiConfig')).mode).toBe('local')
  })

  it('la puesta en marcha detecta lo ya instalado y no vuelve a descargar nada', async () => {
    await page.getByRole('heading', { name: 'Preparando OUIJA' }).waitFor()
    await page.getByText('Listo').first().waitFor({ timeout: 60_000 })
    await expect.poll(async () => (await call<{ ready: boolean }>('setupState')).ready, { timeout: 60_000 }).toBe(true)
    await expect.poll(() => page.getByRole('button', { name: 'Empezar' }).isEnabled(), { timeout: 30_000 }).toBe(true)
  })

  it('ofrece solo las carpetas que existen y se pueden elegir con un clic', async () => {
    await page.getByRole('button', { name: /Documentos/ }).click()
    await expect.poll(async () => (await call<Settings>('getSettings')).folders).toEqual([join(home, 'Documentos')])
    expect(await page.getByRole('button', { name: /Descargas|Downloads/ }).count()).toBe(0)
  })

  it('rechaza agregar una carpeta que no fue sugerida', async () => {
    await expect(call('addSuggestedFolder', '/etc')).rejects.toThrow(/no sugerida/)
  })

  it('"Empezar" termina la bienvenida, abre la búsqueda e indexa la carpeta elegida', async () => {
    await page.getByRole('button', { name: 'Empezar' }).click()
    await page.getByPlaceholder(/Pregunta por un archivo/).waitFor({ timeout: 30_000 })
    expect((await call<Settings>('getSettings')).onboarded).toBe(true)
    await expect.poll(async () => (await call<{ indexed: number; phase: string }>('indexState')).indexed, { timeout: 90_000 }).toBeGreaterThanOrEqual(1)
  })

  it('al terminar, un recorrido guiado señala el contador y cada sección; Esc no minimiza', async () => {
    const tour = page.getByTestId('tour')
    await tour.waitFor({ timeout: 10_000 })
    const titles: string[] = []
    await page.waitForTimeout(700)
    await page.screenshot({ path: '/tmp/tour-first.png' })
    await page.keyboard.press('Escape') // no debe minimizar ni cerrar el recorrido sin guardar: lo salta
    await expect.poll(() => tour.count()).toBe(0)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false)
    await expect.poll(async () => (await call<Settings>('getSettings')).tourDone).toBe(true)
    // Repetirlo desde Ajustes y recorrerlo entero.
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click()
    await page.getByRole('button', { name: 'Repetir el recorrido' }).click()
    await tour.waitFor()
    for (let n = 0; n < 10 && (await tour.count()) > 0; n++) {
      const title = await tour.locator('#tour-title').innerText()
      titles.push(title)
      const last = await tour.getByRole('button', { name: 'Que empiece la sesión' }).count()
      await tour.getByRole('button', { name: last ? 'Que empiece la sesión' : 'Siguiente' }).click()
      // Esperar a que cambie de paso (o se cierre) antes de leer el siguiente.
      await expect.poll(async () => ((await tour.count()) === 0 ? '' : await tour.locator('#tour-title').innerText())).not.toBe(title)
    }
    expect(titles).toEqual(expect.arrayContaining(['Pregúntale a la tabla', 'Fantasmas', 'Personas / Espectros', 'Patíbulo', 'Ajustes', 'Todo queda aquí']))
    expect(await tour.count()).toBe(0)
  })
  it('la próxima vez no vuelve a aparecer', async () => {
    await app.close()
    app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, OUIJA_USER_DATA: data, HOME: home, ELECTRON_RENDERER_URL: '' } })
    page = await app.firstWindow()
    await page.getByPlaceholder(/Pregunta por un archivo/).waitFor({ timeout: 30_000 })
    expect(await page.getByRole('heading', { name: /Bienvenido/ }).count()).toBe(0)
    await page.waitForTimeout(1500)
    expect(await page.getByTestId('tour').count()).toBe(0)
  })
})
