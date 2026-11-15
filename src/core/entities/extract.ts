import type { Llm } from '../ai/orchestrator'
import { normalizeName } from './normalize'
import type { EntityKind, EntityStore, ExtractedEntity } from './types'
import type { MemoryStore } from '../memory'

const MAX_TEXT_CHARS = 8000
const MAX_PER_KIND = 30
const MAX_NAME_LENGTH = 60
const MIN_TEXT_CHARS = 40

const SCHEMA = {
  type: 'object',
  properties: {
    people: { type: 'array', items: { type: 'string' } },
    places: { type: 'array', items: { type: 'string' } },
    projects: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' }
  },
  required: ['people', 'places', 'projects', 'summary']
}

/** Palabras que un modelo pequeño confunde con nombres propios. */
const NOT_NAMES = new Set(
  'yo tu tú el él ella usted ustedes nosotros nos ellos ellas señor señora senor senora sr sra srta dr dra don doña dona arrendador arrendatario cliente proveedor usuario autor lector amigo amiga madre padre mama papa hijo hija querido querida estimado estimada atentamente saludos gracias fin'
    .split(' ')
)

function prompt(text: string): string {
  return [
    'Analiza el texto y devuelve JSON con tres listas de nombres propios y un resumen:',
    '- people: personas por su nombre, incluso si aparecen en un título, una dedicatoria ("para Rosa") o una firma. No incluyas pronombres ni cargos sin nombre como "el arrendador".',
    '- places: lugares geográficos (ciudades, países, regiones, calles).',
    '- projects: proyectos, productos u organizaciones con nombre propio.',
    '- summary: una o dos frases, en el idioma del texto, que digan de qué trata el documento. Usa solo lo que dice el texto.',
    'Copia cada nombre exactamente como aparece en el texto. Si no hay ninguno, deja la lista vacía. No inventes.',
    '',
    'Ejemplo de texto: "Hoy hablé con la doctora Salinas sobre el proyecto Aurora en Valparaíso."',
    'Ejemplo de salida: {"people":["doctora Salinas"],"places":["Valparaíso"],"projects":["Aurora"],"summary":"Conversación con la doctora Salinas sobre el proyecto Aurora."}',
    '',
    'Ejemplo de texto: "Carta para Pedro. Querido amigo, te escribo desde Lima."',
    'Ejemplo de salida: {"people":["Pedro"],"places":["Lima"],"projects":[],"summary":"Carta a Pedro escrita desde Lima."}',
    '',
    'Texto:',
    text
  ].join('\n')
}

/** El nombre aparece en el texto (sin importar tildes, mayúsculas ni puntuación). */
function appearsIn(normText: string, norm: string): boolean {
  return ` ${normText} `.includes(` ${norm} `)
}

/**
 * Limpia lo que devuelve el modelo y deja solo entidades con evidencia en el texto: si el nombre no
 * aparece en el documento, se descarta. Así el modelo no puede inventar personas ni lugares.
 */
export function sanitizeEntities(raw: unknown, text: string): ExtractedEntity[] {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const normText = normalizeName(text)
  const out: ExtractedEntity[] = []
  const kinds: [string, EntityKind][] = [
    ['people', 'person'],
    ['places', 'place'],
    ['projects', 'project']
  ]
  for (const [key, kind] of kinds) {
    const list = Array.isArray(obj[key]) ? (obj[key] as unknown[]) : []
    const seen = new Set<string>()
    for (const item of list) {
      if (typeof item !== 'string') continue
      const name = item.trim().replace(/\s+/g, ' ')
      const norm = normalizeName(name)
      if (!name || name.length > MAX_NAME_LENGTH || !norm || seen.has(norm)) continue
      if (norm.split(' ').every((t) => NOT_NAMES.has(t))) continue
      if (kind !== 'project' && !/^\p{Lu}/u.test(name.replace(/^(?:[dD]on|[dD]oña|[dD]r\.?|[dD]ra\.?|[sS]r\.?|[sS]ra\.?|[dD]octora?)\s+/, ''))) continue
      if (!appearsIn(normText, norm)) continue
      seen.add(norm)
      out.push({ kind, name })
      if (seen.size >= MAX_PER_KIND) break
    }
  }
  return out
}

/** Resumen válido: texto corto de una o dos frases. Devuelve `undefined` si no sirve. */
export function sanitizeSummary(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = (raw as Record<string, unknown>).summary
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length >= 10 ? text.slice(0, 400) : undefined
}

export interface TextProfile {
  entities: ExtractedEntity[]
  summary?: string
}

export interface EntityProgress {
  processed: number
  total: number
  current?: string
  errors: number
}

export interface EntityRunOptions {
  signal?: AbortSignal
  onProgress?: (progress: EntityProgress) => void
}

export class EntityExtractor {
  constructor(
    private readonly store: MemoryStore & EntityStore,
    private readonly llm: Llm
  ) {}

  async extractFrom(text: string): Promise<TextProfile> {
    const sample = text.slice(0, MAX_TEXT_CHARS)
    const parsed: unknown = JSON.parse(await this.llm.complete(prompt(sample), { schema: SCHEMA, maxTokens: 500 }))
    return { entities: sanitizeEntities(parsed, sample), summary: sanitizeSummary(parsed) }
  }

  /**
   * Extrae entidades de los documentos que aún no las tienen o cambiaron. Se puede interrumpir y
   * retomar. Un fallo de infraestructura (Ollama caído) se propaga; un documento cuya respuesta no
   * se pudo interpretar queda pendiente para la próxima vez.
   */
  async indexPending(options: EntityRunOptions = {}): Promise<{ processed: number; errors: number }> {
    const docs = await this.store.pendingEntityDocs()
    const progress: EntityProgress = { processed: 0, total: docs.length, errors: 0 }
    options.onProgress?.({ ...progress })

    for (const doc of docs) {
      if (options.signal?.aborted) break
      progress.current = doc.path
      const text = (await this.store.getText(doc.path)) ?? ''
      try {
        const profile: TextProfile = text.length >= MIN_TEXT_CHARS ? await this.extractFrom(text) : { entities: [] }
        await this.store.setEntities(doc.path, profile.entities, profile.summary)
      } catch (error) {
        if ((error as { fatal?: boolean }).fatal === true) throw error
        progress.errors++
      }
      progress.processed++
      options.onProgress?.({ ...progress })
    }
    return { processed: progress.processed, errors: progress.errors }
  }
}
