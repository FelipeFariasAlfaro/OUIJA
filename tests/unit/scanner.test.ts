import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { scanFolder } from '@core/indexing'

const root = mkdtempSync(join(tmpdir(), 'ouija-scan-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const put = (rel: string, data = 'x') => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, data)
}

describe('scanFolder', () => {
  it('devuelve todo archivo útil y respeta exclusiones', async () => {
    put('a.txt')
    put('sub/b.docx')
    put('sub/c.pdf')
    put('sub/deep/d.zip')
    put('foto.jpg')
    put('programa.exe')
    put('compilado.pyc')
    put('libreria.dll')
    put('~$bloqueo.docx')
    put('Thumbs.db')
    put('sin_extension')
    put('node_modules/x/index.txt')
    put('.git/config.txt')
    put('.oculta/secreto.txt')
    put('.archivo_oculto.txt')
    put('MAYUS.TXT')
    symlinkSync(root, join(root, 'ciclo'))

    const found: string[] = []
    for await (const f of scanFolder(root)) found.push(f.path.slice(root.length + 1))
    // Todo se indexa (al menos por nombre y tipo), salvo compilados, temporales y archivos de sistema.
    expect(found.sort()).toEqual(['MAYUS.TXT', 'a.txt', 'foto.jpg', 'programa.exe', 'sin_extension', 'sub/b.docx', 'sub/c.pdf', 'sub/deep/d.zip'].sort())
  })

  it('informa datos del archivo y errores de carpetas ilegibles sin lanzar', async () => {
    const errors: string[] = []
    const files = []
    for await (const f of scanFolder(join(root, 'no-existe'), { onError: (p) => errors.push(p) })) files.push(f)
    expect(files).toEqual([])
    expect(errors).toHaveLength(1)

    for await (const f of scanFolder(root)) {
      if (f.path.endsWith('a.txt')) expect(f).toMatchObject({ ext: 'txt', size: 1 })
    }
  })

  it('puede incluir ocultos y cambiar exclusiones', async () => {
    const found: string[] = []
    for await (const f of scanFolder(root, { includeHidden: true, excludeDirs: [] })) found.push(f.path.slice(root.length + 1))
    expect(found).toContain('.archivo_oculto.txt')
    expect(found).toContain('node_modules/x/index.txt')
  })
})
