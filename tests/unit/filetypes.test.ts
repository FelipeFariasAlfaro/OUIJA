import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ALL_KINDS, EXTENSIONS_BY_KIND, extensionOf, isIgnoredFile, kindOf, KIND_LABEL, KIND_WORDS } from '@shared/filetypes'
import { buildMetaText, splitIdentifier } from '../../src/core/indexing/meta'

describe('tipos de archivo', () => {
  it('reconoce los tipos más comunes', () => {
    expect(kindOf('png')).toBe('image')
    expect(kindOf('JPG')).toBe('image')
    expect(kindOf('mp3')).toBe('audio')
    expect(kindOf('mp4')).toBe('video')
    expect(kindOf('xlsx')).toBe('spreadsheet')
    expect(kindOf('pptx')).toBe('presentation')
    expect(kindOf('py')).toBe('code')
    expect(kindOf('pdf')).toBe('document')
    expect(kindOf('zip')).toBe('archive')
    expect(kindOf('desconocida')).toBe('other')
    expect(kindOf('')).toBe('other')
  })

  it('cada extensión pertenece a un solo tipo', () => {
    const seen = new Map<string, string>()
    for (const kind of ALL_KINDS) {
      for (const ext of EXTENSIONS_BY_KIND[kind]) {
        expect(seen.get(ext), `${ext} está en ${seen.get(ext)} y en ${kind}`).toBeUndefined()
        seen.set(ext, kind)
        expect(kindOf(ext)).toBe(kind)
      }
    }
  })

  it('todos los tipos tienen nombre en español e inglés y palabras para buscarlos', () => {
    for (const kind of ALL_KINDS) {
      expect(KIND_LABEL.es[kind]).toBeTruthy()
      expect(KIND_LABEL.en[kind]).toBeTruthy()
      expect(KIND_WORDS[kind]).toBeTruthy()
    }
  })

  it('kindOf y extensionOf nunca fallan', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(ALL_KINDS).toContain(kindOf(extensionOf(s)))
      }),
      { numRuns: 300 }
    )
  })

  it('omite compilados, temporales y archivos de sistema, pero no documentos ni medios', () => {
    for (const bad of ['a.pyc', 'x/Foo.class', 'lib.DLL', 'libfoo.so', 'x.tmp', 'bajando.crdownload', '~$Informe.docx', 'Thumbs.db', '.DS_Store', 'desktop.ini']) {
      expect(isIgnoredFile(bad), bad).toBe(true)
    }
    for (const good of ['logo.png', 'cancion.mp3', 'LICENSE', 'Makefile', 'foto.heic', 'informe.docx', 'a.zip', 'instalador.exe']) {
      expect(isIgnoredFile(good), good).toBe(false)
    }
  })
})

describe('texto de metadatos', () => {
  it('separa nombres pegados, guiones y números', () => {
    expect(splitIdentifier('LogoHakaLens_blanco-final(1)')).toBe('Logo Haka Lens blanco final 1')
    expect(splitIdentifier('ElevenLabs_2026-11-13T22_56_23')).toBe('Eleven Labs 2026 11 13 T22 56 23')
    expect(splitIdentifier('HTTPServer')).toBe('HTTP Server')
    expect(splitIdentifier('')).toBe('')
  })

  it('incluye nombre, palabras, tipo en dos idiomas, tamaño y carpetas', () => {
    const t = buildMetaText('/home/felipfarias/Descargas/Logos Hakas/Logo Haka Lens blanco (1).png', 57_887)
    expect(t).toContain('Logo Haka Lens blanco (1).png')
    expect(t).toContain('Imagen PNG')
    expect(t).toMatch(/foto/)
    expect(t).toMatch(/picture/)
    expect(t).toContain('57 KB')
    expect(t).toContain('Carpeta: home / felipfarias / Descargas / Logos Hakas')
  })

  it('solo conserva las últimas cuatro carpetas', () => {
    const t = buildMetaText('/a/b/c/d/e/f/nota.txt', 10)
    expect(t).toContain('Carpeta: c / d / e / f')
    expect(t).not.toContain('b /')
  })

  it('para un archivo dentro de un respaldo, indica el respaldo', () => {
    const t = buildMetaText('/x/Respaldos/escritorio-2008.zip::Poemas/rosa_v1.wpd', 2048)
    expect(t).toContain('rosa_v1.wpd')
    expect(t).toContain('Carpeta: Poemas')
    expect(t).toContain('Dentro de: escritorio 2008')
  })

  it('archivos sin extensión o con nombres raros no fallan', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.nat(), (name, size) => {
        const t = buildMetaText(`/c/${name.replace(/[/\\]/g, '_')}`, size)
        expect(typeof t).toBe('string')
        expect(t.length).toBeGreaterThan(0)
      }),
      { numRuns: 200 }
    )
  })
})
