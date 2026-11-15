import { basename } from 'node:path'
import { contextAround, type EntityService } from '../entities'
import { ALL_KINDS, EXTENSIONS_BY_KIND, type FileKind } from '@shared/filetypes'
import type { Embedder } from '../indexing/types'
import { parseVPath } from '../media'
import type { FileFilter, Hit, IndexedDoc, MemoryStore } from '../memory'

export type Lang = 'es' | 'en'

/** Modelo de lenguaje local. `OllamaClient` lo implementa. */
export interface Llm {
  complete(prompt: string, options?: { schema?: object; maxTokens?: number }): Promise<string>
}

export interface AskOptions {
  lang?: Lang
  limit?: number
  /** Fecha de "hoy" para interpretar fechas relativas. */
  now?: Date
}

export interface AskResult {
  answer: string
  /** Archivos relevantes, del más al menos probable. Todos existen en el índice. */
  matches: Hit[]
  found: boolean
  /** `light` = sin modelo de lenguaje (solo búsqueda híbrida y plantilla). */
  mode: 'full' | 'light'
  /** Se repitió la búsqueda sin filtros porque con ellos no hubo resultados. */
  relaxed: boolean
  filter?: FileFilter
  warnings: string[]
}

export interface OrchestratorDeps {
  store: MemoryStore
  embedder: Embedder
  llm?: Llm
  /** Si se entrega, las preguntas que nombran a una persona, lugar o proyecto traen sus archivos. */
  entities?: EntityService
  /** Piso de similitud para considerar un candidato (el LLM filtra después). */
  minSimilarity?: number
  /** Piso más estricto cuando no hay LLM que revise los candidatos. */
  lightMinSimilarity?: number
  /** Cuánto puede alejarse un candidato de la mejor similitud. */
  similarityBand?: number
  candidates?: number
}

const DAY_MS = 24 * 3600 * 1000

const KNOWN_EXTENSIONS = new Set(Object.values(EXTENSIONS_BY_KIND).flat())

/** Tipos que la pregunta pide con todas sus letras ("fotos", "audios", "planillas"), sin depender del modelo. */
const KIND_WORDS_IN_QUESTION: [FileKind, RegExp][] = [
  ['image', /\b(im[aá]genes?|fotos?|fotograf[ií]as?|capturas?|pictures?|images?|photos?|screenshots?)\b/i],
  ['audio', /\b(audios?|m[uú]sica|canci[oó]n(es)?|grabaci[oó]n(es)?|mp3|songs?|music|recordings?)\b/i],
  ['video', /\b(v[ií]deos?|pel[ií]culas?|clips?|movies?)\b/i],
  ['spreadsheet', /\b(planillas?|excel|hojas? de c[aá]lculo|spreadsheets?)\b/i],
  ['presentation', /\b(presentaci[oó]n(es)?|powerpoint|diapositivas?|slides?|presentations?)\b/i],
  ['archive', /\b(comprimidos?|respaldos?|backups?|zips?)\b/i]
]

/** Un tipo de archivo pedido de forma explícita en la pregunta. Si pide varios a la vez, no se filtra. */
export function explicitKind(question: string): FileKind | undefined {
  const found = KIND_WORDS_IN_QUESTION.filter(([, re]) => re.test(question)).map(([kind]) => kind)
  return found.length === 1 ? found[0] : undefined
}

const MESSAGES = {
  es: {
    notFound: 'No encontré nada que coincida con tu pregunta.',
    found: (n: number, name: string, date: string, container?: string) =>
      `Encontré ${n} ${n === 1 ? 'archivo' : 'archivos'}. El más probable es «${name}»${container ? `, dentro de «${container}»,` : ''} del ${date}.`
  },
  en: {
    notFound: "I couldn't find anything matching your question.",
    found: (n: number, name: string, date: string, container?: string) =>
      `I found ${n} ${n === 1 ? 'file' : 'files'}. The most likely is “${name}”${container ? `, inside “${container}”,` : ''} from ${date}.`
  }
} as const

// ---------------------------------------------------------------------------
// Interpretación de la pregunta

export interface ParsedQuery {
  query: string
  filter?: FileFilter
}

const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    extensions: { type: 'array', items: { type: 'string' } },
    kind: { type: 'string' },
    dateFrom: { type: ['string', 'null'] },
    dateTo: { type: ['string', 'null'] }
  },
  required: ['query', 'extensions', 'kind', 'dateFrom', 'dateTo']
}

