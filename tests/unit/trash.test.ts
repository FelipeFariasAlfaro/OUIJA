import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeTrashPath, freeName, moveNoClobber, parseRecycleInfo, parseTrashInfo, safeOriginalPath, TrashService } from '../../src/main/core/trash'

let home: string
let trash: string
let work: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ouija-trash-'))
  trash = join(home, '.local', 'share', 'Trash')
  work = join(home, 'Documentos')
  mkdirSync(join(trash, 'files'), { recursive: true })
  mkdirSync(join(trash, 'info'), { recursive: true })
  mkdirSync(work, { recursive: true })
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

const service = (extra: Record<string, unknown> = {}) => new TrashService({ platform: 'linux', home, env: {}, uid: 1000, mounts: [], ...extra })

/** Mete un archivo en la papelera como lo hace el sistema: en files/ más un .trashinfo. */
function trashFile(name: string, original: string, content = 'contenido', date = '2026-11-10T09:30:00') {
  writeFileSync(join(trash, 'files', name), content)
  writeFileSync(join(trash, 'info', `${name}.trashinfo`), `[Trash Info]\nPath=${encodeURI(original).replace(/#/g, '%23')}\nDeletionDate=${date}\n`)
}

describe('formato de la papelera (freedesktop)', () => {
  it('lee la ruta con %-codificación y la fecha local, tal como la escribe el sistema', () => {
    const info = parseTrashInfo('[Trash Info]\nPath=/home/ana/.ouija-trash-test/prueba%20ouija%20%C3%B1and%C3%BA.txt\nDeletionDate=2026-11-15T14:28:11\n')
    expect(info.originalPath).toBe('/home/ana/.ouija-trash-test/prueba ouija ñandú.txt')
    expect(info.trashedAt).toBe(new Date(2026, 10, 15, 14, 28, 11).getTime())
  })

  it('las papeleras de discos externos guardan rutas relativas a la raíz del disco', () => {
    expect(parseTrashInfo('[Trash Info]\nPath=Fotos/a%20b.jpg\nDeletionDate=2026-01-02T03:04:05', '/media/ana/USB').originalPath).toBe('/media/ana/USB/Fotos/a b.jpg')
    expect(parseTrashInfo('[Trash Info]\nPath=Fotos/a.jpg\nDeletionDate=2026-01-02T03:04:05').originalPath).toBeUndefined()
  })

  it('descarta rutas peligrosas o dañadas', () => {
    for (const bad of ['/home/ana/../../etc/passwd', '%E0%A4%A', 'relativa/ruta', '']) {
      expect(parseTrashInfo(`[Trash Info]\nPath=${bad}\n`).originalPath, bad).toBeUndefined()
    }
    expect(parseTrashInfo('basura que no es un trashinfo')).toEqual({ originalPath: undefined, trashedAt: undefined })
    expect(parseTrashInfo('[Trash Info]\nPath=/a/b\nDeletionDate=ayer').trashedAt).toBeUndefined()
  })

  it('propiedad: la ruta que sale de un .trashinfo es siempre absoluta y sin ".."', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (raw) => {
        const p = parseTrashInfo(`[Trash Info]\nPath=${raw}\n`, '/media/x').originalPath
        if (p !== undefined) {
          expect(p.startsWith('/')).toBe(true)
          expect(p.split('/')).not.toContain('..')
        }
      }),
      { numRuns: 500 }
    )
    expect(decodeTrashPath('/a/b%20c')).toBe('/a/b c')
    expect(safeOriginalPath('/a/../b')).toBeUndefined()
  })
})

