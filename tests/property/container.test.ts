import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { bufferSource, openContainer, readZip } from '@core/media'
import { buildZip } from '../helpers/zipBuilder'

const tmp = mkdtempSync(join(tmpdir(), 'medium-prop-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const item = fc.record({
  name: fc.stringMatching(/^[a-z]{1,8}(\/[a-z]{1,8}){0,2}\.(txt|doc|md)$/),
  data: fc.uint8Array({ maxLength: 300 }).map((a) => Buffer.from(a)),
  method: fc.constantFrom('store' as const, 'deflate' as const)
})
const validZip = fc.array(item, { minLength: 1, maxLength: 5 }).map((items) => buildZip(items))

/** Aplica daños aleatorios: bytes cambiados y/o truncado. */
const corrupted = fc
  .tuple(validZip, fc.array(fc.tuple(fc.nat(), fc.nat(255)), { maxLength: 8 }), fc.option(fc.nat(), { nil: undefined }))
  .map(([zip, flips, cut]) => {
    const copy = Buffer.from(zip)
    for (const [i, v] of flips) if (copy.length > 0) copy[i % copy.length] = v
    return cut === undefined ? copy : copy.subarray(0, cut % (copy.length + 1))
  })

describe('P7: el lector nunca lanza ante ZIP corruptos', () => {
  it('readZip devuelve entradas legibles y errores, y read() solo rechaza con Error', async () => {
    await fc.assert(
      fc.asyncProperty(corrupted, async (bytes) => {
        const c = await readZip(bufferSource(bytes))
        expect(Array.isArray(c.entries)).toBe(true)
        expect(Array.isArray(c.errors)).toBe(true)
        for (const entry of c.entries) {
          try {
            const data = await entry.read()
            expect(Buffer.isBuffer(data)).toBe(true)
          } catch (error) {
            expect(error).toBeInstanceOf(Error)
          }
        }
      }),
      { numRuns: 300 }
    )
  })

  it('un ZIP válido devuelve exactamente su contenido', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(item, { minLength: 1, maxLength: 5 }).map((items) => {
          const seen = new Set<string>()
          return items.filter((i) => !seen.has(i.name) && seen.add(i.name))
        }),
        async (items) => {
          const c = await readZip(bufferSource(buildZip(items)))
          expect(c.errors).toEqual([])
          expect(c.entries.map((e) => e.name)).toEqual(items.map((i) => i.name))
          for (const [i, entry] of c.entries.entries()) {
            expect((await entry.read()).equals(items[i].data)).toBe(true)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

describe('P4: abrir y leer un contenedor no modifica el original', () => {
  it('el hash del archivo es igual antes y después', async () => {
    let n = 0
    await fc.assert(
      fc.asyncProperty(corrupted, async (bytes) => {
        const file = join(tmp, `c-${n++}.zip`)
        writeFileSync(file, bytes)
        const before = createHash('sha256').update(readFileSync(file)).digest('hex')
        const c = await openContainer(file)
        for (const entry of c.entries) await entry.read().catch(() => undefined)
        const after = createHash('sha256').update(readFileSync(file)).digest('hex')
        expect(after).toBe(before)
      }),
      { numRuns: 60 }
    )
  })
})
