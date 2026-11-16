import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitizeSettings, SettingsStore } from '../../src/main/core/settings'
import { asOneOf, asString, isAllowedRequest, isTrustedSender } from '../../src/main/security'
import { registerShortcut } from '../../src/main/shortcut'

const tmp = mkdtempSync(join(tmpdir(), 'ouija-main-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('P5: la interfaz solo puede hablar con el equipo local', () => {
  it('permite archivos propios y localhost', () => {
    for (const ok of ['file:///app/index.html', 'data:image/png;base64,AAAA', 'blob:null/123', 'http://localhost:5173/', 'http://127.0.0.1:11434/api/tags', 'ws://localhost:5173/', 'http://[::1]:11434/']) {
      expect(isAllowedRequest(ok), ok).toBe(true)
    }
  })

  it('bloquea cualquier otro host, protocolo o URL ilegible', () => {
    for (const bad of ['https://example.com', 'http://192.168.1.10:11434', 'http://localhost.evil.com/', 'http://127.0.0.1.nip.io/', 'https://api.openai.com/v1', 'ftp://localhost/', 'wss://tracker.io/', 'javascript:alert(1)', 'no es una url', '']) {
      expect(isAllowedRequest(bad), bad).toBe(false)
    }
  })

  it('propiedad: ningún host que no sea local pasa, con cualquier esquema y puerto', () => {
    const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])
    fc.assert(
      fc.property(fc.constantFrom('http', 'https', 'ws', 'wss'), fc.domain(), fc.integer({ min: 1, max: 65535 }), fc.webPath(), (scheme, host, port, path) => {
        fc.pre(!LOCAL.has(host))
        expect(isAllowedRequest(`${scheme}://${host}:${port}${path}`)).toBe(false)
      }),
      { numRuns: 300 }
    )
  })
})

describe('IPC', () => {
  const appFile = 'file:///opt/ouija/out/renderer/index.html'

  it('solo confía en la página de la aplicación o el servidor de desarrollo declarado', () => {
    expect(isTrustedSender(appFile, appFile)).toBe(true)
    expect(isTrustedSender(`${appFile}#/ajustes`, appFile)).toBe(true)
    expect(isTrustedSender('http://localhost:5173/', appFile, 'http://localhost:5173')).toBe(true)

    expect(isTrustedSender('http://localhost:5173/', appFile)).toBe(false) // sin servidor declarado
    expect(isTrustedSender('http://localhost:5174/', appFile, 'http://localhost:5173')).toBe(false)
    expect(isTrustedSender('file:///tmp/malo.html', appFile)).toBe(false)
    expect(isTrustedSender('https://evil.com/', appFile, 'http://localhost:5173')).toBe(false)
    expect(isTrustedSender('', appFile)).toBe(false)
  })

  it('valida los argumentos', () => {
    expect(asString('hola', 'x')).toBe('hola')
    for (const bad of ['', 42, null, undefined, {}, 'x'.repeat(5000)]) expect(() => asString(bad, 'x')).toThrow(/inválido/)
    expect(asOneOf('merge', ['merge', 'split'] as const, 'd')).toBe('merge')
    expect(() => asOneOf('borrar', ['merge', 'split'] as const, 'd')).toThrow(/inválido/)
  })
})

describe('atajo global', () => {
  it('informa si quedó registrado o no disponible, sin lanzar', () => {
    expect(registerShortcut({ register: () => true, unregister: () => undefined }, 'Ctrl+X', () => undefined)).toEqual({ accelerator: 'Ctrl+X', status: 'registered' })
    expect(registerShortcut({ register: () => false, unregister: () => undefined }, 'Ctrl+X', () => undefined).status).toBe('unavailable')
    expect(
      registerShortcut(
        {
          register: () => {
            throw new Error('acelerador inválido')
          },
          unregister: () => undefined
        },
        '???',
        () => undefined
      ).status
    ).toBe('unavailable')
  })
})

