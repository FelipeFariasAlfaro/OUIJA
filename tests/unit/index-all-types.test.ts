import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { explicitKind, Orchestrator, sanitizeParsed, type Llm } from '@core/ai/orchestrator'
import { ImageReader, IndexPipeline } from '@core/indexing'
import { SqliteStore } from '@core/memory'
import { EXTENSIONS_BY_KIND } from '@shared/filetypes'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'
import { buildPdf } from '../helpers/pdfBuilder'
import { buildXlsx } from '../helpers/officeBuilder'
import { buildZip } from '../helpers/zipBuilder'

let root: string
let store: SqliteStore
let embedder: FakeEmbedder

const put = (rel: string, data: string | Buffer) => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, data)
  return full
}
const pipeline = () => new IndexPipeline({ store, embedder })
const rel = (p: string) => p.slice(root.length + 1)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'medium-types-'))
  store = new SqliteStore(':memory:', { dimensions: FAKE_DIM })
  embedder = new FakeEmbedder()
})
afterEach(async () => {
  await store.close()
  rmSync(root, { recursive: true, force: true })
})

describe('todo archivo se puede encontrar por su nombre', () => {
  it('"donde tengo el logo de haka lens" encuentra una imagen que no se puede leer', async () => {
    put('Logos Hakas/Logo Haka Lens blanco (1).png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))
    put('Logos Hakas/Logo Haka Boost.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 5, 6, 7]))
    put('informe.txt', 'Informe de Haka Lens: ' + 'las pruebas automáticas de la aplicación móvil avanzaron durante el mes. '.repeat(10))
    put('ElevenLabs_2026-11-13T22_56_23_Camila.mp3', Buffer.from('ID3\x03\x00'))
    await pipeline().indexFolder(root)

    const q = 'donde tengo el logo de haka lens'
    const hits = await store.search({ text: q, embedding: FakeEmbedder.vector(q) })

    expect(rel(hits[0].doc.path)).toBe('Logos Hakas/Logo Haka Lens blanco (1).png')
    expect(hits[0]).toMatchObject({ snippetKind: 'meta', lexical: true })
    expect(hits[0].doc).toMatchObject({ ext: 'png', size: 8 })
  })

  it('un audio y un video se encuentran por su nombre dividido en palabras', async () => {
    put('ElevenLabs_2026-11-13T22_56_23_Camila_pvc.mp3', Buffer.from('ID3'))
    put('Clase 2 - Arquitectura Moderna de Appium.mp4', Buffer.from('ftyp'))
    await pipeline().indexFolder(root)

    const audio = await store.search({ text: 'audio de camila', embedding: FakeEmbedder.vector('audio de camila') })
    expect(rel(audio[0].doc.path)).toContain('Camila')
    const video = await store.search({ text: 'video arquitectura appium' })
    expect(rel(video[0].doc.path)).toContain('Arquitectura Moderna')
  })

  it('un archivo solo conocido por su nombre no tiene contenido: ni texto, ni entidades pendientes', async () => {
    const png = put('foto.png', Buffer.from([0x89, 0x50]))
    await pipeline().indexFolder(root)
    expect(await store.getText(png)).toBe('')
    expect(await store.pendingEntityDocs()).toEqual([])
    expect((await store.getDoc(png))?.error).toBeUndefined()
  })

  it('omite compilados y archivos de sistema', async () => {
    put('a.pyc', 'x')
    put('libfoo.so', 'x')
    put('Thumbs.db', 'x')
    put('~$informe.docx', 'x')
    put('nota.txt', 'Una nota cualquiera con texto suficiente para indexar.')
    await pipeline().indexFolder(root)
    expect((await store.listFiles()).map((d) => rel(d.path))).toEqual(['nota.txt'])
  })

  it('el contenido de un documento sigue mostrándose como fragmento, no los metadatos', async () => {
    put('contrato_arriendo.txt', 'El presente contrato de arriendo tendrá una vigencia de doce meses.')
    await pipeline().indexFolder(root)
    const [hit] = await store.search({ text: 'contrato arriendo' })
    expect(hit.snippetKind).toBe('content')
    expect(hit.snippet).toContain('vigencia de doce meses')
  })

  it('los archivos dentro de un respaldo también se encuentran por nombre, sea cual sea su tipo', async () => {
    put('respaldo.zip', buildZip([{ name: 'Fotos/viaje_peru_2011.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) }, { name: 'musica/cancion.mp3', data: 'ID3' }]))
    await pipeline().indexFolder(root)
    const hits = await store.search({ text: 'foto viaje peru' })
    expect(hits[0].doc.path.endsWith('respaldo.zip::Fotos/viaje_peru_2011.jpg')).toBe(true)
    expect(hits[0].doc.container).toContain('respaldo.zip')
  })

  it('el propio respaldo se encuentra por su nombre', async () => {
    put('Respaldos/escritorio-2008.zip', buildZip([{ name: 'a.txt', data: 'hola mundo, texto de prueba suficiente' }]))
    await pipeline().indexFolder(root)
    const hits = await store.search({ text: 'respaldo escritorio 2008' })
    expect(rel(hits[0].doc.path)).toBe('Respaldos/escritorio-2008.zip')
  })
})

describe('contenido según el tipo', () => {
  it('lee planillas: se encuentran por lo que dicen sus celdas', async () => {
    put('finanzas.xlsx', buildXlsx([['Concepto', 'Monto'], ['Arriendo oficina', 450000]]))
    await pipeline().indexFolder(root)
    const [hit] = await store.search({ text: 'arriendo oficina' })
    expect(hit.snippetKind).toBe('content')
    expect(hit.snippet).toContain('Arriendo oficina')
  })

  it('del código solo se guarda el comienzo; no se llena el índice con miles de fragmentos', async () => {
    const big = Array.from({ length: 4000 }, (_, i) => `def funcion_${i}(x):\n    return x + ${i}\n`).join('\n')
    const file = put('modulo.py', big)
    await pipeline().indexFolder(root)
    expect((await store.getText(file))!.length).toBeLessThan(4000)
  })

  it('un texto sin extensión (LICENSE, Makefile) se lee; un binario sin extensión no', async () => {
    const lic = put('LICENSE', 'MIT License. Permission is hereby granted, free of charge, to any person obtaining a copy.')
    const bin = put('datos', Buffer.from(Array.from({ length: 2000 }, (_, i) => (i * 7) % 256)))
    await pipeline().indexFolder(root)
    expect(await store.getText(lic)).toContain('Permission is hereby granted')
    expect(await store.getText(bin)).toBe('')
    expect(await store.hasPath(bin)).toBe(true)
  })

  it('un archivo enorme se identifica sin leerlo entero', async () => {
    const huge = join(root, 'pelicula.mp4')
    writeFileSync(huge, Buffer.from('ftyp'))
    truncateSync(huge, 200 * 1024 * 1024) // archivo "disperso": no ocupa disco
    const started = Date.now()
    await pipeline().indexFolder(root)
    const doc = await store.getDoc(huge)
    expect(doc?.hash.startsWith('partial:')).toBe(true)
    expect(doc?.size).toBe(200 * 1024 * 1024)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('un PDF ilegible sigue siendo buscable por su nombre y queda marcado con el error', async () => {
    const pdf = put('Contrato firmado 2020.pdf', '%PDF-1.4 basura')
    await pipeline().indexFolder(root)
    const doc = await store.getDoc(pdf)
    expect(doc?.error).toMatch(/PDF ilegible/)
    expect((await store.search({ text: 'contrato firmado' }))[0].doc.path).toBe(pdf)
  })
})

const hasOcr = spawnSync('tesseract', ['--version']).error === undefined && spawnSync('pdftoppm', ['-v']).error === undefined
describe.skipIf(!hasOcr)('texto dentro de imágenes (OCR)', () => {
  function pngWithText(text: string): Buffer {
    const dir = mkdtempSync(join(tmpdir(), 'medium-png-'))
    try {
      writeFileSync(join(dir, 'a.pdf'), buildPdf([text, text], { fontSize: 28, width: 900, height: 160 }))
      execFileSync('pdftoppm', ['-r', '120', '-png', '-singlefile', join(dir, 'a.pdf'), join(dir, 'img')])
      return readFileSync(join(dir, 'img.png'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('la imagen se encuentra por su nombre desde el primer momento y por lo que dice después de leerla', async () => {
    const file = put('captura_1.png', pngWithText('Quarterly invoice for the Haka laboratory'))
    await pipeline().indexFolder(root)

    // Antes de leerla: solo por nombre.
    expect(await store.search({ text: 'invoice laboratory' })).toEqual([])
    expect((await store.search({ text: 'captura' }))[0].doc.path).toBe(file)
    expect((await store.pendingOcrDocs(['png'], 10_000_000)).map((d) => d.path)).toEqual([file])

    const progress: number[] = []
    const result = await new ImageReader(store, embedder).run({ onProgress: (p) => progress.push(p.processed) })

    expect(result).toEqual({ processed: 1, found: 1 })
    expect(progress.at(-1)).toBe(1)
    const [hit] = await store.search({ text: 'invoice laboratory' })
    expect(hit.doc.path).toBe(file)
    expect(hit.snippetKind).toBe('content')
    expect(hit.doc.confidence).toBe('low')
    expect(await store.pendingOcrDocs(['png'], 10_000_000)).toEqual([]) // no se repite
    expect((await store.search({ text: 'captura' }))[0].doc.path).toBe(file) // sigue pudiendo buscarse por nombre
  }, 90_000)

  it('una imagen sin texto con sentido no genera contenido ni error, y no se vuelve a leer', async () => {
    const noise = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0005fe02fea75b0a7d0000000049454e44ae426082', 'hex')
    const file = put('pixel.png', noise)
    await pipeline().indexFolder(root)
    const result = await new ImageReader(store, embedder).run()
    expect(result).toEqual({ processed: 1, found: 0 })
    expect(await store.getText(file)).toBe('')
    expect((await store.getDoc(file))?.error).toBeUndefined()
    expect(await store.pendingOcrDocs(['png'], 10_000_000)).toEqual([])
  }, 60_000)

  it('lee varias imágenes a la vez', async () => {
    for (let i = 0; i < 6; i++) put(`img_${i}.png`, pngWithText(`Meeting minutes number ${i} for the quarterly review`))
    await pipeline().indexFolder(root)
    let running = 0
    let peak = 0
    const slowOcr = async () => {
      peak = Math.max(peak, ++running)
      await new Promise((r) => setTimeout(r, 40))
      running--
      return { text: '' }
    }
    await new ImageReader(store, embedder, slowOcr).run()
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(3)
  }, 90_000)
})

describe('lectura de imágenes: casos límite', () => {
  it('ignora fotos grandes, imágenes dentro de respaldos y archivos que cambiaron mientras se leían', async () => {
    const big = put('foto_grande.jpg', Buffer.alloc(2 * 1024 * 1024, 1))
    put('respaldo.zip', buildZip([{ name: 'a.png', data: Buffer.from([0x89, 0x50]) }]))
    const small = put('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await pipeline().indexFolder(root)

    const pending = (await store.pendingOcrDocs(['png', 'jpg'], 1.5 * 1024 * 1024)).map((d) => d.path)
    expect(pending).toEqual([small])
    expect(await store.hasPath(big)).toBe(true) // sigue buscable por nombre

    // Si cambia mientras se lee, no se guarda un resultado viejo.
    let changed = false
    const ocr = async () => {
      if (!changed) {
        changed = true
        await store.upsert({ ...(await store.getDoc(small))!, hash: 'otro-contenido' }, [])
      }
      return { text: 'texto viejo de la versión anterior' }
    }
    const r = await new ImageReader(store, embedder, ocr).run()
    expect(r.found).toBe(0)
    expect(await store.getText(small)).toBe('')
  })

  it('si Ollama cae, se detiene y las imágenes quedan pendientes', async () => {
    const file = put('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await pipeline().indexFolder(root)
    embedder.failWith = new (await import('@core/ai/ollama')).OllamaError('unavailable', 'sin conexión')
    await expect(new ImageReader(store, embedder, async () => ({ text: 'Texto con sentido en la imagen' })).run()).rejects.toThrow()
    expect((await store.pendingOcrDocs(['png'], 10_000_000)).map((d) => d.path)).toEqual([file])
  })
})

describe('búsqueda: todas las palabras suben el resultado', () => {
  it('"haka lens" prefiere lo que tiene las dos palabras sobre lo que repite solo una', async () => {
    const docs: [string, string][] = [
      ['solo_lens', 'lens lens lens lens lens lens lens lens'],
      ['ambas', 'Notas largas sobre el producto haka lens y otros temas variados de la oficina, reuniones, informes mensuales, presupuestos y calendarios de entrega para clientes nuevos'],
      ...Array.from({ length: 6 }, (_, i): [string, string] => [`haka_${i}`, `haka reunión número ${i} sobre pruebas`])
    ]
    for (const [name, text] of docs) {
      await store.upsert({ path: `/x/${name}`, hash: name, size: 1, mtime: 1, ext: 'txt' }, [{ ord: 1, text, embedding: FakeEmbedder.vector(text) }])
    }
    const hits = await store.search({ text: 'haka lens' })
    expect(hits[0].doc.path).toBe('/x/ambas')
  })
})

describe('preguntas por tipo de archivo', () => {
  it('reconoce el tipo cuando se pide de forma explícita', () => {
    expect(explicitKind('¿dónde están las fotos del viaje?')).toBe('image')
    expect(explicitKind('mis audios de camila')).toBe('audio')
    expect(explicitKind('videos de la clase 2')).toBe('video')
    expect(explicitKind('la planilla de gastos')).toBe('spreadsheet')
    expect(explicitKind('presentación sobre appium')).toBe('presentation')
    expect(explicitKind('where are my screenshots')).toBe('image')
  })

  it('no filtra si no se pide un tipo o se piden varios', () => {
    expect(explicitKind('donde tengo el logo de haka lens')).toBeUndefined()
    expect(explicitKind('fotos y videos del viaje')).toBeUndefined()
    expect(explicitKind('')).toBeUndefined()
  })

  it('un tipo del modelo se convierte en extensiones; uno inventado se descarta', () => {
    expect(sanitizeParsed({ query: 'viaje', extensions: [], kind: 'image' }, 'q').filter?.extensions).toEqual(EXTENSIONS_BY_KIND.image)
    expect(sanitizeParsed({ query: 'viaje', extensions: ['pdf'], kind: 'audio' }, 'q').filter?.extensions).toEqual(['pdf', ...EXTENSIONS_BY_KIND.audio])
    expect(sanitizeParsed({ query: 'x', extensions: [], kind: 'dinosaurio' }, 'q').filter).toBeUndefined()
    expect(sanitizeParsed({ query: 'x', extensions: [], kind: 'other' }, 'q').filter).toBeUndefined()
  })

  it('"fotos del viaje" solo trae imágenes, aunque haya documentos con las mismas palabras', async () => {
    put('Viaje Perú/IMG_0042.jpg', Buffer.from([0xff, 0xd8]))
    put('Viaje Perú/itinerario.txt', 'Itinerario del viaje a Perú: Cusco, Arequipa y Lima durante dos semanas.')
    put('Viaje Perú/diario.pdf', '%PDF-1.4 basura')
    await pipeline().indexFolder(root)

    const noLlm: Llm | undefined = undefined
    const r = await new Orchestrator({ store, embedder, llm: noLlm }).ask('fotos del viaje a Perú')
    expect(r.filter?.extensions).toEqual(EXTENSIONS_BY_KIND.image)
    expect(r.matches.map((m) => rel(m.doc.path))).toEqual(['Viaje Perú/IMG_0042.jpg'])
  })

  it('si el tipo pedido no existe, repite sin filtro en vez de decir que no hay nada', async () => {
    put('Viaje/itinerario.txt', 'Itinerario del viaje a Perú: Cusco, Arequipa y Lima durante dos semanas.')
    await pipeline().indexFolder(root)
    const r = await new Orchestrator({ store, embedder }).ask('fotos del itinerario del viaje a Perú')
    expect(r.relaxed).toBe(true)
    expect(r.found).toBe(true)
  })
})
