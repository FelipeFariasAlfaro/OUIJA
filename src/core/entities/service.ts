import type { IndexedDoc, MemoryStore } from '../memory'
import { isStopword } from '../memory/queryText'
import { normalizeName } from './normalize'
import { resolveEntities } from './resolve'
import type { EntityKind, EntityStore, ResolvedEntity } from './types'

export interface TimelineItem {
  doc: IndexedDoc
  /** Frase del documento donde aparece la entidad, si se encuentra. */
  context?: string
}

export interface Timeline {
  entity: ResolvedEntity
  /** Del más antiguo al más reciente. */
  items: TimelineItem[]
}

const CONTEXT_CHARS = 200

/** Palabras que forman parte de nombres pero no identifican a nadie por sí solas. */
const GENERIC_NAME_WORDS = new Set(
  'sr sra srta don dona doña dr dra doctor doctora senor senora mr mrs ms miss prof profesor profesora proyecto universidad calle avenida ciudad plaza club empresa grupo equipo san santa del'.split(' ')
)

function nameTokens(text: string): string[] {
  return normalizeName(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !isStopword(t) && !GENERIC_NAME_WORDS.has(t))
}

/** Fragmento del texto alrededor de la primera aparición de cualquiera de los nombres. */
export function contextAround(text: string, names: string[]): string | undefined {
  // NFD + quitar marcas conserva las posiciones en texto latino precompuesto.
  const plain = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (plain.length !== text.length) return undefined
  for (const name of names) {
    const needle = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    const at = plain.indexOf(needle)
    if (at < 0) continue
    const start = Math.max(0, at - CONTEXT_CHARS / 2)
    const piece = text.slice(start, at + needle.length + CONTEXT_CHARS / 2).replace(/\s+/g, ' ').trim()
    return `${start > 0 ? '…' : ''}${piece}…`
  }
  return undefined
}

/** Consultas sobre personas, lugares y proyectos, y decisiones manuales de unión o separación. */
export class EntityService {
  constructor(private readonly store: MemoryStore & EntityStore) {}

  async list(kind: EntityKind): Promise<ResolvedEntity[]> {
    const [mentions, links] = await Promise.all([this.store.entityMentions(kind), this.store.entityLinks(kind)])
    return resolveEntities(kind, mentions, links)
  }

  people(): Promise<ResolvedEntity[]> {
    return this.list('person')
  }

  async get(id: string): Promise<ResolvedEntity | undefined> {
    const kind = id.split(':')[0] as EntityKind
    return (await this.list(kind)).find((e) => e.id === id)
  }

  /** Línea de tiempo de una entidad: sus archivos, del más antiguo al más reciente. */
  async timeline(id: string): Promise<Timeline | undefined> {
    const entity = await this.get(id)
    if (!entity) return undefined
    const names = [entity.name, ...entity.aliases]
    const items: TimelineItem[] = []
    for (const path of entity.paths) {
      const doc = await this.store.getDoc(path)
      if (!doc) continue
      const text = await this.store.getText(path)
      items.push({ doc, context: text ? contextAround(text, names) : undefined })
    }
    items.sort((a, b) => a.doc.mtime - b.doc.mtime || a.doc.path.localeCompare(b.doc.path))
    return { entity, items }
  }

  /**
   * Entidades a las que `text` (por ejemplo, una pregunta) se refiere: por su nombre completo o
   * por una de sus palabras ("Rosa" también trae a "Rosa Campos", "Mendoza" a "Luis Mendoza").
   * Prioriza no perder archivos; quien llama decide qué tan relevantes son.
   */
  async mentionedIn(text: string, kinds: EntityKind[] = ['person', 'place', 'project']): Promise<ResolvedEntity[]> {
    const padded = ` ${normalizeName(text)} `
    const words = new Set(nameTokens(text))
    const found: ResolvedEntity[] = []
    for (const kind of kinds) {
      for (const entity of await this.list(kind)) {
        const byFullName = entity.norms.some((n) => n.length >= 3 && padded.includes(` ${n} `))
        const byWord = entity.norms.some((n) => nameTokens(n).some((t) => words.has(t)))
        if (byFullName || byWord) found.push(entity)
      }
    }
    return found
  }

  /** El usuario indica que dos nombres son la misma persona. */
  merge(kind: EntityKind, a: string, b: string): Promise<void> {
    return this.store.setEntityLink({ kind, a: normalizeName(a), b: normalizeName(b), relation: 'same' })
  }

  /** El usuario indica que dos nombres son personas distintas. */
  split(kind: EntityKind, a: string, b: string): Promise<void> {
    return this.store.setEntityLink({ kind, a: normalizeName(a), b: normalizeName(b), relation: 'different' })
  }

  /** Quita una decisión manual y vuelve a la resolución automática. */
  clearDecision(kind: EntityKind, a: string, b: string): Promise<void> {
    return this.store.removeEntityLink(kind, normalizeName(a), normalizeName(b))
  }
}