describe('Papelera de Windows ($I)', () => {
  function recycleInfo(version: 1 | 2, original: string, size: number, date: Date): Buffer {
    const ft = BigInt(date.getTime() + 11644473600000) * 10000n
    const path = Buffer.from(`${original}\0`, 'utf16le')
    if (version === 1) {
      const b = Buffer.alloc(24 + 520)
      b.writeBigInt64LE(1n, 0)
      b.writeBigInt64LE(BigInt(size), 8)
      b.writeBigUInt64LE(ft, 16)
      path.copy(b, 24)
      return b
    }
    const b = Buffer.alloc(28 + path.length)
    b.writeBigInt64LE(2n, 0)
    b.writeBigInt64LE(BigInt(size), 8)
    b.writeBigUInt64LE(ft, 16)
    b.writeUInt32LE(original.length + 1, 24)
    path.copy(b, 28)
    return b
  }

  it('lee las versiones 1 y 2: ruta, tamaño y fecha', () => {
    const date = new Date('2026-11-12T10:20:30Z')
    for (const v of [1, 2] as const) {
      expect(parseRecycleInfo(recycleInfo(v, 'C:\\Users\\Ana\\Documentos\\Informe ñ.docx', 4321, date))).toEqual({
        originalPath: 'C:\\Users\\Ana\\Documentos\\Informe ñ.docx',
        trashedAt: date.getTime(),
        size: 4321
      })
    }
  })

  it('rechaza archivos dañados o con rutas peligrosas', () => {
    expect(parseRecycleInfo(Buffer.alloc(10))).toBeUndefined()
    expect(parseRecycleInfo(recycleInfo(1, 'C:\\a\\..\\..\\Windows\\x.dll', 1, new Date()))?.originalPath).toBeUndefined()
    expect(parseRecycleInfo(recycleInfo(1, 'relativa\\x.txt', 1, new Date()))?.originalPath).toBeUndefined()
    const wrongVersion = recycleInfo(1, 'C:\\a.txt', 1, new Date())
    wrongVersion.writeBigInt64LE(9n, 0)
    expect(parseRecycleInfo(wrongVersion)).toBeUndefined()
  })

  it('lista una papelera de Windows simulada y la resucita', async () => {
    const bin = join(home, '$Recycle.Bin')
    const sid = join(bin, 'S-1-5-21-1')
    const other = join(bin, 'S-1-5-21-2') // otro usuario: sin permiso
    mkdirSync(sid, { recursive: true })
    mkdirSync(other, { recursive: true })
    const target = join(home, 'Destino')
    writeFileSync(join(sid, '$RABC123.txt'), 'hola')
    writeFileSync(join(sid, '$IABC123.txt'), recycleInfo(2, 'C:\\Users\\Ana\\carta.txt', 4, new Date('2026-11-01T12:00:00Z')))
    const svc = new TrashService({ platform: 'win32', home, recycleBins: [bin] })

    const { items } = await svc.list()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'carta.txt', originalPath: 'C:\\Users\\Ana\\carta.txt', size: 4, ext: 'txt' })

    const r = await svc.restore(items[0].id, target)
    expect(r).toMatchObject({ ok: true })
    expect(readFileSync(join(target, 'carta.txt'), 'utf8')).toBe('hola')
    expect(existsSync(join(sid, '$RABC123.txt')) || existsSync(join(sid, '$IABC123.txt'))).toBe(false)
  })
})

