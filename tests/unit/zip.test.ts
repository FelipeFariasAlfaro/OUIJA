import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { bufferSource, openContainer, readZip } from '@core/media'
import { buildZip } from '../helpers/zipBuilder'

const tmp = mkdtempSync(join(tmpdir(), 'ouija-zip-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const read = async (buf: Buffer) => readZip(bufferSource(buf))

describe('lector ZIP', () => {
  it('lista y lee entradas stored y deflate', async () => {
    const zip = buildZip([
      { name: 'poema.txt', data: 'Rosa, tus ojos', method: 'deflate' },
      { name: 'carpeta/nota.md', data: 'hola', method: 'store' }
    ])
    const c = await read(zip)
    expect(c.recovered).toBe(false)
    expect(c.errors).toEqual([])
    expect(c.entries.map((e) => e.name)).toEqual(['poema.txt', 'carpeta/nota.md'])
    expect((await c.entries[0].read()).toString()).toBe('Rosa, tus ojos')
    expect((await c.entries[1].read()).toString()).toBe('hola')
    expect(c.entries[0].mtime).toBe(new Date(2010, 0, 1, 0, 0, 0).getTime())
  })

  it('decodifica nombres UTF-8', async () => {
    const c = await read(buildZip([{ name: 'canción.txt', data: 'x' }]))
    expect(c.entries[0].name).toBe('canción.txt')
  })

  it('rechaza nombres con ".." y avisa', async () => {
    const c = await read(buildZip([{ name: '../../etc/passwd', data: 'x' }, { name: 'ok.txt', data: 'y' }]))
    expect(c.entries.map((e) => e.name)).toEqual(['ok.txt'])
    expect(c.errors).toHaveLength(1)
  })

  it('detecta contenido dañado por CRC', async () => {
    const zip = buildZip([{ name: 'a.txt', data: 'contenido original', method: 'store' }])
    const at = zip.indexOf('contenido original')
    zip[at] ^= 0xff
    const c = await read(zip)
    await expect(c.entries[0].read()).rejects.toThrow(/CRC/)
  })

  it('rescata entradas si falta el directorio central', async () => {
    const zip = buildZip([
      { name: 'a.txt', data: 'uno uno uno' },
      { name: 'b.txt', data: 'dos dos dos', method: 'store' }
    ])
    const cut = zip.subarray(0, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])))
    const c = await read(cut)
    expect(c.recovered).toBe(true)
    expect(c.entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt'])
    expect((await c.entries[0].read()).toString()).toBe('uno uno uno')
    expect((await c.entries[1].read()).toString()).toBe('dos dos dos')
  })

  it('un archivo que no es ZIP no lanza', async () => {
    const c = await read(Buffer.from('esto no es un zip'))
    expect(c.entries).toEqual([])
    expect(c.errors.length).toBeGreaterThan(0)
  })

  it('lee un ZIP real creado por la herramienta `zip`, también sin directorio central', async () => {
    let hasZip = true
    try {
      execFileSync('zip', ['-v'], { stdio: 'ignore' })
    } catch {
      hasZip = false
    }
    if (!hasZip) return

    const dir = mkdtempSync(join(tmp, 'real-'))
    writeFileSync(join(dir, 'carta.txt'), 'Querida Rosa '.repeat(50))
    // `zip -` escribe a stdout y usa descriptores de datos (bit 3), como muchos ZIP en streaming.
    const streamed = execFileSync('sh', ['-c', 'zip -q -r - carta.txt'], { cwd: dir, maxBuffer: 1 << 20 })

    const full = await read(streamed)
    expect(full.errors).toEqual([])
    expect((await full.entries[0].read()).toString()).toBe('Querida Rosa '.repeat(50))

    const cut = streamed.subarray(0, streamed.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])))
    const salvaged = await read(cut)
    expect(salvaged.recovered).toBe(true)
    expect((await salvaged.entries[0].read()).toString()).toBe('Querida Rosa '.repeat(50))
  })

  it('openContainer abre un ZIP en disco y no lanza con rutas inexistentes', async () => {
    const file = join(tmp, 'r.zip')
    writeFileSync(file, buildZip([{ name: 'x.txt', data: 'hola' }]))
    const ok = await openContainer(file)
    expect(ok.entries[0].name).toBe('x.txt')

    const missing = await openContainer(join(tmp, 'no-existe.zip'))
    expect(missing.entries).toEqual([])
    expect(missing.errors.length).toBeGreaterThan(0)
  })
})
