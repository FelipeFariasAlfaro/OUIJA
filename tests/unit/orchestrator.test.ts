import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OllamaError, pickChatModel } from '@core/ai/ollama'
import { explicitDates, findInvalidCitations, Orchestrator, sanitizeParsed, type Llm } from '@core/ai/orchestrator'
import { SqliteStore, type Hit } from '@core/memory'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12)

const DOCS = [
  { path: '/h/Personal/borrador_final3.docx', ext: 'docx', mtime: D(2019, 3, 12), text: 'Poema para Rosa. Tus manos guardan la luz de marzo y aprendo a nombrarla.' },
  { path: '/h/Respaldos/viejo.zip::Poemas/rosa_v1.wpd', ext: 'wpd', mtime: D(2008, 6, 3), text: 'Para Rosa, primer borrador del poema. Tus manos guardan la luz.' },
  { path: '/h/Antiguos/contrato_arriendo_2015.doc', ext: 'doc', mtime: D(2015, 4, 2), text: 'Contrato de arriendo de departamento por doce meses con renovación.' },
  { path: '/h/Trabajo/contrato_servicios.pdf', ext: 'pdf', mtime: D(2024, 1, 15), text: 'Contrato de prestación de servicios profesionales entre las partes.' }
]

let store: SqliteStore
let embedder: FakeEmbedder

beforeEach(async () => {
  store = new SqliteStore(':memory:', { dimensions: FAKE_DIM })
  embedder = new FakeEmbedder()
  for (const d of DOCS) {
    await store.upsert(
      { path: d.path, hash: d.path, size: 1, mtime: d.mtime, ext: d.ext },
      [{ ord: 0, text: d.text, embedding: FakeEmbedder.vector(d.text) }]
    )
  }
})
afterEach(async () => store.close())

/** LLM de guion: responde según el tipo de prompt (interpretar o juzgar). */
function scripted(handlers: { parse?: () => unknown; judge?: (prompt: string) => unknown }): Llm & { prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    async complete(prompt) {
      prompts.push(prompt)
      const isParse = prompt.includes('Convierte la pregunta')
      const out = isParse ? handlers.parse?.() : handlers.judge?.(prompt)
      if (out instanceof Error) throw out
      return typeof out === 'string' ? out : JSON.stringify(out)
    }
  }
}
const parse = (query: string, extra: object = {}) => ({ query, extensions: [], dateFrom: null, dateTo: null, ...extra })
const judge = (relevant: number[], answer: string, found = true) => ({ found, relevant, answer })

const names = (hits: Hit[]) => hits.map((h) => h.doc.path.split('/').pop())

describe('modo ligero (sin LLM)', () => {
  it('encuentra y responde con una plantilla', async () => {
    const r = await new Orchestrator({ store, embedder }).ask('¿Dónde está el poema para Rosa?')
    expect(r.mode).toBe('light')
    expect(r.found).toBe(true)
    expect(names(r.matches).slice(0, 2).sort()).toEqual(['borrador_final3.docx', 'viejo.zip::Poemas/rosa_v1.wpd'].sort().map((n) => n.split('/').pop()))
    expect(r.answer).toContain('«')
    expect(findInvalidCitations(r.answer, r.matches)).toEqual([])
  })

  it('dice que no encontró y no inventa archivos', async () => {
    const r = await new Orchestrator({ store, embedder }).ask('receta de pizza napolitana')
    expect(r).toMatchObject({ found: false, matches: [] })
    expect(r.answer).toMatch(/No encontré/)
  })

  it('responde en inglés', async () => {
    const r = await new Orchestrator({ store, embedder }).ask('poema Rosa', { lang: 'en' })
    expect(r.answer).toMatch(/I found/)
  })

  it('una pregunta vacía no busca', async () => {
    expect((await new Orchestrator({ store, embedder }).ask('   ')).found).toBe(false)
  })
})