function parsePrompt(question: string, now: Date): string {
  const today = now.toISOString().slice(0, 10)
  return [
    `Hoy es ${today}. Convierte la pregunta del usuario en una consulta para buscar archivos.`,
    'Devuelve JSON con:',
    '- query: las palabras clave del tema, sin palabras vacías.',
    '- extensions: extensiones SOLO si la pregunta nombra una (pdf, docx, xlsx, png, mp3...); si no, [].',
    '- kind: uno de image, audio, video, document, spreadsheet, presentation, code, archive SOLO si la pregunta pide explícitamente ese tipo ("fotos", "audios", "planillas"); si no, "".',
    '- dateFrom y dateTo (YYYY-MM-DD): SOLO si la pregunta menciona un año o un periodo; si no, null.',
    '',
    'Ejemplos:',
    'Pregunta: ¿dónde está el poema para Rosa?',
    '{"query":"poema Rosa","extensions":[],"kind":"","dateFrom":null,"dateTo":null}',
    'Pregunta: contratos en pdf del 2024',
    '{"query":"contratos","extensions":["pdf"],"kind":"","dateFrom":"2024-01-01","dateTo":"2024-12-31"}',
    'Pregunta: fotos del viaje a Perú',
    '{"query":"viaje Perú","extensions":[],"kind":"image","dateFrom":null,"dateTo":null}',
    '',
    `Pregunta: ${question}`
  ].join('\n')
}

function toDate(value: unknown, endOfDay: boolean): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(ms)) return undefined
  return endOfDay ? ms + DAY_MS - 1 : ms
}

/** Valida lo que devuelve el modelo: descarta todo lo que no sea una extensión o fecha creíble. */
export function sanitizeParsed(raw: unknown, question: string): ParsedQuery {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const query = typeof obj.query === 'string' && obj.query.trim() ? obj.query.trim().slice(0, 300) : question

  const listed = Array.isArray(obj.extensions)
    ? [...new Set(obj.extensions.filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase().replace(/^\./, '')))].filter((e) => KNOWN_EXTENSIONS.has(e))
    : []
  const kind = typeof obj.kind === 'string' && (ALL_KINDS as string[]).includes(obj.kind) && obj.kind !== 'other' ? (obj.kind as FileKind) : undefined
  const extensions = [...new Set([...listed, ...(kind ? EXTENSIONS_BY_KIND[kind] : [])])]
  const dateFrom = toDate(obj.dateFrom, false)
  const dateTo = toDate(obj.dateTo, true)
  const validRange = dateFrom === undefined || dateTo === undefined || dateFrom <= dateTo

  const filter: FileFilter = {}
  if (extensions.length > 0) filter.extensions = extensions
  if (validRange && dateFrom !== undefined) filter.dateFrom = dateFrom
  if (validRange && dateTo !== undefined) filter.dateTo = dateTo
  return { query, filter: Object.keys(filter).length > 0 ? filter : undefined }
}

/**
 * Fechas que la pregunta dice de forma explícita: años de cuatro cifras ("del 2015", "entre 2010 y
 * 2015") y "este año" / "el año pasado". Se resuelve en código porque un modelo pequeño las omite o
 * las malinterpreta (por ejemplo, tomar "año pasado" como los últimos 12 meses).
 */
export function explicitDates(question: string, now: Date): { dateFrom: number; dateTo: number } | undefined {
  const years = [...question.matchAll(/(?<!\d)(19[5-9]\d|20[0-4]\d)(?!\d)/g)].map((m) => Number(m[1]))
  const thisYear = now.getUTCFullYear()
  if (/\b(el\s+)?año\s+(pasado|anterior)\b|\blast\s+year\b/i.test(question)) years.push(thisYear - 1)
  else if (/\beste\s+año\b|\bthis\s+year\b/i.test(question)) years.push(thisYear)
  if (years.length === 0) return undefined
  return { dateFrom: Date.UTC(Math.min(...years), 0, 1), dateTo: Date.UTC(Math.max(...years), 11, 31) + DAY_MS - 1 }
}

// ---------------------------------------------------------------------------
// Verificación de citas (P1)

