import type { EntityKind, EntityLink, EntityMention, ResolvedEntity } from './types'

const HONORIFICS = new Set(['sr', 'sra', 'srta', 'don', 'dona', 'doña', 'dr', 'dra', 'mr', 'mrs', 'ms', 'miss', 'prof', 'senor', 'senora'])
const DIMINUTIVES = ['ita', 'ito', 'illa', 'illo', 'ica', 'ico']

/** Tokens del nombre sin tratamientos ("sr", "don", "dra"). Si solo hay tratamientos, se conservan. */
function coreTokens(norm: string): string[] {
  const all = norm.split(' ').filter(Boolean)
  const core = all.filter((t) => !HONORIFICS.has(t))
  return core.length > 0 ? core : all
}

/** `dim` es el diminutivo de `base`: rosa -> rosita, juan -> juanito. */
function isDiminutiveOf(base: string, dim: string): boolean {
  const stem = /[aeo]$/.test(base) ? base.slice(0, -1) : base
  return DIMINUTIVES.some((suffix) => dim === stem + suffix)
}

function tokenEq(x: string, y: string): boolean {
  return x === y || isDiminutiveOf(x, y) || isDiminutiveOf(y, x)
}

/** Cada token de `small` corresponde a un token distinto de `big`. */
function tokensCompatible(small: string[], big: string[]): boolean {
  const used = new Set<number>()
  for (const s of small) {
    const i = big.findIndex((b, idx) => !used.has(idx) && tokenEq(s, b))
    if (i < 0) return false
    used.add(i)
  }
  return true
}

/**
 * `a` es una forma abreviada o cariñosa de `b`: sus tokens caben en `b` y, o `b` tiene más tokens,
 * o alguno de los tokens es un diminutivo ("Rosita" ~ "Rosa").
 */
function isVariantOf(a: string[], b: string[]): boolean {
  if (!tokensCompatible(a, b)) return false
  if (a.length < b.length) return true
  return a.length === b.length && a.some((t, i) => t !== b[i])
}

class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    const p = this.parent.get(x)
    if (p === undefined || p === x) {
      this.parent.set(x, x)
      return x
    }
    const root = this.find(p)
    this.parent.set(x, root)
    return root
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb) // la raíz es la clave menor: resultado estable
  }
}

/**
 * Agrupa menciones en entidades. Dos nombres de persona se unen solo con evidencia: aparecen en un
 * mismo archivo, uno es forma abreviada del otro y no hay ambigüedad. Lo manual manda sobre lo
 * automático: `same` une siempre y `different` impide la unión automática.
 */
export function resolveEntities(kind: EntityKind, mentions: EntityMention[], links: EntityLink[] = []): ResolvedEntity[] {
  // Por nombre normalizado: archivos y variantes de escritura.
  const stats = new Map<string, { paths: Set<string>; names: Map<string, number> }>()
  for (const m of mentions) {
    if (m.kind !== kind) continue
    const s = stats.get(m.norm) ?? { paths: new Set<string>(), names: new Map<string, number>() }
    s.paths.add(m.path)
    s.names.set(m.name, (s.names.get(m.name) ?? 0) + 1)
    stats.set(m.norm, s)
  }
  const norms = [...stats.keys()].sort()

  const uf = new UnionFind()
  for (const n of norms) uf.find(n)

  const mine = links.filter((l) => l.kind === kind)
  const different = new Set(mine.filter((l) => l.relation === 'different').flatMap((l) => [`${l.a}|${l.b}`, `${l.b}|${l.a}`]))

  // 1. Decisiones manuales de unión.
  for (const l of mine) if (l.relation === 'same' && stats.has(l.a) && stats.has(l.b)) uf.union(l.a, l.b)

  const blocked = (x: string, y: string): boolean => {
    const rx = uf.find(x)
    const ry = uf.find(y)
    const left = norms.filter((n) => uf.find(n) === rx)
    const right = norms.filter((n) => uf.find(n) === ry)
    return left.some((l) => right.some((r) => different.has(`${l}|${r}`)))
  }

  // 2. Unión automática de variantes de personas.
  if (kind === 'person') {
    const tokens = new Map(norms.map((n) => [n, coreTokens(n)]))
    for (const a of norms) {
      const ta = tokens.get(a) as string[]
      const candidates = norms.filter((b) => {
        if (b === a) return false
        const shared = [...(stats.get(a) as { paths: Set<string> }).paths].some((p) => (stats.get(b) as { paths: Set<string> }).paths.has(p))
        return shared && isVariantOf(ta, tokens.get(b) as string[])
      })
      if (candidates.length === 0) continue
      // Ambiguo si los candidatos no son variantes entre sí (ej. "Rosa Campos" y "Rosa Pérez").
      const coherent = candidates.every((c1) =>
        candidates.every((c2) => c1 === c2 || tokensCompatible(tokens.get(c1) as string[], tokens.get(c2) as string[]) || tokensCompatible(tokens.get(c2) as string[], tokens.get(c1) as string[]))
      )
      if (!coherent) continue
      for (const c of candidates) if (!blocked(a, c)) uf.union(a, c)
    }
  }

  // 3. Entidades resueltas.
  const components = new Map<string, string[]>()
  for (const n of norms) components.set(uf.find(n), [...(components.get(uf.find(n)) ?? []), n])

  const out: ResolvedEntity[] = []
  for (const members of components.values()) {
    const names = new Map<string, number>()
    const paths = new Set<string>()
    for (const n of members) {
      const s = stats.get(n) as { paths: Set<string>; names: Map<string, number> }
      for (const p of s.paths) paths.add(p)
      for (const [name, count] of s.names) names.set(name, (names.get(name) ?? 0) + count)
    }
    // Nombre para mostrar: el de más palabras; luego el más frecuente; luego el más largo.
    const ranked = [...names.entries()].sort(
      (x, y) => y[0].split(/\s+/).length - x[0].split(/\s+/).length || y[1] - x[1] || y[0].length - x[0].length || x[0].localeCompare(y[0])
    )
    out.push({
      id: `${kind}:${members[0]}`,
      kind,
      name: ranked[0][0],
      aliases: ranked.slice(1).map(([n]) => n).sort(),
      norms: members,
      paths: [...paths].sort()
    })
  }
  return out.sort((a, b) => b.paths.length - a.paths.length || a.name.localeCompare(b.name))
}