describe('modo completo (con LLM)', () => {
  it('aplica filtros inferidos y usa el orden y la respuesta del modelo', async () => {
    const llm = scripted({
      parse: () => parse('contratos', { extensions: ['pdf'], dateFrom: '2024-01-01', dateTo: '2024-12-31' }),
      judge: () => judge([1], 'Tienes un contrato de servicios: «contrato_servicios.pdf».')
    })
    const r = await new Orchestrator({ store, embedder, llm }).ask('contratos en pdf del 2024', { now: new Date('2026-11-14') })
    expect(r.mode).toBe('full')
    expect(r.filter).toEqual({ extensions: ['pdf'], dateFrom: D(2024, 1, 1) - 12 * 3600 * 1000, dateTo: Date.UTC(2024, 11, 31) + 24 * 3600 * 1000 - 1 })
    expect(names(r.matches)).toEqual(['contrato_servicios.pdf'])
    expect(r.answer).toBe('Tienes un contrato de servicios: «contrato_servicios.pdf».')
    expect(llm.prompts[0]).toContain('Hoy es 2026-11-14')
  })

  it('repite sin filtros si los inferidos no dejan nada y lo informa', async () => {
    const llm = scripted({
      parse: () => parse('poema Rosa', { extensions: ['md'] }),
      judge: () => judge([1], 'El poema está en «borrador_final3.docx».')
    })
    const r = await new Orchestrator({ store, embedder, llm }).ask('poema para Rosa en markdown')
    expect(r.relaxed).toBe(true)
    expect(r.found).toBe(true)
  })

  it('respeta que el modelo diga que ninguno responde', async () => {
    const llm = scripted({ parse: () => parse('poema'), judge: () => judge([], '', false) })
    const r = await new Orchestrator({ store, embedder, llm }).ask('poema Rosa')
    expect(r).toMatchObject({ found: false, matches: [] })
  })

  it('ordena según el modelo e ignora números inválidos', async () => {
    const llm = scripted({ parse: () => parse('poema Rosa'), judge: () => judge([2, 99, 2, 0, 1], 'Hay dos versiones: «rosa_v1.wpd» y «borrador_final3.docx».') })
    const r = await new Orchestrator({ store, embedder, llm }).ask('poema Rosa')
    expect(r.matches).toHaveLength(2)
    expect(new Set(r.matches.map((m) => m.doc.path)).size).toBe(2)
    expect(r.matches.every((m) => DOCS.some((d) => d.path === m.doc.path))).toBe(true)
  })

  it('reemplaza una respuesta que cita archivos inventados (P1)', async () => {
    const llm = scripted({
      parse: () => parse('poema Rosa'),
      judge: () => judge([1], 'Está en «inventado_2020.docx» dentro de /home/ana/secreto/poema.docx.')
    })
    const r = await new Orchestrator({ store, embedder, llm }).ask('poema Rosa')
    expect(r.found).toBe(true)
    expect(r.answer).not.toContain('inventado')
    expect(r.warnings.join(' ')).toMatch(/no verificados/)
    expect(findInvalidCitations(r.answer, r.matches)).toEqual([])
  })

  it('descarta resultados olvidados mientras el modelo respondía', async () => {
    const llm = scripted({
      parse: () => parse('poema Rosa'),
      judge: () => {
        void store.forget('/h/Personal/borrador_final3.docx')
        return judge([1, 2], 'Hay dos: «borrador_final3.docx» y «rosa_v1.wpd».')
      }
    })
    // El forget es síncrono dentro de SQLite pero asíncrono en la API: se espera un tick antes de verificar.
    const orchestrator = new Orchestrator({ store, embedder, llm })
    const r = await orchestrator.ask('poema Rosa')
    for (const m of r.matches) expect(await store.hasPath(m.doc.path)).toBe(true)
  })

  it('JSON inválido: usa lo que tiene y cae al modo ligero para redactar', async () => {
    const llm = scripted({ parse: () => 'esto no es json', judge: () => '{{{' })
    const r = await new Orchestrator({ store, embedder, llm }).ask('poema Rosa')
    expect(r.found).toBe(true)
    expect(r.mode).toBe('light')
    expect(r.warnings.length).toBe(2)
  })

  it('Ollama caído: modo ligero sin lanzar', async () => {
    const down = new OllamaError('unavailable', 'sin conexión')
    const llm = scripted({ parse: () => down, judge: () => down })
    const r = await new Orchestrator({ store, embedder, llm }).ask('poema Rosa')
    expect(r.found).toBe(true)
    expect(r.mode).toBe('light')
  })

  it('si falla el embedder, busca solo por texto y avisa', async () => {
    embedder.failWith = new Error('sin embeddings')
    const r = await new Orchestrator({ store, embedder }).ask('contrato arriendo')
    expect(r.found).toBe(true)
    expect(names(r.matches)[0]).toBe('contrato_arriendo_2015.doc')
    expect(r.warnings.join(' ')).toMatch(/semántica no disponible/)
  })
})