/** Nombres y rutas que una respuesta tiene permitido mencionar. */
function allowedReferences(hits: Hit[]): { names: Set<string>; paths: string[] } {
  const names = new Set<string>()
  const paths: string[] = []
  for (const h of hits) {
    const { container, inner } = parseVPath(h.doc.path)
    paths.push(h.doc.path, container)
    names.add(basename(container).toLowerCase())
    if (inner) names.add(basename(inner).toLowerCase())
  }
  return { names, paths }
}

const extensionOf = (token: string): string => token.slice(token.lastIndexOf('.') + 1).toLowerCase()
const looksLikeFile = (token: string): boolean => token.includes('.') && KNOWN_EXTENSIONS.has(extensionOf(token))

/**
 * Devuelve las menciones de archivos o rutas de `answer` que no corresponden a ninguno de `hits`.
 * Revisa nombres de archivo (con extensión conocida), entre comillas o sueltos, y cualquier ruta.
 * Un título entre comillas sin forma de archivo o ruta no cuenta como cita.
 */
export function findInvalidCitations(answer: string, hits: Hit[]): string[] {
  const { names, paths } = allowedReferences(hits)
  const lowerPaths = paths.map((p) => p.toLowerCase())
  const invalid = new Set<string>()
  const check = (mention: string) => {
    const m = mention.trim()
    if (!m) return
    const lower = m.toLowerCase()
    const base = basename(lower.replace(/\\/g, '/'))
    const known = names.has(lower) || names.has(base) || lowerPaths.some((p) => p === lower || p.endsWith(lower))
    if (!known) invalid.add(m)
  }

  for (const m of answer.matchAll(/«([^»]+)»|“([^”]+)”|"([^"]+)"/g)) {
    const quoted = (m[1] ?? m[2] ?? m[3]).trim()
    if (looksLikeFile(quoted) || /[/\\]/.test(quoted)) check(quoted)
  }
  for (const m of answer.matchAll(/[\p{L}\p{N}_\-.]+\.[a-zA-Z][a-zA-Z0-9]{1,4}(?![\p{L}\p{N}_])/gu)) {
    if (looksLikeFile(m[0])) check(m[0])
  }
  for (const m of answer.matchAll(/(?<![\p{L}\p{N}])(?:~|[A-Za-z]:\\|\/)[\p{L}\p{N}_\-.~/\\]{2,}/gu)) {
    check(m[0].replace(/[.)]+$/, ''))
  }
  return [...invalid]
}

// ---------------------------------------------------------------------------

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    relevant: { type: 'array', items: { type: 'integer' } },
    answer: { type: 'string' }
  },
  required: ['found', 'relevant', 'answer']
}

interface Judgement {
  found: boolean
  relevant: number[]
  answer: string
}

function formatDate(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-CL' : 'en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(ms)
}

export class Orchestrator {
  private readonly store: MemoryStore
  private readonly embedder: Embedder
  private readonly llm?: Llm
  private readonly entities?: EntityService
  private readonly minSimilarity: number
  private readonly lightMinSimilarity: number
  private readonly band: number
  private readonly candidates: number

  constructor(deps: OrchestratorDeps) {
    this.store = deps.store
    this.embedder = deps.embedder
    this.llm = deps.llm
    this.entities = deps.entities
    this.minSimilarity = deps.minSimilarity ?? 0.45
    this.lightMinSimilarity = deps.lightMinSimilarity ?? 0.47
    this.band = deps.similarityBand ?? 0.15
    this.candidates = deps.candidates ?? 8
  }

