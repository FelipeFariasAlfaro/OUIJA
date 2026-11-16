import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { find7z, openContainer } from '@core/media'
import { parse7zListing } from '../../src/core/media/sevenZip'

const tmp = mkdtempSync(join(tmpdir(), 'ouija-7z-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('7-Zip', () => {
  it('interpreta el listado -slt', () => {
    const blocks = parse7zListing(
      ['Path = d', 'Size = 0', 'Attributes = D drwxr-xr-x', 'Path = d/a.txt', 'Size = 5', 'Encrypted = -', 'Modified = 2026-11-14 17:36:22.9036503'].join('\n')
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[0].folder).toBe(true)
    expect(blocks[1]).toMatchObject({ path: 'd/a.txt', size: 5, encrypted: false })
    expect(blocks[1].mtime).toBeTypeOf('number')
  })

  it('lee un .7z real (si 7z está instalado) sin interpretar comodines', async () => {
    const bin = await find7z()
    if (!bin) return
    writeFileSync(join(tmp, 'a*b.txt'), 'hola')
    writeFileSync(join(tmp, 'c.txt'), 'chao')
    const archive = join(tmp, 't.7z')
    execFileSync(bin, ['a', archive, 'a*b.txt', 'c.txt'], { cwd: tmp, stdio: 'ignore' })

    const c = await openContainer(archive)
    expect(c.errors).toEqual([])
    const byName = new Map(c.entries.map((e) => [e.name, e]))
    expect((await byName.get('a*b.txt')!.read()).toString()).toBe('hola')
    expect((await byName.get('c.txt')!.read()).toString()).toBe('chao')
  })

  it('un .7z inexistente no lanza', async () => {
    const c = await openContainer(join(tmp, 'nada.7z'))
    expect(c.entries).toEqual([])
    expect(c.errors.length).toBeGreaterThan(0)
  })
})
