/// <reference lib="dom" />
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { IndexState } from '../../src/shared/ipc'
import type { SearchAnswer } from '../../src/shared/types'

/** El flujo de la demo sobre `fixtures/chaos/`, con la aplicación y Ollama reales. */
let app: ElectronApplication
let page: Page
let data: string
const chaos = resolve('fixtures/chaos')

const call = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([name, a]) => (window as unknown as { medium: Record<string, (...x: unknown[]) => unknown> }).medium[name as string](...(a as unknown[])) as unknown, [fn, args]) as Promise<T>

const names = (r: SearchAnswer) => r.matches.map((m) => m.name)

beforeAll(async () => {
  execFileSync('node', ['scripts/make-fixtures.mjs'])
  data = mkdtempSync(join(tmpdir(), 'medium-demo-'))
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ folders: [chaos], watchFolders: false, indexOnStart: false, ocrImages: false }))
  app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, MEDIUM_USER_DATA: data, ELECTRON_RENDERER_URL: '' } })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await call('indexNow')
  const deadline = Date.now() + 150_000
  let state = await call<IndexState>('indexState')
  while ((state.phase !== 'idle' || !state.lastRunAt) && Date.now() < deadline) {
    await page.waitForTimeout(500)
    state = await call<IndexState>('indexState')
  }
  expect(state).toMatchObject({ phase: 'idle' })
})

afterAll(async () => {
  await app?.close().catch(() => undefined)
  rmSync(data, { recursive: true, force: true })
})

describe('demo: carpeta caótica', () => {
  it('"el poema para Rosa" aparece en el documento actual y en su versión de 2008 dentro del respaldo', async () => {
    const r = await call<SearchAnswer>('ask', '¿dónde está el poema para Rosa?')
    expect(r.found).toBe(true)
    expect(names(r)).toEqual(expect.arrayContaining(['borrador_final3.rtf', 'rosa_v1.txt']))
    const old = r.matches.find((m) => m.name === 'rosa_v1.txt')!
    expect(old).toMatchObject({ resurrected: true, container: join(chaos, 'Respaldos/escritorio-2008.zip') })
    expect(names(r)).not.toContain('receta_torta.txt')
  })

  it('un archivo con texto dañado (mojibake) se repara y se encuentra', async () => {
    const r = await call<SearchAnswer>('ask', 'diario del viaje a Cusco y Arequipa')
    const diary = r.matches.find((m) => m.name === 'diario_viaje_peru.txt')
    expect(diary).toBeDefined()
    expect(diary).toMatchObject({ resurrected: true })
    expect(diary!.snippet).toContain('negó')
  })

  it('un WordPerfect que ningún programa abre se rescata de sus bytes', async () => {
    const r = await call<SearchAnswer>('ask', 'agradecimientos de la tesis a Rosa Campos y al doctor Salinas')
    const thesis = r.matches.find((m) => m.name === 'tesis_borrador_v2.wpd')
    expect(thesis).toMatchObject({ resurrected: true })
    expect(thesis!.confidence).not.toBe('high')
    expect(thesis!.snippet).toContain('capítulo')
  })

  it('"el logo de haka lens" encuentra una imagen que solo se conoce por su nombre', async () => {
    const r = await call<SearchAnswer>('ask', 'donde tengo el logo de haka lens')
    expect(r.matches[0]).toMatchObject({ name: 'Logo Haka Lens blanco (1).png', snippet: '' })
  })

  it('"audios de camila" solo trae audios', async () => {
    const r = await call<SearchAnswer>('ask', 'audios de camila')
    expect(names(r)).toEqual(['ElevenLabs_2026-11-13T22_56_23_Camila_pvc.mp3'])
  })

  it('pregunta por algo que no existe: lo dice y no inventa archivos', async () => {
    const r = await call<SearchAnswer>('ask', '¿a qué hora es mi cita con el dentista?')
    expect(r).toMatchObject({ found: false, matches: [] })
  })

  it('los fantasmas incluyen lo rescatado del respaldo de 2008', async () => {
    const ghosts = await call<{ name: string; container?: string }[]>('ghosts')
    expect(ghosts.map((g) => g.name)).toEqual(expect.arrayContaining(['rosa_v1.txt', 'tesis_borrador_v2.wpd', 'diario_viaje_peru.txt']))
  })

  it('la paleta muestra la respuesta con los dos poemas', async () => {
    await page.getByRole('button', { name: 'Buscar', exact: true }).click() // sea cual sea la vista activa
    await page.locator('input').fill('¿dónde está el poema para Rosa?')
    await page.keyboard.press('Enter')
    await page.getByText('rosa_v1.txt').first().waitFor({ timeout: 60_000 })
    await page.screenshot({ path: join(tmpdir(), 'medium-demo-poema.png') })
    expect(await page.getByText('Resucitado').count()).toBeGreaterThan(0)
  })
})
