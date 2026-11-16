/// <reference lib="dom" />
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  page.evaluate(([name, a]) => (window as unknown as { ouija: Record<string, (...x: unknown[]) => unknown> }).ouija[name as string](...(a as unknown[])) as unknown, [fn, args]) as Promise<T>

const names = (r: SearchAnswer) => r.matches.map((m) => m.name)

beforeAll(async () => {
  execFileSync('node', ['scripts/make-fixtures.mjs'])
  data = mkdtempSync(join(tmpdir(), 'ouija-demo-'))
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ folders: [chaos], watchFolders: false, indexOnStart: false, ocrImages: false }))
  app = await electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, OUIJA_USER_DATA: data, ELECTRON_RENDERER_URL: '' } })
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
    await page.getByRole('button', { name: 'Invocar', exact: true }).click() // sea cual sea la vista activa
    await page.locator('input').fill('¿dónde está el poema para Rosa?')
    await page.keyboard.press('Enter')
    await page.getByRole('listitem').filter({ hasText: 'rosa_v1.txt' }).first().waitFor({ timeout: 60_000 })
    await page.getByText('Resucitado').first().waitFor({ timeout: 10_000 })
    await page.screenshot({ path: join(tmpdir(), 'ouija-demo-poema.png') })
    // La X borra la pregunta y la respuesta, y deja el cursor listo para otra.
    await page.getByRole('button', { name: 'Borrar la pregunta' }).click()
    expect(await page.locator('input').inputValue()).toBe('')
    expect(await page.getByText('rosa_v1.txt').count()).toBe(0)
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')
  })
  it('Personas / Espectros: busca por nombre y abre la ubicación de los archivos que la mencionan', async () => {
    await expect.poll(() => call<{ name: string }[]>('people').then((p) => p.some((x) => /rosa/i.test(x.name))), { timeout: 240_000, interval: 2000 }).toBe(true)
    // Que "Mostrar carpeta" no abra de verdad el explorador durante la prueba.
    await app.evaluate(({ shell }) => {
      const g = globalThis as unknown as { revealed: string[] }
      g.revealed = []
      shell.showItemInFolder = (p: string) => void g.revealed.push(p)
    })
    await page.getByRole('button', { name: 'Personas', exact: true }).click()
    await page.getByRole('heading', { name: 'Personas / Espectros' }).waitFor()
    await page.getByRole('textbox', { name: 'Buscar un nombre…' }).fill('ROSA')
    const list = page.getByTestId('people-list')
    await expect.poll(() => list.innerText()).toMatch(/Rosa/)
    expect(await list.innerText()).not.toMatch(/Salinas/)
    await list.getByRole('button').first().click()
    const files = page.getByTestId('person-files')
    await expect.poll(() => files.getByRole('button', { name: /Mostrar/ }).count()).toBeGreaterThan(0)
    await page.screenshot({ path: '/tmp/espectros.png' })
    await files.getByRole('button', { name: /Mostrar/ }).first().click()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { revealed: string[] }).revealed.length)).toBe(1)
    const revealed = await app.evaluate(() => (globalThis as unknown as { revealed: string[] }).revealed[0])
    expect(revealed.startsWith(chaos)).toBe(true)
  }, 300_000)
  it('MCP: un agente pregunta por stdio, con la app abierta, y lee el WordPerfect resucitado', async () => {
    const config = JSON.parse(await call<string>('mcpConfig')) as { mcpServers: { ouija: { command: string; args: string[]; env: Record<string, string> } } }
    const server = config.mcpServers.ouija
    expect(server.env.OUIJA_DATA_DIR).toBe(data)
    const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'inherit'] })
    const lines = createInterface({ input: child.stdout! })
    const replies = new Map<number, Record<string, unknown>>()
    lines.on('line', (l) => {
      const msg = JSON.parse(l) as { id: number }
      replies.set(msg.id, msg)
    })
    const send = (m: object) => child.stdin!.write(`${JSON.stringify(m)}\n`)
    const reply = async (id: number) => {
      await expect.poll(() => replies.has(id), { timeout: 60_000 }).toBe(true)
      return replies.get(id) as { result: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean } }
    }
    try {
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } })
      expect((await reply(1)).result).toMatchObject({ serverInfo: { name: 'ouija' } })
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      expect((await reply(2)).result.tools!.map((t) => t.name)).toEqual(['ask_ouija', 'read_resurrected', 'list_ghosts', 'find_person', 'recent_changes'])
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask_ouija', arguments: { question: 'agradecimientos de la tesis a Rosa Campos' } } })
      const found = JSON.parse((await reply(3)).result.content![0].text) as { files: { name: string; path: string }[] }
      const wpd = found.files.find((f) => f.name === 'tesis_borrador_v2.wpd')
      expect(wpd, JSON.stringify(found.files.map((f) => f.name))).toBeDefined()
      send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_resurrected', arguments: { path: wpd!.path } } })
      const read = JSON.parse((await reply(4)).result.content![0].text) as { text: string; resurrected: boolean }
      expect(read.text).toMatch(/Rosa/)
      // Solo lo que está en el índice: nada de rutas arbitrarias.
      send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_resurrected', arguments: { path: '/etc/passwd' } } })
      expect((await reply(5)).result.isError).toBe(true)
    } finally {
      child.stdin!.end()
      await new Promise((ok) => child.once('exit', ok))
    }
  }, 120_000)
  it('"Traer al presente": el WordPerfect de 2008 queda como un archivo de hoy, sin tocar el original', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ouija-present-'))
    await app.evaluate(({ dialog, shell }, dir) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
      shell.showItemInFolder = () => undefined
    }, out)
    const r = await call<SearchAnswer>('ask', 'agradecimientos de la tesis a Rosa Campos y al doctor Salinas')
    const wpd = r.matches.find((m) => m.name === 'tesis_borrador_v2.wpd')!
    const res = await call<{ savedTo: string; format: string }>('bringToPresent', wpd.path)
    expect(['docx', 'md']).toContain(res.format)
    expect(res.savedTo.startsWith(out)).toBe(true)
    if (res.format === 'md') expect(readFileSync(res.savedTo, 'utf8')).toMatch(/Rosa/)
    else expect(readFileSync(res.savedTo).subarray(0, 2).toString()).toBe('PK')
    // Una segunda vez no sobrescribe: crea otro archivo.
    const again = await call<{ savedTo: string }>('bringToPresent', wpd.path)
    expect(again.savedTo).not.toBe(res.savedTo)
    rmSync(out, { recursive: true, force: true })
  })
  it('Invocar con filtros: solo los tipos elegidos, y la pregunta se repite al cambiarlos', async () => {
    await page.getByRole('button', { name: 'Invocar', exact: true }).click()
    await page.locator('input').first().fill('Rosa')
    await page.keyboard.press('Enter')
    await page.getByRole('listitem').filter({ hasText: 'rosa_v1.txt' }).first().waitFor({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Filtros' }).click()
    const filters = page.getByTestId('search-filters')
    await filters.getByRole('button', { name: /^Documento/ }).click()
    await expect.poll(() => page.getByRole('button', { name: '1 filtro activo' }).count()).toBe(1)
    // El poema en RTF (documento) sigue; el borrador en TXT (texto) desaparece.
    await page.getByRole('listitem').filter({ hasText: 'borrador_final3.rtf' }).first().waitFor({ timeout: 60_000 })
    await expect.poll(() => page.getByRole('listitem').filter({ hasText: 'rosa_v1.txt' }).count(), { timeout: 60_000 }).toBe(0)
    await page.screenshot({ path: '/tmp/search-filters.png' })
    // Directo por la API: solo audios.
    const audio = await call<SearchAnswer>('ask', 'camila', { kinds: ['audio'] })
    expect(audio.matches.length).toBeGreaterThan(0)
    expect(audio.matches.every((m) => ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'opus'].includes(m.ext))).toBe(true)
    await filters.getByRole('button', { name: 'Quitar filtros' }).click()
    await page.getByRole('button', { name: 'Filtros' }).click()
  }, 180_000)
  it('Fantasmas: se buscan por texto y se filtran por tipo de archivo', async () => {
    await page.getByRole('button', { name: 'Fantasmas', exact: true }).click()
    const list = page.getByTestId('ghost-list')
    await expect.poll(() => list.innerText()).toContain('tesis_borrador_v2.wpd')
    await page.getByRole('textbox', { name: 'Buscar entre los fantasmas…' }).fill('TESIS')
    await expect.poll(() => list.getByRole('button').count()).toBe(1)
    expect(await list.innerText()).toContain('tesis_borrador_v2.wpd')
    await page.getByRole('textbox', { name: 'Buscar entre los fantasmas…' }).fill('')
    await page.getByTestId('ghost-kinds').getByRole('button', { name: /^Imagen/ }).click()
    await expect.poll(async () => (await list.innerText()).includes('viaje_peru_2011.jpg') && !(await list.innerText()).includes('rosa_v1.txt')).toBe(true)
    await page.screenshot({ path: '/tmp/ghost-filters.png' })
  })
})