describe('leer la papelera', () => {
  it('lista archivos y carpetas con su origen, fecha y tamaño, lo más reciente primero', async () => {
    trashFile('viejo.txt', '/home/ana/Documentos/viejo.txt', 'abc', '2026-01-01T10:00:00')
    trashFile('nuevo ñ.txt', '/home/ana/Escritorio/nuevo ñ.txt', 'abcdef', '2026-11-10T09:30:00')
    mkdirSync(join(trash, 'files', 'carpeta'))
    writeFileSync(join(trash, 'files', 'carpeta', 'a.txt'), '12345')
    writeFileSync(join(trash, 'info', 'carpeta.trashinfo'), '[Trash Info]\nPath=/home/ana/carpeta\nDeletionDate=2026-06-01T00:00:00\n')

    const { items, locations } = await service().list()
    expect(locations).toBe(1)
    expect(items.map((i) => i.name)).toEqual(['nuevo ñ.txt', 'carpeta', 'viejo.txt'])
    expect(items[0]).toMatchObject({ originalPath: '/home/ana/Escritorio/nuevo ñ.txt', size: 6, isDir: false, ext: 'txt', trashedAt: new Date(2026, 10, 10, 9, 30).getTime() })
    expect(items[1]).toMatchObject({ isDir: true, size: 5, sizeApprox: false, ext: '' })
  })

  it('sin .trashinfo el elemento aparece igual, pero sin origen', async () => {
    writeFileSync(join(trash, 'files', 'huerfano.pdf'), 'x')
    const { items } = await service().list()
    expect(items[0]).toMatchObject({ name: 'huerfano.pdf', originalPath: undefined })
    expect(items[0].trashedAt).toBeTypeOf('number')
  })

  it('una papelera vacía o inexistente no es un error', async () => {
    expect((await service().list()).items).toEqual([])
    expect((await service({ home: join(home, 'nada'), env: {} }).list()).items).toEqual([])
  })

  it('incluye la papelera de un disco externo si existe', async () => {
    const usb = join(home, 'usb')
    mkdirSync(join(usb, '.Trash-1000', 'files'), { recursive: true })
    mkdirSync(join(usb, '.Trash-1000', 'info'), { recursive: true })
    writeFileSync(join(usb, '.Trash-1000', 'files', 'foto.jpg'), 'jpg')
    writeFileSync(join(usb, '.Trash-1000', 'info', 'foto.jpg.trashinfo'), '[Trash Info]\nPath=Fotos/foto.jpg\nDeletionDate=2026-05-05T05:05:05\n')
    const { items, locations } = await service({ mounts: [usb, join(home, 'sin-papelera')] }).list()
    expect(locations).toBe(2)
    expect(items[0].originalPath).toBe(join(usb, 'Fotos', 'foto.jpg'))
  })

  it('en macOS dice que no está soportado, sin fallar', async () => {
    const svc = new TrashService({ platform: 'darwin', home })
    expect(svc.supported).toBe(false)
    expect(await svc.list()).toEqual({ items: [], locations: 0 })
  })

  it('los enlaces simbólicos dentro de la papelera no se siguen', async () => {
    symlinkSync('/etc', join(trash, 'files', 'enlace'))
    writeFileSync(join(trash, 'info', 'enlace.trashinfo'), '[Trash Info]\nPath=/home/ana/enlace\nDeletionDate=2026-01-01T00:00:00\n')
    const { items } = await service().list()
    expect(items[0]).toMatchObject({ name: 'enlace', isDir: false })
    expect(items[0].size).toBeLessThan(100) // el tamaño del enlace, no el de /etc
  })
})

