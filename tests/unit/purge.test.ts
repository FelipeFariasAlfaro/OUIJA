import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { requestExorcism, runPendingExorcism } from '../../src/main/purge'

let dir: string
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const fill = () => {
  dir = mkdtempSync(join(tmpdir(), 'ouija-purge-'))
  writeFileSync(join(dir, 'settings.json'), '{}')
  writeFileSync(join(dir, 'index.sqlite'), 'x')
  mkdirSync(join(dir, 'ollama', 'models'), { recursive: true })
  writeFileSync(join(dir, 'ollama', 'models', 'm.bin'), 'x')
}

describe('exorcismo', () => {
  it('sin pedido no borra nada', () => {
    fill()
    expect(runPendingExorcism(dir)).toBe(false)
    expect(readdirSync(dir).sort()).toEqual(['index.sqlite', 'ollama', 'settings.json'])
  })
  it('conserva el motor si se pidió; si no, borra todo', () => {
    fill()
    requestExorcism(dir, true)
    expect(runPendingExorcism(dir)).toBe(true)
    expect(readdirSync(dir)).toEqual(['ollama'])
    requestExorcism(dir, false)
    runPendingExorcism(dir)
    expect(readdirSync(dir)).toEqual([])
    expect(existsSync(dir)).toBe(true)
  })
})
