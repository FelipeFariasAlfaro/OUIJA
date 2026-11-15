import type { IndexedDoc } from '../memory'

export type EntityKind = 'person' | 'place' | 'project'

export interface ExtractedEntity {
  kind: EntityKind
  name: string
}

/** Una aparición de una entidad en un archivo. */
export interface EntityMention {
  kind: EntityKind
  /** Como aparece en el texto. */
  name: string
  /** Forma normalizada (clave de comparación). */
  norm: string
  path: string
}

export type LinkRelation = 'same' | 'different'

/** Decisión manual del usuario sobre dos nombres normalizados. */
export interface EntityLink {
  kind: EntityKind
  a: string
  b: string
  relation: LinkRelation
}

/** Almacén de entidades. `SqliteStore` lo implementa junto con `MemoryStore`. */
export interface EntityStore {
  /**
   * Reemplaza las entidades del archivo y lo marca como procesado para su contenido actual.
   * Si se entrega `summary`, también lo guarda como resumen del archivo.
   */
  setEntities(path: string, entities: ExtractedEntity[], summary?: string): Promise<void>
  /** Documentos con texto cuyas entidades aún no se extrajeron (o cambiaron desde entonces). */
  pendingEntityDocs(): Promise<IndexedDoc[]>
  entityMentions(kind?: EntityKind): Promise<EntityMention[]>
  setEntityLink(link: EntityLink): Promise<void>
  removeEntityLink(kind: EntityKind, a: string, b: string): Promise<void>
  entityLinks(kind?: EntityKind): Promise<EntityLink[]>
}

export interface ResolvedEntity {
  /** Estable mientras no cambie su conjunto de nombres. */
  id: string
  kind: EntityKind
  /** Nombre para mostrar: la forma más completa. */
  name: string
  aliases: string[]
  /** Nombres normalizados que la componen. */
  norms: string[]
  /** Archivos donde aparece. */
  paths: string[]
}