  async ask(question: string, options: AskOptions = {}): Promise<AskResult> {
    const lang = options.lang ?? 'es'
    const now = options.now ?? new Date()
    const limit = options.limit ?? 10
    const warnings: string[] = []
    const q = question.trim()
    const base = { mode: this.llm ? ('full' as const) : ('light' as const), relaxed: false, warnings }
    if (!q) return { ...base, answer: MESSAGES[lang].notFound, matches: [], found: false }

    // 1. Entender la pregunta (filtros implícitos).
    let parsed: ParsedQuery = { query: q }
    let mode = base.mode
    if (this.llm) {
      try {
        const raw = await this.llm.complete(parsePrompt(q, now), { schema: PARSE_SCHEMA, maxTokens: 200 })
        parsed = sanitizeParsed(JSON.parse(raw), q)
      } catch (error) {
        if (isInfraError(error)) mode = 'light'
        warnings.push(`No se pudo interpretar la pregunta con el modelo: ${messageOf(error)}`)
      }
    }

    // Lo que la pregunta dice de forma explícita (fechas, tipo) manda sobre lo que haya inferido el modelo.
    const explicit = explicitDates(q, now)
    if (explicit) parsed = { ...parsed, filter: { ...parsed.filter, ...explicit } }
    const kind = explicitKind(q)
    if (kind) parsed = { ...parsed, filter: { ...parsed.filter, extensions: EXTENSIONS_BY_KIND[kind] } }

    // 2. Vector de la pregunta completa (si el embedder falla, queda solo la búsqueda léxica).
    let embedding: Float32Array | undefined
    try {
      embedding = (await this.embedder.embed([q]))[0]
    } catch (error) {
      warnings.push(`Búsqueda semántica no disponible: ${messageOf(error)}`)
    }

    // 3. Buscar; si los filtros inferidos no dejan nada, repetir sin ellos.
    const floor = mode === 'full' ? this.minSimilarity : this.lightMinSimilarity
    const text = `${parsed.query} ${q}`
    let hits = await this.search(q, text, embedding, parsed.filter, floor)
    let relaxed = false
    if (hits.length === 0 && parsed.filter) {
      hits = await this.search(q, text, embedding, undefined, floor)
      relaxed = hits.length > 0
    }
    if (hits.length === 0) {
      return { answer: MESSAGES[lang].notFound, matches: [], found: false, mode, relaxed: false, filter: parsed.filter, warnings }
    }

    // 4. Redactar: el LLM revisa los candidatos y escribe la respuesta; sin LLM, una plantilla.
    let matches = hits
    let answer: string | undefined
    if (mode === 'full' && this.llm) {
      try {
        const judged = await this.judge(this.llm, q, hits, lang)
        if (!judged.found) {
          return { answer: MESSAGES[lang].notFound, matches: [], found: false, mode, relaxed, filter: parsed.filter, warnings }
        }
        matches = judged.matches
        answer = judged.answer
      } catch (error) {
        mode = 'light'
        warnings.push(`No se pudo redactar con el modelo: ${messageOf(error)}`)
        // Sin modelo que revise, se aplica el piso más estricto del modo ligero.
        matches = hits.filter((h) => h.lexical || (h.similarity ?? 0) >= this.lightMinSimilarity)
      }
    }
    matches = (await this.onlyIndexed(matches)).slice(0, limit)
    if (matches.length === 0) {
      return { answer: MESSAGES[lang].notFound, matches: [], found: false, mode, relaxed, filter: parsed.filter, warnings }
    }

    // P1: la respuesta solo puede mencionar archivos que existen en el índice y están entre los resultados.
    if (answer !== undefined && findInvalidCitations(answer, matches).length > 0) {
      warnings.push('La respuesta del modelo mencionaba archivos no verificados; se usó una respuesta estándar.')
      answer = undefined
    }
    answer ??= this.template(matches, lang)
    return { answer, matches, found: true, mode, relaxed, filter: parsed.filter, warnings }
  }

  private async search(
    question: string,
    text: string,
    embedding: Float32Array | undefined,
    filter: FileFilter | undefined,
    floor: number
  ): Promise<Hit[]> {
    const found = await this.store.search({ text, embedding, filter, limit: this.candidates })
    const best = Math.max(0, ...found.map((h) => h.similarity ?? 0))
    const hits = found.filter((h) => h.lexical || ((h.similarity ?? 0) >= floor && (h.similarity ?? 0) >= best - this.band))

    // Archivos de las personas, lugares o proyectos nombrados en la pregunta.
    const byPath = new Map(hits.map((h) => [h.doc.path, h]))
    for (const e of await this.entityHits(question, filter)) {
      const existing = byPath.get(e.doc.path)
      if (existing) existing.viaEntity = e.viaEntity // ya estaba, pero hay que recordar por qué importa
      else hits.push(e)
    }
    return hits
  }

  private async entityHits(question: string, filter: FileFilter | undefined): Promise<Hit[]> {
    if (!this.entities) return []
    const out = new Map<string, Hit>()
    for (const entity of await this.entities.mentionedIn(question)) {
      const names = [entity.name, ...entity.aliases]
      for (const path of entity.paths) {
        if (out.has(path)) continue
        const doc = await this.store.getDoc(path)
        if (!doc || !matchesFilter(doc, filter)) continue
        const text = await this.store.getText(path)
        const snippet = (text && contextAround(text, names)) || doc.summary || (text ?? '').slice(0, 240)
        out.set(path, { doc, score: 0.5, snippet, lexical: true, viaEntity: entity.name })
      }
    }
    return [...out.values()].sort((a, b) => b.doc.mtime - a.doc.mtime).slice(0, this.candidates)
  }

