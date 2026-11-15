import { basename } from 'node:path'
import { parseVPath } from '../media'
import type { Confidence, IndexedDoc } from '../memory'
import { lastUsed, type GhostEntry, type GhostKind } from './hunter'

export interface ObituaryFile {
  name: string
  path: string
}

/** Datos de la necrológica de un archivo. Solo hechos presentes en el índice. */
export interface Obituary {
  name: string
  path: string
  /** Respaldo en el que vive, si lo hay. */
  container?: string
  kind: GhostKind
  /** Primer registro conocido. Falta si el sistema de archivos no lo informó. */
  born?: number
  lastUsed: number
  summary?: string
  people: string[]
  topics: string[]
  related: ObituaryFile[]
  resurrected: boolean
  confidence?: Confidence
  /** Datos del grupo de copias o versiones, para mostrar "3 versiones casi idénticas". */
  group?: { kind: 'duplicate' | 'version'; count: number; keeper: ObituaryFile }
}

const toFile = (doc: IndexedDoc): ObituaryFile => {
  const { container, inner } = parseVPath(doc.path)
  return { name: basename(inner ?? container), path: doc.path }
}

/**
 * Arma la necrológica de un fantasma. No inventa nada: cada campo sale del índice. Si un dato no
 * existe (fecha de creación, resumen, personas), se omite.
 */
export function buildObituary(entry: GhostEntry, extra: { people?: string[]; topics?: string[] } = {}): Obituary {
  const { doc, group } = entry
  const { container, inner } = parseVPath(doc.path)
  const obituary: Obituary = {
    name: toFile(doc).name,
    path: doc.path,
    kind: entry.kind,
    lastUsed: lastUsed(doc),
    people: extra.people ?? [],
    topics: extra.topics ?? [],
    related: group ? group.members.filter((m) => m.path !== doc.path).map(toFile) : [],
    resurrected: doc.resurrected === true
  }
  if (inner) obituary.container = container
  if (doc.born !== undefined) obituary.born = doc.born
  if (doc.summary) obituary.summary = doc.summary
  if (doc.confidence) obituary.confidence = doc.confidence
  if (group) obituary.group = { kind: group.kind, count: group.members.length, keeper: toFile(group.keeper) }
  return obituary
}
