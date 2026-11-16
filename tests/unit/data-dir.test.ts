import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { existingDataDir, prepareDataDir, resolveDataDir } from '../../src/main/dataDir'

let appData: string
afterEach(() => rmSync(appData, { recursive: true, force: true }))
const fresh = () => (appData = mkdtempSync(join(tmpdir(), 'ouija-appdata-')))

describe('carpeta de datos', () => {
  it('la antigua "medium" pasa a llamarse "ouija" sin perder nada', () => {
    fresh()
    mkdirSync(join(appData, 'medium'))
    writeFileSync(join(appData, 'medium', 'settings.json'), '{"lang":"es"}')
    expect(existingDataDir(appData)).toBe(join(appData, 'medium')) // el MCP no renombra
    expect(prepareDataDir(appData)).toBe(join(appData, 'ouija'))
    expect(readFileSync(join(appData, 'ouija', 'settings.json'), 'utf8')).toBe('{"lang":"es"}')
    expect(existsSync(join(appData, 'medium'))).toBe(false)
    expect(resolveDataDir(join(appData, 'medium'))).toBe(join(appData, 'ouija'))
  })
  it('si ya existe "ouija" no toca nada; si no hay ninguna, usa "ouija"', () => {
    fresh()
    expect(prepareDataDir(appData)).toBe(join(appData, 'ouija'))
    mkdirSync(join(appData, 'ouija'))
    mkdirSync(join(appData, 'medium'))
    expect(prepareDataDir(appData)).toBe(join(appData, 'ouija'))
    expect(existsSync(join(appData, 'medium'))).toBe(true)
  })
})
