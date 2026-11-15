/// <reference lib="dom" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppInfo, IndexState, OllamaStatus } from '../../src/shared/ipc'
import type { SearchAnswer } from '../../src/shared/types'
import { buildZip } from '../helpers/zipBuilder'

/**
 * Prueba la aplicación real: Electron, la paleta, el puente IPC y los modelos locales de Ollama.
 * Requiere `npm run build` y una pantalla disponible. Se ejecuta con `npm run e2e`.
 */
let app: ElectronApplication
let page: Page
let data: string
let docs: string

beforeAll(async () => {
  data = mkdtempSync(join(tmpdir(), 'medium-e2e-data-'))
  docs = mkdtempSync(join(tmpdir(), 'medium-e2e-docs-'))
  writeFileSync(join(docs, 'poema.txt'), 'Poema para Rosa. Tus manos guardan la luz de marzo, y yo, torpe, aprendo a nombrarla despacio.')
  writeFileSync(join(docs, 'contrato.txt'), 'Contrato de arriendo de departamento por doce meses, con renovación automática y pago mensual.')
  mkdirSync(join(docs, 'Respaldos'))
  writeFileSync(join(docs, 'Respaldos', 'viejo.zip'), buildZip([{ name: 'Poemas/rosa_v1.txt', data: 'Para Rosa, primer borrador del poema. Tus manos guardan la luz.' }]))
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ folders: [docs], lang: 'es', watchFolders: false, indexOnStart: false }))

  // Con MEDIUM_E2E_EXECUTABLE se prueba la aplicación ya empaquetada en vez del código fuente.
  const packaged = process.env['MEDIUM_E2E_EXECUTABLE']
  app = await electron.launch({
    ...(packaged ? { executablePath: resolve(packaged), args: ['--no-sandbox'] } : { args: [resolve('.'), '--no-sandbox'] }),
    env: { ...process.env, MEDIUM_USER_DATA: data, ELECTRON_RENDERER_URL: '' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

afterAll(async () => {
  await app?.close().catch(() => undefined)
  rmSync(data, { recursive: true, force: true })
  rmSync(docs, { recursive: true, force: true })
})

const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([name, a]) => (window as unknown as { medium: Record<string, (...x: unknown[]) => unknown> }).medium[name as string](...(a as unknown[])) as unknown, [fn, args]) as Promise<T>

describe('ventana y seguridad', () => {
  it('es una ventana sin marco del sistema, que se puede minimizar y no tapa a las demás', async () => {
    const props = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      return { visible: w.isVisible(), alwaysOnTop: w.isAlwaysOnTop(), resizable: w.isResizable(), minimizable: w.isMinimizable(), title: w.getTitle(), size: w.getSize() }
    })
    expect(props).toMatchObject({ visible: true, alwaysOnTop: false, resizable: false, minimizable: true, title: 'OUIJA', size: [760, 580] })
  })

  it('tiene botones para minimizar y cerrar', async () => {
    expect(await page.getByRole('button', { name: 'Minimizar' }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Cerrar OUIJA' }).count()).toBe(1)
  })

  it('la interfaz no tiene acceso a Node y solo expone la API de OUIJA', async () => {
    const surface = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      ipc: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
      keys: Object.keys((window as unknown as { medium: object }).medium).sort()
    }))
    expect(surface).toMatchObject({ require: 'undefined', process: 'undefined', ipc: 'undefined' })
    expect(surface.keys).toEqual(
      ['addFolder', 'addSuggestedFolder', 'aiConfig', 'aiForgetKey', 'aiListModels', 'aiSave', 'aiValidate', 'appInfo', 'ask', 'cancelIndex', 'decideNames', 'exportFile', 'finishOnboarding', 'forgetAll', 'getSettings', 'ghosts', 'indexNow', 'indexState', 'minimize', 'ollamaStatus', 'onChanges', 'onIndexState', 'onSetupState', 'onShown', 'openFile', 'people', 'quit', 'recentChanges', 'removeFolder', 'setSettings', 'setupCancel', 'setupStart', 'setupState', 'showInFolder', 'suggestFolders', 'timeline', 'trashList', 'trashReveal', 'trashRestore'].sort()
    )
  })

  it('P5: bloquea cualquier conexión a internet desde la interfaz', async () => {
    const results = await page.evaluate(async () => {
      const attempt = async (url: string) => {
        try {
          await fetch(url, { mode: 'no-cors' })
          return 'abierto'
        } catch {
          return 'bloqueado'
        }
      }
      return { example: await attempt('https://example.com/'), ip: await attempt('http://93.184.216.34/'), tracker: await attempt('https://www.google-analytics.com/collect') }
    })
    expect(results).toEqual({ example: 'bloqueado', ip: 'bloqueado', tracker: 'bloqueado' })
  })

  const minimized = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())
  const restore = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())

  it('Esc y el botón "–" minimizan; se puede recuperar', async () => {
    await page.keyboard.press('Escape')
    await expect.poll(minimized).toBe(true)
    await restore()
    await expect.poll(minimized).toBe(false)

    await page.getByRole('button', { name: 'Minimizar' }).click()
    await expect.poll(minimized).toBe(true)
    await restore()
    await expect.poll(minimized).toBe(false)
  })
})

