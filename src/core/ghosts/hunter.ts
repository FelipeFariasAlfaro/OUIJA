import { isContainerPath, isVirtualPath } from '../media'
import type { IndexedDoc, MemoryStore } from '../memory'
import { bandKeys, estimateJaccard, shingles, signature } from './minhash'

export type GhostKind = 'duplicate' | 'version' | 'stale'

export interface GhostOptions {
  /** "Ahora" en ms; se inyecta en pruebas. */
  now?: number
  /** Sin abrir ni modificar desde hace más de esto (por defecto 3 años). */
  staleAfterMs?: number
  /** Similitud mínima de contenido para considerar dos archivos versiones del mismo (0 a 1). */
  versionThreshold?: number
  folder?: string
}

export interface GhostGroup {
  id: string
  /** `duplicate` si todos los miembros son idénticos byte a byte; `version` si hay diferencias. */
  kind: 'duplicate' | 'version'
  members: IndexedDoc[]
  /** El miembro más reciente: el que conviene conservar. */
  keeper: IndexedDoc
}

export interface GhostEntry {
  doc: IndexedDoc
  /** Motivo principal: duplicado > versión > sin uso. */
  kind: GhostKind
  kinds: GhostKind[]
  /** Último uso conocido: el mayor entre acceso y modificación. */
  lastUsed: number
  group?: GhostGroup
}

export interface GhostReport {
  ghosts: GhostEntry[]
  groups: GhostGroup[]
  scanned: number
}

export const THREE_YEARS_MS = 3 * 365.25 * 24 * 3600 * 1000
const DEFAULT_VERSION_THRESHOLD = 0.6

export const lastUsed = (doc: IndexedDoc): number => Math.max(doc.atime ?? 0, doc.mtime)

/** Archivos con vida propia: se excluyen los respaldos en sí (lo que importa es lo que contienen). */
export function isDocument(doc: IndexedDoc): boolean {
  return isVirtualPath(doc.path) || !isContainerPath(doc.path)
}

class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    let root = this.parent.get(x) ?? x
    if (root !== x) {
      root = this.find(root)
      this.parent.set(x, root)
    } else this.parent.set(x, x)
    return root
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

/** El más reciente; con empate de fecha, el de ruta menor, para que el resultado sea estable. */
function pickKeeper(members: IndexedDoc[]): IndexedDoc {
  return [...members].sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))[0]
}

/**
 * Busca archivos fantasma: duplicados exactos, versiones casi idénticas y archivos sin uso.
 * Solo lee el índice. Nunca toca los archivos del usuario.
 */
export class GhostHunter {
  private readonly signatures = new Map<string, Uint32Array | null>()

  constructor(private readonly store: MemoryStore) {}

  async scan(options: GhostOptions = {}): Promise<GhostReport> {
    const now = options.now ?? Date.now()
    const staleAfter = options.staleAfterMs ?? THREE_YEARS_MS
    const threshold = options.versionThreshold ?? DEFAULT_VERSION_THRESHOLD

    const docs = (await this.store.listFiles(options.folder ? { folder: options.folder } : undefined)).filter(isDocument)

    // 1. Duplicados exactos: mismo contenido (hash).
    const byHash = new Map<string, IndexedDoc[]>()
    for (const d of docs) byHash.set(d.hash, [...(byHash.get(d.hash) ?? []), d])

    // 2. Versiones casi idénticas entre contenidos distintos: MinHash + LSH sobre un representante por hash.
    const reps = [...byHash.entries()].map(([hash, list]) => ({ hash, doc: list[0] }))
    const sigs = new Map<string, Uint32Array>()
    for (const r of reps) {
      const sig = await this.signatureOf(r.hash, r.doc.path)
      if (sig) sigs.set(r.hash, sig)
    }
    const uf = new UnionFind()
    const buckets = new Map<string, string[]>()
    for (const [hash, sig] of sigs) {
      for (const key of bandKeys(sig)) buckets.set(key, [...(buckets.get(key) ?? []), hash])
    }
    const checked = new Set<string>()
    for (const members of buckets.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const pair = members[i] < members[j] ? `${members[i]}|${members[j]}` : `${members[j]}|${members[i]}`
          if (checked.has(pair)) continue
          checked.add(pair)
          if (estimateJaccard(sigs.get(members[i]) as Uint32Array, sigs.get(members[j]) as Uint32Array) >= threshold) {
            uf.union(members[i], members[j])
          }
        }
      }
    }

    // 3. Componentes: cada uno junta todos los archivos de sus hashes.
    const components = new Map<string, IndexedDoc[]>()
    for (const [hash, list] of byHash) {
      const root = uf.find(hash)
      components.set(root, [...(components.get(root) ?? []), ...list])
    }
    const groups: GhostGroup[] = []
    const groupOf = new Map<string, GhostGroup>()
    for (const members of components.values()) {
      if (members.length < 2) continue
      const keeper = pickKeeper(members)
      const kind = new Set(members.map((m) => m.hash)).size === 1 ? 'duplicate' : 'version'
      const group: GhostGroup = { id: `group:${keeper.path}`, kind, members: members.sort((a, b) => a.path.localeCompare(b.path)), keeper }
      groups.push(group)
      for (const m of members) groupOf.set(m.path, group)
    }

    // 4. Fantasmas: los miembros de un grupo que no son el más reciente, y todo lo sin uso.
    const ghosts: GhostEntry[] = []
    for (const doc of docs) {
      const kinds: GhostKind[] = []
      const group = groupOf.get(doc.path)
      if (group && group.keeper.path !== doc.path) kinds.push(group.kind)
      const used = lastUsed(doc)
      if (now - used > staleAfter) kinds.push('stale')
      if (kinds.length === 0) continue
      ghosts.push({ doc, kind: kinds[0], kinds, lastUsed: used, group })
    }
    ghosts.sort((a, b) => a.lastUsed - b.lastUsed || a.doc.path.localeCompare(b.doc.path))
    return { ghosts, groups, scanned: docs.length }
  }

  private async signatureOf(hash: string, path: string): Promise<Uint32Array | null> {
    if (this.signatures.has(hash)) return this.signatures.get(hash) ?? null
    const text = await this.store.getText(path)
    const sig = text ? signature(shingles(text)) : null
    this.signatures.set(hash, sig)
    return sig
  }
}