  private async judge(llm: Llm, question: string, hits: Hit[], lang: Lang): Promise<{ found: boolean; matches: Hit[]; answer: string }> {
    const list = hits
      .map((h, i) => {
        const { container, inner } = parseVPath(h.doc.path)
        const name = basename(inner ?? container)
        const where = inner ? ` (dentro de ${basename(container)})` : ''
        const summary = h.doc.summary ? ` Resumen: ${h.doc.summary}` : ''
        const via = h.viaEntity ? ` Menciona a «${h.viaEntity}».` : ''
        return `[${i + 1}] ${name}${where}, modificado el ${formatDate(h.doc.mtime, lang)}.${via}${summary} Fragmento: ${h.snippet}`
      })
      .join('\n')
    const language = lang === 'es' ? 'español' : 'English'
    const prompt = [
      `Eres el buscador de archivos personales de un usuario. Responde en ${language}.`,
      'Estos son los únicos archivos candidatos. No existen otros:',
      list,
      '',
      `Pregunta: ${question}`,
      '',
      'Devuelve JSON con:',
      '- found: true si algún archivo responde la pregunta; false si ninguno.',
      '- relevant: los números de los archivos que responden, del más al menos probable.',
      '- answer: respuesta breve (1 a 3 frases). Nombra cada archivo exactamente como aparece, entre «». No menciones rutas ni archivos que no estén en la lista. Si found es false, deja answer vacío.'
    ].join('\n')

    const judgement = JSON.parse(await llm.complete(prompt, { schema: JUDGE_SCHEMA, maxTokens: 300 })) as Partial<Judgement>

    // Los archivos de una persona, lugar o proyecto nombrado en la pregunta se conservan siempre:
    // el modelo puede dudar de que "Rosa Campos" sea "Rosa", pero el usuario preguntó por ella.
    const viaEntity = hits.filter((h) => h.viaEntity)
    if (judgement.found !== true) {
      return viaEntity.length > 0
        ? { found: true, matches: viaEntity, answer: this.template(viaEntity, lang) }
        : { found: false, matches: [], answer: '' }
    }

    const picked = [...new Set(Array.isArray(judgement.relevant) ? judgement.relevant : [])]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= hits.length)
      .map((n) => hits[n - 1])
    const base = picked.length > 0 ? picked : [hits[0]]
    const matches = [...base, ...viaEntity.filter((h) => !base.includes(h))]
    const answer = typeof judgement.answer === 'string' && judgement.answer.trim() ? judgement.answer.trim() : undefined
    // Si se agregaron archivos que la respuesta del modelo no menciona, la respuesta ya no los describe bien.
    const complete = matches.length === base.length
    return { found: true, matches, answer: complete ? (answer ?? this.template(matches, lang)) : this.template(matches, lang) }
  }

  /** Descarta resultados cuyo archivo se olvidó mientras se respondía. */
  private async onlyIndexed(hits: Hit[]): Promise<Hit[]> {
    const ok: Hit[] = []
    for (const h of hits) if (await this.store.hasPath(h.doc.path)) ok.push(h)
    return ok
  }

  private template(matches: Hit[], lang: Lang): string {
    const top = matches[0]
    const { container, inner } = parseVPath(top.doc.path)
    return MESSAGES[lang].found(
      matches.length,
      basename(inner ?? container),
      formatDate(top.doc.mtime, lang),
      inner ? basename(container) : undefined
    )
  }
}

function matchesFilter(doc: IndexedDoc, filter: FileFilter | undefined): boolean {
  if (!filter) return true
  if (filter.extensions && filter.extensions.length > 0 && !filter.extensions.includes(doc.ext)) return false
  if (filter.folder && !doc.path.startsWith(filter.folder)) return false
  if (filter.dateFrom !== undefined && doc.mtime < filter.dateFrom) return false
  if (filter.dateTo !== undefined && doc.mtime > filter.dateTo) return false
  return true
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isInfraError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { fatal?: boolean }).fatal === true
}