describe('configuración', () => {
  it('valida cada campo y vuelve al valor anterior si es inválido', () => {
    const s = sanitizeSettings({
      folders: ['/home/ana/Docs', 'relativa', 42, '/home/ana/Docs'],
      staleYears: 999,
      lang: 'klingon',
      shortcut: '',
      ollamaHost: 'https://remoto.com',
      embedDimensions: -5,
      indexOnStart: 'sí'
    })
    expect(s.folders).toEqual(['/home/ana/Docs'])
    expect(s.staleYears).toBe(DEFAULT_SETTINGS.staleYears)
    expect(s.lang).toBe('es')
    for (const lang of ['pt', 'fr', 'ja', 'zh']) expect(sanitizeSettings({ lang }).lang).toBe(lang)
    expect(s.shortcut).toBe(DEFAULT_SETTINGS.shortcut)
    expect(s.ollamaHost).toBe(DEFAULT_SETTINGS.ollamaHost)
    expect(s.embedDimensions).toBe(DEFAULT_SETTINGS.embedDimensions)
    expect(s.indexOnStart).toBe(true)
  })

  it('acepta valores válidos y nunca lanza con basura', () => {
    expect(sanitizeSettings({ lang: 'en', staleYears: 5, ollamaHost: 'http://localhost:11500' })).toMatchObject({ lang: 'en', staleYears: 5, ollamaHost: 'http://localhost:11500' })
    fc.assert(fc.property(fc.anything(), (raw) => typeof sanitizeSettings(raw) === 'object'), { numRuns: 300 })
  })

  it('se guarda y se recarga; un archivo dañado vuelve a los valores por defecto', async () => {
    const file = join(tmp, 'ajustes', 'settings.json')
    const store = new SettingsStore(file)
    await store.load()
    await store.update({ lang: 'en', folders: ['/home/ana/Docs'] })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ lang: 'en', folders: ['/home/ana/Docs'] })

    const again = new SettingsStore(file)
    expect((await again.load()).lang).toBe('en')

    writeFileSync(file, '{ esto no es json')
    expect(await new SettingsStore(file).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('el valor expuesto no permite modificar el estado interno', async () => {
    const store = new SettingsStore(join(tmp, 'otro', 'settings.json'))
    await store.load()
    store.value.folders.push('/x')
    expect(store.value.folders).toEqual([])
  })
})
describe('tipos excluidos de las búsquedas', () => {
  it('por defecto no excluye nada y solo acepta tipos válidos, sin repetidos', () => {
    expect(DEFAULT_SETTINGS.excludedKinds).toEqual([])
    expect(sanitizeSettings({ excludedKinds: ['audio', 'audio', 'video', 'inventado', 7] }).excludedKinds).toEqual(['audio', 'video'])
    expect(sanitizeSettings({ excludedKinds: 'audio' }).excludedKinds).toEqual([])
    expect(sanitizeSettings({}, { ...DEFAULT_SETTINGS, excludedKinds: ['audio'] }).excludedKinds).toEqual(['audio'])
  })
})
describe('recorrido guiado', () => {
  it('lo ve quien termina la bienvenida, no quien ya usaba la app', async () => {
    expect(DEFAULT_SETTINGS.tourDone).toBe(false)
    const fresh = join(tmp, 'tour-nuevo.json')
    writeFileSync(fresh, JSON.stringify({ onboarded: false }))
    expect((await new SettingsStore(fresh).load()).tourDone).toBe(false)
    const old = join(tmp, 'tour-antiguo.json')
    writeFileSync(old, JSON.stringify({ onboarded: true, folders: ['/home/ana'] }))
    expect((await new SettingsStore(old).load()).tourDone).toBe(true)
    const pending = join(tmp, 'tour-pendiente.json')
    writeFileSync(pending, JSON.stringify({ onboarded: true, tourDone: false }))
    expect((await new SettingsStore(pending).load()).tourDone).toBe(false)
  })
})