describe('bandeja y atajo', () => {
  it('informa el estado del atajo global y del sistema', async () => {
    const info = await call<AppInfo>('appInfo')
    console.info('appInfo', JSON.stringify(info))
    expect(info.platform).toBe(process.platform)
    expect(['registered', 'unavailable']).toContain(info.shortcut.status)
    expect(info.shortcut.accelerator).toBe('CommandOrControl+Shift+Space')
    expect(info.dataDir).toBe(data)
  })
})

describe('con Ollama real', () => {
  it('indexa la carpeta, informa el progreso y responde preguntas', async () => {
    const status = await call<OllamaStatus>('ollamaStatus')
    expect(status.available).toBe(true)
    expect(status.embedModelInstalled).toBe(true)

    const seen: string[] = []
    await page.exposeFunction('__seen', (phase: string) => seen.push(phase))
    await page.evaluate(() => (window as unknown as { medium: { onIndexState: (cb: (s: { phase: string }) => void) => void } }).medium.onIndexState((s) => void (window as unknown as { __seen: (p: string) => void }).__seen(s.phase)))

    await call('indexNow')
    const deadline = Date.now() + 150_000
    let state = await call<IndexState>('indexState')
    while ((state.phase !== 'idle' || !state.lastRunAt) && Date.now() < deadline) {
      await page.waitForTimeout(500)
      state = await call<IndexState>('indexState')
    }
    expect(state).toMatchObject({ phase: 'idle', errors: 0 })
    expect(seen).toEqual(expect.arrayContaining(['scanning', 'indexing']))

    const r = await call<SearchAnswer>('ask', '¿dónde está el poema para Rosa?')
    console.info(r.answer, r.matches.map((m) => m.path.slice(docs.length + 1)))
    expect(r.found).toBe(true)
    expect(r.matches.map((m) => m.name)).toEqual(expect.arrayContaining(['poema.txt', 'rosa_v1.txt']))
    expect(r.matches.map((m) => m.name)).not.toContain('contrato.txt')
  })

  it('rechaza pedir archivos que no están en el índice', async () => {
    await expect(call('openFile', '/etc/passwd')).rejects.toThrow(/no está en el índice/)
    await expect(call('exportFile', '/etc/hostname')).rejects.toThrow(/no está en el índice/)
  })

  it('rechaza argumentos mal formados', async () => {
    await expect(call('ask', 42)).rejects.toThrow(/inválido/)
    await expect(call('decideNames', 'borrar', 'a', 'b')).rejects.toThrow(/inválido/)
  })

  it('la configuración rechaza un servidor de modelos remoto', async () => {
    const after = await call<{ ollamaHost: string }>('setSettings', { ollamaHost: 'https://api.openai.com' })
    expect(after.ollamaHost).toBe('http://127.0.0.1:11434')
  })

  it('la interfaz muestra los resultados reales en la paleta', async () => {
    await page.locator('input').fill('¿dónde está el poema para Rosa?')
    await page.keyboard.press('Enter')
    await page.getByText('poema.txt').first().waitFor({ timeout: 60_000 })
    await page.screenshot({ path: join(tmpdir(), 'medium-e2e-results.png') })
    expect(await page.getByText('rosa_v1.txt').count()).toBeGreaterThan(0)
  })
})

describe('navegación', () => {
  it('no permite navegar fuera de la aplicación ni abrir ventanas nuevas', async () => {
    const before = page.url()
    await page.evaluate(() => {
      window.open('https://example.com')
      window.location.href = 'https://example.com'
    })
    await page.waitForTimeout(500)
    expect(page.url()).toBe(before)
    expect(app.windows()).toHaveLength(1)
  })
})

describe('salir', () => {
  it('el botón × cierra OUIJA por completo', async () => {
    const closed = new Promise<void>((ok) => app.process().once('exit', () => ok()))
    // Clic desde el DOM: la prueba anterior dejó a Playwright esperando una navegación bloqueada.
    await page.evaluate(() => (document.querySelector('[aria-label="Cerrar OUIJA"]') as HTMLElement).click())
    await closed
    expect(app.process().exitCode).not.toBeNull()
  })
})
