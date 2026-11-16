/// <reference lib="dom" />
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** Cambios en vivo y Patíbulo con una papelera falsa (HOME propio), sin tocar la del usuario. */
let app: ElectronApplication
let page: Page
let root: string
let docs: string
let data: string

const trashFile = (name: string, content: string, original: string, date = '2026-11-01T10:00:00') => {
  const trash = join(root, 'share', 'Trash')
  mkdirSync(join(trash, 'files'), { recursive: true })
  mkdirSync(join(trash, 'info'), { recursive: true })
  writeFileSync(join(trash, 'files', name), content)
  writeFileSync(join(trash, 'info', `${name}.trashinfo`), `[Trash Info]\nPath=${encodeURI(original)}\nDeletionDate=${date}\n`)
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ouija-gallows-'))
  docs = join(root, 'docs')
  data = join(root, 'data')
  mkdirSync(docs, { recursive: true })
  mkdirSync(data, { recursive: true })
  writeFileSync(join(docs, 'base.txt'), 'Documento base que ya existía antes de abrir OUIJA.')
  trashFile('plan.txt', 'Plan de la casa', join(root, 'Documentos', 'plan.txt'))
  trashFile('notas.txt', 'Notas VIEJAS', join(root, 'Documentos', 'notas.txt'), '2026-10-01T10:00:00')
  trashFile('sinorigen.txt', 'sin origen', '', '2026-10-05T10:00:00')
  mkdirSync(join(root, 'Documentos'), { recursive: true })
  writeFileSync(join(root, 'Documentos', 'notas.txt'), 'Notas NUEVAS')
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ folders: [docs], onboarded: true, watchFolders: true, indexOnStart: true, ocrImages: false, lang: 'es' }))
  app = await electron.launch({
    args: [resolve('.'), '--no-sandbox'],
    env: { ...process.env, HOME: root, XDG_DATA_HOME: join(root, 'share'), OUIJA_USER_DATA: data, ELECTRON_RENDERER_URL: '' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})
afterAll(async () => {
  await app?.close().catch(() => undefined)
  rmSync(root, { recursive: true, force: true })
})

describe('cambios en vivo', () => {
  it('un archivo nuevo aparece en "Últimos cambios"', async () => {
    await expect.poll(() => page.evaluate(() => (window as never as { ouija: { indexState(): Promise<{ indexed: number; phase: string }> } }).ouija.indexState().then((s) => s.phase === 'idle' && s.indexed > 0)), { timeout: 60_000 }).toBe(true)
    writeFileSync(join(docs, 'contrato-arriendo.txt'), 'Contrato de arriendo del departamento, firmado en marzo.')
    await expect.poll(() => page.getByTestId('recent-changes').innerText().catch(() => ''), { timeout: 60_000 }).toContain('contrato-arriendo.txt')
    expect(await page.getByTestId('recent-changes').innerText()).toContain('Nuevo')
    expect(await page.getByTestId('recent-changes').innerText()).not.toContain('base.txt')
  })
  it('un archivo eliminado se anota como eliminado', async () => {
    rmSync(join(docs, 'contrato-arriendo.txt'))
    await expect.poll(() => page.getByTestId('recent-changes').innerText().catch(() => ''), { timeout: 60_000 }).toContain('Eliminado')
    await page.screenshot({ path: '/tmp/cambios.png' })
  })
})

describe('Patíbulo y Resurrección', () => {
  it('lista lo que hay en la papelera, con origen y tamaño', async () => {
    await page.getByRole('button', { name: 'Patíbulo', exact: true }).click()
    const list = page.getByTestId('gallows-list')
    await expect.poll(() => list.innerText()).toContain('plan.txt')
    const text = await list.innerText()
    expect(text).toContain('notas.txt')
    expect(text).toContain('Origen desconocido')
    expect(await page.getByTestId('gallows-summary').innerText()).toContain('3 elementos')
    await page.screenshot({ path: '/tmp/patibulo.png' })
  })
  it('resucita a su lugar de origen y deja de estar en la papelera', async () => {
    await page.getByRole('listitem').filter({ hasText: 'plan.txt' }).getByRole('button', { name: 'Resucitar' }).click()
    await page.getByRole('button', { name: 'Resucitar 1 archivo' }).click()
    const result = page.getByTestId('resurrection-result')
    await expect.poll(() => result.innerText()).toContain('Resucitado')
    expect(readFileSync(join(root, 'Documentos', 'plan.txt'), 'utf8')).toBe('Plan de la casa')
    expect(existsSync(join(root, 'share', 'Trash', 'files', 'plan.txt'))).toBe(false)
    await page.screenshot({ path: '/tmp/resurreccion.png' })
  })
  it('nunca sobrescribe: si ya existe uno igual, lo resucita con otro nombre', async () => {
    await page.getByRole('button', { name: /^Condenados$/ }).click()
    await page.getByRole('checkbox', { name: /notas\.txt/ }).check()
    await page.getByRole('button', { name: 'Ir a Resurrección' }).click()
    await page.getByRole('button', { name: 'Resucitar 1 archivo' }).click()
    await expect.poll(() => page.getByTestId('resurrection-result').innerText()).toContain('otro nombre')
    expect(readFileSync(join(root, 'Documentos', 'notas.txt'), 'utf8')).toBe('Notas NUEVAS')
    expect(readFileSync(join(root, 'Documentos', 'notas (resucitado).txt'), 'utf8')).toBe('Notas VIEJAS')
  })
  it('sin origen conocido exige elegir carpeta, y la elegida se respeta', async () => {
    const chosen = join(root, 'elegida')
    mkdirSync(chosen)
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog
    }, chosen)
    await page.getByRole('button', { name: /^Condenados$/ }).click()
    await page.getByRole('checkbox', { name: /sinorigen\.txt/ }).check()
    await page.getByRole('button', { name: 'Ir a Resurrección' }).click()
    expect(await page.getByRole('button', { name: 'Resucitar 1 archivo' }).isDisabled()).toBe(true)
    await page.getByRole('radio', { name: /carpeta que elijo/ }).check()
    await page.getByRole('button', { name: 'Resucitar 1 archivo' }).click()
    await expect.poll(() => page.getByTestId('resurrection-result').innerText()).toContain('Resucitado')
    expect(readFileSync(join(chosen, 'sinorigen.txt'), 'utf8')).toBe('sin origen')
  })
  it('la interfaz no puede mostrar rutas que no resucitó ella', async () => {
    const r = await page.evaluate(() => (window as never as { ouija: { trashReveal(p: string): Promise<void> } }).ouija.trashReveal('/etc/passwd').then(() => 'ok', (e: Error) => e.message))
    expect(r).toMatch(/resucitados/)
  })
  it('rechaza ids inventados', async () => {
    const r = await page.evaluate(() => (window as never as { ouija: { trashRestore(i: string[], d: string): Promise<{ results: { ok: boolean; error?: string }[] }> } }).ouija.trashRestore(['../../etc/passwd'], 'original'))
    expect(r.results[0]).toMatchObject({ ok: false, error: 'not-found' })
  })
})