describe('resucitar', () => {
  it('devuelve el archivo a su lugar original, con su contenido, y limpia la papelera', async () => {
    const original = join(work, 'poema ñ.txt')
    trashFile('poema ñ.txt', original, 'Tus manos guardan la luz')
    const svc = service()
    const [item] = (await svc.list()).items

    const r = await svc.restore(item.id)

    expect(r).toEqual({ id: item.id, ok: true, restoredTo: original, renamed: false })
    expect(readFileSync(original, 'utf8')).toBe('Tus manos guardan la luz')
    expect(existsSync(join(trash, 'files', 'poema ñ.txt'))).toBe(false)
    expect(existsSync(join(trash, 'info', 'poema ñ.txt.trashinfo'))).toBe(false)
    expect((await svc.list()).items).toEqual([])
  })

  it('si la carpeta original ya no existe, la vuelve a crear', async () => {
    const original = join(work, 'borrada', 'sub', 'dato.txt')
    trashFile('dato.txt', original)
    const svc = service()
    const [item] = (await svc.list()).items
    expect(await svc.restore(item.id)).toMatchObject({ ok: true, restoredTo: original })
    expect(existsSync(original)).toBe(true)
  })

  it('nunca pisa un archivo que ya existe: le cambia el nombre', async () => {
    const original = join(work, 'informe.txt')
    writeFileSync(original, 'el archivo nuevo del usuario')
    trashFile('informe.txt', original, 'el archivo de la papelera')
    const svc = service()
    const [item] = (await svc.list()).items

    const r = await svc.restore(item.id)

    expect(r).toMatchObject({ ok: true, renamed: true, restoredTo: join(work, 'informe (resucitado).txt') })
    expect(readFileSync(original, 'utf8')).toBe('el archivo nuevo del usuario')
    expect(readFileSync(join(work, 'informe (resucitado).txt'), 'utf8')).toBe('el archivo de la papelera')
  })

  it('varias resurrecciones del mismo nombre quedan numeradas', async () => {
    const names: string[] = []
    for (let i = 0; i < 3; i++) {
      trashFile(`a.txt.${i}`, join(work, 'a.txt'), `v${i}`)
    }
    writeFileSync(join(work, 'a.txt'), 'existente')
    const svc = service()
    for (const item of (await svc.list()).items) {
      const r = await svc.restore(item.id)
      if (r.ok) names.push(r.restoredTo.slice(work.length + 1))
    }
    expect(names.sort()).toEqual(['a (resucitado 2).txt', 'a (resucitado 3).txt', 'a (resucitado).txt'])
    expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe('existente')
  })

  it('a una carpeta elegida, incluso si la papelera no recuerda el origen', async () => {
    writeFileSync(join(trash, 'files', 'huerfano.txt'), 'sin origen')
    const svc = service()
    const [item] = (await svc.list()).items
    expect(await svc.restore(item.id)).toMatchObject({ ok: false, error: 'no-original' })

    const dest = join(home, 'Rescatados')
    expect(await svc.restore(item.id, dest)).toMatchObject({ ok: true, restoredTo: join(dest, 'huerfano.txt') })
    expect(readFileSync(join(dest, 'huerfano.txt'), 'utf8')).toBe('sin origen')
  })

  it('carpetas enteras, con su contenido', async () => {
    mkdirSync(join(trash, 'files', 'proyecto', 'src'), { recursive: true })
    writeFileSync(join(trash, 'files', 'proyecto', 'src', 'a.ts'), 'código')
    writeFileSync(join(trash, 'info', 'proyecto.trashinfo'), `[Trash Info]\nPath=${work}/proyecto\nDeletionDate=2026-02-02T02:02:02\n`)
    const svc = service()
    const [item] = (await svc.list()).items
    expect(await svc.restore(item.id)).toMatchObject({ ok: true, restoredTo: join(work, 'proyecto') })
    expect(readFileSync(join(work, 'proyecto', 'src', 'a.ts'), 'utf8')).toBe('código')
  })

  it('conserva la fecha de modificación al cambiar de disco', async () => {
    trashFile('viejo.txt', join(work, 'viejo.txt'), 'x')
    const when = new Date('2015-05-05T10:00:00Z')
    utimesSync(join(trash, 'files', 'viejo.txt'), when, when)
    const svc = service({ ops: { link: async () => Promise.reject(Object.assign(new Error('x'), { code: 'EXDEV' })) } })
    const [item] = (await svc.list()).items
    expect(await svc.restore(item.id)).toMatchObject({ ok: true })
    expect(readFileSync(join(work, 'viejo.txt'), 'utf8')).toBe('x')
  })

  it('solo resucita lo que vino de la última lectura, y una sola vez', async () => {
    trashFile('a.txt', join(work, 'a.txt'))
    const svc = service()
    expect(await svc.restore('0123456789abcdef')).toMatchObject({ ok: false, error: 'not-found' })
    const [item] = (await svc.list()).items
    expect(await svc.restore(item.id)).toMatchObject({ ok: true })
    expect(await svc.restore(item.id)).toMatchObject({ ok: false, error: 'not-found' })
  })

  it('si el elemento desapareció de la papelera entre la lectura y el clic, lo dice', async () => {
    trashFile('a.txt', join(work, 'a.txt'))
    const svc = service()
    const [item] = (await svc.list()).items
    rmSync(join(trash, 'files', 'a.txt'))
    expect(await svc.restore(item.id)).toMatchObject({ ok: false, error: 'not-found' })
  })

  it('un destino inválido se rechaza sin tocar nada', async () => {
    trashFile('a.txt', join(work, 'a.txt'))
    const svc = service()
    const [item] = (await svc.list()).items
    expect(await svc.restore(item.id, 'relativa/carpeta')).toMatchObject({ ok: false, error: 'no-destination' })
    expect(existsSync(join(trash, 'files', 'a.txt'))).toBe(true)
  })

  it('un fallo al escribir deja el archivo en la papelera, intacto', async () => {
    trashFile('a.txt', join(work, 'a.txt'), 'importante')
    const svc = service()
    const [item] = (await svc.list()).items
    const blocker = join(home, 'archivo-no-carpeta')
    writeFileSync(blocker, 'x')
    const r = await svc.restore(item.id, join(blocker, 'sub')) // no se puede crear una carpeta dentro de un archivo
    expect(r).toMatchObject({ ok: false, error: 'failed' })
    expect(readFileSync(join(trash, 'files', 'a.txt'), 'utf8')).toBe('importante')
    expect(existsSync(join(trash, 'info', 'a.txt.trashinfo'))).toBe(true)
  })
})

