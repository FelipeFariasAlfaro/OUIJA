/// <reference lib="dom" />
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'

/** Exorcismo: borra los datos de OUIJA y la reabre desde la bienvenida; los archivos del usuario no se tocan. */
let app: ElectronApplication | undefined
const root = mkdtempSync(join(tmpdir(), 'ouija-exorcism-'))
const data = join(root, 'data')
const docs = join(root, 'docs')
const launch = () => electron.launch({ args: [resolve('.'), '--no-sandbox'], env: { ...process.env, OUIJA_USER_DATA: data, ELECTRON_RENDERER_URL: '' } })

afterAll(async () => {
  await app?.close().catch(() => undefined)
  rmSync(root, { recursive: true, force: true })
})

describe('exorcismo', () => {
  it('pide confirmación, cierra, y al volver a abrir todo está limpio salvo el motor de IA', async () => {
    mkdirSync(docs, { recursive: true })
    writeFileSync(join(docs, 'carta.txt'), 'Una carta que nunca debe borrarse.')
    mkdirSync(join(data, 'ollama', 'models'), { recursive: true })
    writeFileSync(join(data, 'ollama', 'models', 'modelo.bin'), 'pesado')
    writeFileSync(join(data, 'settings.json'), JSON.stringify({ folders: [docs], onboarded: true, tourDone: true, watchFolders: false, indexOnStart: true, autoUpdate: false, lang: 'es' }))
    app = await launch()
    let page = await app.firstWindow()
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click()
    await page.getByRole('button', { name: /Exorcizar OUIJA/ }).click()
    const modal = page.getByTestId('exorcism')
    await modal.waitFor()
    expect(await modal.innerText()).toContain('Tus documentos, fotos y respaldos no se tocan.')
    await page.waitForTimeout(400)
    await page.screenshot({ path: '/tmp/exorcism.png' })
    // Cancelar no hace nada.
    await modal.getByRole('button', { name: 'Cancelar' }).click()
    await expect.poll(() => modal.count()).toBe(0)
    await page.getByRole('button', { name: /Exorcizar OUIJA/ }).click()
    // En la prueba no se relanza sola: la volvemos a abrir nosotros.
    await app.evaluate(({ app: a }) => {
      a.relaunch = () => undefined
    })
    const closed = new Promise<void>((ok) => app!.once('close', () => ok()))
    await page.getByTestId('exorcism').getByRole('button', { name: 'Sí, exorcizar' }).click()
    await closed
    app = await launch()
    page = await app.firstWindow()
    await page.getByRole('heading', { name: /Bienvenido a OUIJA/ }).waitFor({ timeout: 20_000 })
    expect(existsSync(join(data, 'ollama', 'models', 'modelo.bin'))).toBe(true)
    // La configuración empezó de cero: sin carpetas y sin bienvenida vista.
    const settings = existsSync(join(data, 'settings.json')) ? (JSON.parse(readFileSync(join(data, 'settings.json'), 'utf8')) as { folders?: string[]; onboarded?: boolean }) : {}
    expect(settings.folders ?? []).toEqual([])
    expect(settings.onboarded ?? false).toBe(false)
    expect(existsSync(join(docs, 'carta.txt'))).toBe(true)
    expect(readdirSync(data)).not.toContain('.ouija-exorcism')
  })
})