describe('sanitizeParsed', () => {
  it('descarta extensiones, fechas y rangos inválidos', () => {
    expect(sanitizeParsed({ query: 'x', extensions: ['ZZZ', '.PDF', 'docx', 5], dateFrom: '2020-01-01', dateTo: 'mañana' }, 'q')).toEqual({
      query: 'x',
      filter: { extensions: ['pdf', 'docx'], dateFrom: Date.UTC(2020, 0, 1) }
    })
    expect(sanitizeParsed({ query: 'x', extensions: [], dateFrom: '2024-12-31', dateTo: '2024-01-01' }, 'q').filter).toBeUndefined()
    expect(sanitizeParsed({ query: '' }, 'pregunta original')).toEqual({ query: 'pregunta original', filter: undefined })
    expect(sanitizeParsed(null, 'q').query).toBe('q')
    expect(sanitizeParsed('texto', 'q').query).toBe('q')
  })
})

describe('explicitDates', () => {
  const now = new Date('2026-11-14T10:00:00Z')
  const y = (a: number, b = a) => ({ dateFrom: Date.UTC(a, 0, 1), dateTo: Date.UTC(b, 11, 31) + 24 * 3600 * 1000 - 1 })

  it('detecta años y rangos', () => {
    expect(explicitDates('el contrato del 2015', now)).toEqual(y(2015))
    expect(explicitDates('fotos entre 2010 y 2012', now)).toEqual(y(2010, 2012))
    expect(explicitDates('poema para Rosa', now)).toBeUndefined()
    expect(explicitDates('pedido 123456 y código 20155', now)).toBeUndefined()
  })

  it('resuelve "año pasado" y "este año" como años calendario', () => {
    expect(explicitDates('cartas del año pasado', now)).toEqual(y(2025))
    expect(explicitDates('lo que escribí el año anterior', now)).toEqual(y(2025))
    expect(explicitDates('documents from last year', now)).toEqual(y(2025))
    expect(explicitDates('contratos de este año', now)).toEqual(y(2026))
  })

  it('sin LLM también filtra por año', async () => {
    const r = await new Orchestrator({ store, embedder }).ask('contrato del 2015')
    expect(r.filter).toEqual(y(2015))
    expect(names(r.matches)).toEqual(['contrato_arriendo_2015.doc'])
  })
})

describe('findInvalidCitations', () => {
  const hit = (path: string): Hit => ({ doc: { path, hash: 'h', size: 1, mtime: 0, ext: 'txt' }, score: 1, snippet: '', lexical: true })
  const hits = [hit('/h/Personal/borrador_final3.docx'), hit('/h/Respaldos/viejo.zip::Poemas/rosa_v1.wpd')]

  it('acepta nombres, rutas y contenedores de los resultados', () => {
    expect(findInvalidCitations('Mira «borrador_final3.docx», rosa_v1.wpd en viejo.zip y /h/Personal/borrador_final3.docx.', hits)).toEqual([])
  })

  it('detecta nombres y rutas ajenos', () => {
    expect(findInvalidCitations('Está en «otro.docx» y en /etc/passwd y en secreto.pdf', hits).sort()).toEqual(['/etc/passwd', 'otro.docx', 'secreto.pdf'].sort())
  })

  it('no confunde títulos, abreviaturas ni "y/o" con archivos', () => {
    expect(findInvalidCitations('El poema «Luz de marzo» (p.ej. el primero) y/o el segundo, versión 3.5.', hits)).toEqual([])
  })
})

describe('pickChatModel', () => {
  it('prefiere la lista conocida y descarta modelos de embeddings', () => {
    expect(pickChatModel(['bge-m3:latest', 'llama3.1:8b', 'qwen3.5:4b'])).toBe('qwen3.5:4b')
    expect(pickChatModel(['bge-m3:latest', 'llama3.1:8b'])).toBe('llama3.1:8b')
    expect(pickChatModel(['nomic-embed-text', 'bge-m3'])).toBeUndefined()
    expect(pickChatModel(['rareza:1b'])).toBe('rareza:1b')
  })
})