describe('mover sin pisar', () => {
  it('link: no sobrescribe aunque el destino aparezca justo antes', async () => {
    const a = join(work, 'a.txt')
    const b = join(work, 'b.txt')
    writeFileSync(a, 'A')
    writeFileSync(b, 'B')
    await expect(moveNoClobber(a, b, false)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(b, 'utf8')).toBe('B')
    expect(readFileSync(a, 'utf8')).toBe('A')
  })

  it('copiar entre discos tampoco sobrescribe, y el original solo se borra si la copia salió bien', async () => {
    const a = join(work, 'a.txt')
    const b = join(work, 'b.txt')
    writeFileSync(a, 'A')
    writeFileSync(b, 'B')
    const exdev = { link: async () => Promise.reject(Object.assign(new Error('x'), { code: 'EXDEV' })) }
    await expect(moveNoClobber(a, b, false, exdev)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(a, 'utf8')).toBe('A') // el original sigue ahí
    expect(readFileSync(b, 'utf8')).toBe('B')
  })

  it('carpetas: entre discos se copian y luego se borra el origen', async () => {
    mkdirSync(join(work, 'src', 'sub'), { recursive: true })
    writeFileSync(join(work, 'src', 'sub', 'x.txt'), 'x')
    const exdev = { rename: async () => Promise.reject(Object.assign(new Error('x'), { code: 'EXDEV' })) }
    await moveNoClobber(join(work, 'src'), join(work, 'dst'), true, exdev)
    expect(readFileSync(join(work, 'dst', 'sub', 'x.txt'), 'utf8')).toBe('x')
    expect(existsSync(join(work, 'src'))).toBe(false)
  })

  it('carpetas: si el destino existe, falla y no toca nada', async () => {
    mkdirSync(join(work, 'src'))
    mkdirSync(join(work, 'dst'))
    writeFileSync(join(work, 'dst', 'mio.txt'), 'mío')
    await expect(moveNoClobber(join(work, 'src'), join(work, 'dst'), true)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(join(work, 'dst', 'mio.txt'), 'utf8')).toBe('mío')
    expect(existsSync(join(work, 'src'))).toBe(true)
  })

  it('freeName busca el primer nombre libre', async () => {
    writeFileSync(join(work, 'x.png'), '')
    writeFileSync(join(work, 'x (resucitado).png'), '')
    expect((await freeName(work, 'x.png')).path).toBe(join(work, 'x (resucitado 2).png'))
    expect(await freeName(work, 'libre.png')).toEqual({ path: join(work, 'libre.png'), renamed: false })
    expect(readdirSync(work).length).toBe(2)
    expect(statSync(work).isDirectory()).toBe(true)
  })
})
