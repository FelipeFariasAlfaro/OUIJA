import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CP437 } from '@core/extract/codepages'
import { carveText, extractText, ExtractError, rtfToText } from '@core/extract'
import { findSoffice } from '../../src/core/extract/legacy'
import { findTesseract } from '../../src/core/extract/ocr'
import { buildPdf } from '../helpers/pdfBuilder'
import { buildZip } from '../helpers/zipBuilder'

const tmp = mkdtempSync(join(tmpdir(), 'ouija-extract-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const run = (name: string, data: Buffer | string) =>
  extractText({ name, read: async () => (Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')) })

/** `true` si el ejecutable existe (algunos, como pdftoppm, salen con código distinto de 0 en --version). */
function commandExists(cmd: string): boolean {
  return spawnSync(cmd, ['-v'], { stdio: 'ignore' }).error === undefined
}

describe('texto plano', () => {
  it('lee txt y md', async () => {
    expect((await run('a.txt', 'Hola Rosa\r\n\r\n\r\n\r\nchao')).text).toBe('Hola Rosa\n\nchao')
    expect((await run('a.md', '# Título')).method).toBe('text')
  })

  it('un archivo vacío falla con ExtractError', async () => {
    await expect(run('a.txt', '')).rejects.toBeInstanceOf(ExtractError)
  })

  it('rechaza extensiones no soportadas', async () => {
    await expect(run('a.exe', 'x')).rejects.toThrow(/no soportado/)
  })

  it('marca como resucitado el texto DOS y el mojibake', async () => {
    const dos = Buffer.from(
      [...'La canción de Rosa está en la carta que escribí'].map((c) => {
        const i = CP437.indexOf(c)
        return i >= 0 ? 0x80 + i : c.charCodeAt(0)
      })
    )
    const r = await run('viejo.txt', dos)
    expect(r.text).toBe('La canción de Rosa está en la carta que escribí')
    expect(r.resurrected).toBe(true)

    const m = await run('roto.txt', 'La canciÃ³n de Rosa estÃ¡ aquÃ­')
    expect(m.text).toBe('La canción de Rosa está aquí')
    expect(m.resurrected).toBe(true)
    expect(m.warnings.length).toBeGreaterThan(0)
  })
})

describe('RTF', () => {
  it('extrae texto, acentos y unicode, y omite tablas de fuentes', () => {
    const rtf =
      '{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}' +
      '\\f0\\fs24 Poema para Rosa\\par canci\\\'f3n y \\u960?mundo\\tab fin\\par}'
    expect(rtfToText(rtf).trim()).toBe('Poema para Rosa\ncanción y πmundo\tfin')
  })

  it('un RTF por extensión .rtf', async () => {
    const r = await run('a.rtf', '{\\rtf1\\ansi Hola \\\'e1rbol\\par}')
    expect(r.text).toBe('Hola árbol')
  })
})

describe('DOCX', () => {
  it('extrae párrafos y entidades', async () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Querida Rosa &amp; familia</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Segunda </w:t></w:r><w:r><w:t>línea</w:t></w:r></w:p></w:body></w:document>'
    const r = await run('a.docx', buildZip([{ name: 'word/document.xml', data: xml }]))
    expect(r.text).toBe('Querida Rosa & familia\nSegunda línea')
  })

  it('un zip sin document.xml falla con ExtractError', async () => {
    await expect(run('a.docx', buildZip([{ name: 'x.txt', data: 'hola' }]))).rejects.toBeInstanceOf(ExtractError)
  })
})

describe('PDF', () => {
  it('extrae el texto de un PDF con capa de texto', async () => {
    const r = await run('a.pdf', buildPdf(['Poema para Rosa en la carta de marzo', 'Segunda linea del documento']))
    expect(r.method).toBe('pdf')
    expect(r.text).toContain('Poema para Rosa')
  })

  it('un PDF corrupto falla con ExtractError', async () => {
    await expect(run('a.pdf', Buffer.from('%PDF-1.4 basura'))).rejects.toBeInstanceOf(ExtractError)
  })
})

describe('rescate forense', () => {
  it('encuentra texto CP437 dentro de un binario con basura', () => {
    const text = 'Querida Rosa, el poema para ti está en la carta que escribí con mucha ilusión'
    const encoded = Buffer.from(
      [...text].map((c) => {
        const i = CP437.indexOf(c)
        return i >= 0 ? 0x80 + i : c.charCodeAt(0)
      })
    )
    const noise = (n: number, seed: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + seed * 11) % 7))
    const carved = carveText(Buffer.concat([noise(300, 1), encoded, noise(200, 2)]))
    expect(carved).not.toBeNull()
    expect(carved!.text).toContain('Querida Rosa')
    expect(carved!.text).toContain('está en la carta')
    expect(carved!.confidence).not.toBe('high')
  })

  it('rescata texto UTF-8 con tildes dentro de un binario', () => {
    const body = Buffer.from('Agradecimientos: a Rosa Campos, por leer cada capítulo dos veces, y al doctor Salinas de Valparaíso.')
    const carved = carveText(Buffer.concat([Buffer.alloc(40, 1), body, Buffer.alloc(40, 2)]))
    expect(carved?.text).toContain('capítulo')
    expect(carved?.text).toContain('Valparaíso')
  })

  it('devuelve null si no hay texto', () => {
    expect(carveText(Buffer.alloc(2000, 0))).toBeNull()
    expect(carveText(Buffer.from(Array.from({ length: 2000 }, (_, i) => (i * 131) % 256)))).toBeNull()
  })
})

describe('formatos antiguos (.doc, .wpd)', () => {
  it('un .wpd que LibreOffice no entiende se rescata por bytes', async () => {
    const body = Buffer.from('Querida Rosa, te escribo desde la ciudad para contarte que el poema ya está listo')
    const fake = Buffer.concat([Buffer.from([0xff, 0x57, 0x50, 0x43, 0x10, 0, 0, 0, 1, 2, 22, 0, 0, 0]), body, Buffer.alloc(40, 0)])
    const r = await run('carta.wpd', fake)
    expect(r.resurrected).toBe(true)
    expect(r.text).toContain('Querida Rosa')
    expect(['legacy', 'carve']).toContain(r.method)
  })

  it('un .doc que en realidad es RTF se lee como RTF', async () => {
    const r = await run('viejo.doc', '{\\rtf1\\ansi Hola mundo\\par}')
    expect(r.method).toBe('rtf')
    expect(r.resurrected).toBe(true)
  })

  const hasSoffice = commandExists('soffice')
  it.skipIf(!hasSoffice)(
    'convierte un .doc real con LibreOffice sin tocar el original (P4)',
    async () => {
      const dir = mkdtempSync(join(tmp, 'doc-'))
      writeFileSync(join(dir, 'origen.txt'), 'Querida Rosa, aquí va el poema de marzo.\nSegunda línea del documento antiguo.\n')
      execFileSync('soffice', ['--headless', '--convert-to', 'doc', '--outdir', dir, join(dir, 'origen.txt')], { stdio: 'ignore' })
      const file = join(dir, 'origen.doc')
      const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex')
      const before = hash()
      const filesBefore = readdirSync(dir).sort()

      const r = await extractText({ name: 'origen.doc', read: async () => readFileSync(file) })

      expect(r.method).toBe('legacy')
      expect(r.resurrected).toBe(true)
      expect(r.text).toContain('Querida Rosa')
      expect(r.text).toContain('línea')
      expect(hash()).toBe(before)
      expect(readdirSync(dir).sort()).toEqual(filesBefore)
    },
    120_000
  )
})

describe('OCR de PDF escaneado', () => {
  const ready = commandExists('soffice') && commandExists('pdftoppm') && commandExists('tesseract')
  it.skipIf(!ready)('aplica OCR cuando el PDF no tiene texto', async () => {
    expect(await findTesseract()).not.toBeNull()
    expect(await findSoffice()).not.toBeNull()
    const dir = mkdtempSync(join(tmp, 'ocr-'))
    const line = 'The quick brown fox writes a letter to Rosa about the poem'
    writeFileSync(join(dir, 'a.pdf'), buildPdf([line, line, line], { fontSize: 24, width: 900, height: 200 }))
    execFileSync('pdftoppm', ['-r', '150', '-png', '-singlefile', join(dir, 'a.pdf'), join(dir, 'scan')])
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', join(dir, 'out'), join(dir, 'scan.png')], {
      stdio: 'ignore'
    })
    const scanned = readFileSync(join(dir, 'out', 'scan.pdf'))

    const r = await extractText({ name: 'scan.pdf', read: async () => scanned })
    expect(r.method).toBe('ocr')
    expect(r.resurrected).toBe(true)
    expect(r.text.toLowerCase()).toContain('quick brown fox')
  }, 180_000)
})
