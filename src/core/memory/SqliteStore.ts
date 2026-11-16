import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import * as sqliteVec from 'sqlite-vec'
import { normalizeName } from '../entities/normalize'
import type { EntityKind, EntityLink, EntityMention, EntityStore, ExtractedEntity } from '../entities/types'
import type { ChangeInput } from '../indexing/types'
import type { MemoryStore } from './MemoryStore'
import { toFtsAllQuery, toFtsQuery } from './queryText'
import type { Chunk, Confidence, FileFilter, Hit, HybridQuery, IndexedDoc } from './types'

export interface SqliteStoreOptions {
  /** Dimensión de los embeddings (depende del modelo). */
  dimensions: number
}

/**
 * Versión de la lógica de indexación. Si sube (por ejemplo, ahora se indexan todos los tipos de archivo
 * y hay fragmentos de metadatos), el índice anterior se descarta y se rehace, conservando las
 * decisiones manuales sobre nombres.
 */
/** 3: historiales de MSN, correo antiguo, fecha EXIF de las fotos y columna `origin` (se reindexa todo). */
export const INDEX_VERSION = 3

const RRF_K = 60
const DEFAULT_LIMIT = 10
const MAX_CANDIDATES = 200
const SNIPPET_LENGTH = 240

type Row = Record<string, unknown>

export class SqliteStore implements MemoryStore, EntityStore {
  private readonly db: DatabaseSync
  private readonly dimensions: number

  constructor(location: string, options: SqliteStoreOptions) {
    if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
      throw new Error('dimensions debe ser un entero positivo')
    }
    this.dimensions = options.dimensions
    this.db = new DatabaseSync(location, { allowExtension: true })
    // En la aplicación empaquetada la librería nativa está fuera del .asar: el sistema no puede cargarla desde dentro.
    this.db.loadExtension(sqliteVec.getLoadablePath().replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'))
    // La aplicación y el servidor MCP pueden tener el índice abierto a la vez: lectores y escritor no se bloquean.
    if (location !== ':memory:') this.db.exec('pragma journal_mode = wal; pragma busy_timeout = 5000;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists meta(key text primary key, value text not null);
      create table if not exists files(
        id integer primary key,
        path text not null unique,
        hash text not null,
        size integer not null,
        mtime integer not null,
        atime integer,
        born integer,
        ext text not null,
        summary text,
        container text,
        confidence text,
        resurrected integer not null default 0,
        error text
      );
      create table if not exists chunks(
        id integer primary key,
        file_id integer not null references files(id) on delete cascade,
        ord integer not null,
        text text not null,
        meta integer not null default 0
      );
      create index if not exists chunks_file on chunks(file_id);
      create table if not exists entity_mentions(
        file_id integer not null references files(id) on delete cascade,
        kind text not null,
        name text not null,
        norm text not null,
        primary key(file_id, kind, norm)
      );
      create index if not exists entity_mentions_norm on entity_mentions(kind, norm);
      create table if not exists changes(
        id integer primary key,
        ts integer not null,
        kind text not null,
        path text not null,
        name text not null,
        ext text not null,
        size integer not null,
        summary text
      );
      create index if not exists changes_path on changes(path);
      create table if not exists entity_links(
        kind text not null,
        a text not null,
        b text not null,
        relation text not null check(relation in ('same', 'different')),
        primary key(kind, a, b)
      );
      create virtual table if not exists chunks_fts using fts5(text, tokenize='unicode61 remove_diacritics 2');
    `)

    // Bases creadas antes de existir `born`.
    const columns = this.db.prepare('pragma table_info(files)').all() as Row[]
    if (!columns.some((c) => c.name === 'born')) this.db.exec('alter table files add column born integer')
    const chunkColumns = this.db.prepare('pragma table_info(chunks)').all() as Row[]
    if (!chunkColumns.some((c) => c.name === 'meta')) this.db.exec('alter table chunks add column meta integer not null default 0')
    if (!columns.some((c) => c.name === 'ocr_hash')) this.db.exec('alter table files add column ocr_hash text')
    if (!columns.some((c) => c.name === 'entities_hash')) this.db.exec('alter table files add column entities_hash text')
    if (!columns.some((c) => c.name === 'origin')) this.db.exec('alter table files add column origin text')

    const stored = this.db.prepare("select value from meta where key = 'dimensions'").get() as
      | Row
      | undefined
    if (stored && Number(stored.value) !== this.dimensions) {
      throw new Error(
        `El índice usa embeddings de ${String(stored.value)} dimensiones; se pidieron ${this.dimensions}. Reindexa.`
      )
    }
    if (!stored) {
      this.db.prepare("insert into meta(key, value) values ('dimensions', ?)").run(String(this.dimensions))
    }
    this.db.exec(
      `create virtual table if not exists chunk_vec using vec0(embedding float[${this.dimensions}])`
    )

    const version = this.db.prepare("select value from meta where key = 'index_version'").get() as Row | undefined
    if (Number(version?.value ?? 1) < INDEX_VERSION) {
      this.clearIndex()
      this.db.prepare("insert into meta(key, value) values ('index_version', ?) on conflict(key) do update set value = excluded.value").run(String(INDEX_VERSION))
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private toVector(embedding: Float32Array): Uint8Array {
    if (embedding.length !== this.dimensions) {
      throw new Error(`Embedding de ${embedding.length} dimensiones; se esperaban ${this.dimensions}`)
    }
    return new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength)
  }

  /** Borra los fragmentos (texto, FTS y vectores) de un archivo. */
  private deleteChunksOf(fileId: number): void {
    const ids = (this.db.prepare('select id from chunks where file_id = ?').all(fileId) as Row[]).map(
      (r) => r.id as number
    )
    const delFts = this.db.prepare('delete from chunks_fts where rowid = ?')
    const delVec = this.db.prepare('delete from chunk_vec where rowid = ?')
    for (const id of ids) {
      delFts.run(id)
      delVec.run(BigInt(id))
    }
    this.db.prepare('delete from chunks where file_id = ?').run(fileId)
  }

  async upsert(doc: IndexedDoc, chunks: Chunk[]): Promise<void> {
    // Validar antes de tocar la base para no dejar estados a medias.
    const vectors = chunks.map((c) => this.toVector(c.embedding))

    this.transaction(() => {
      const params: SQLInputValue[] = [
        doc.path,
        doc.hash,
        doc.size,
        doc.mtime,
        doc.atime ?? null,
        doc.born ?? null,
        doc.ext,
        doc.summary ?? null,
        doc.container ?? null,
        doc.confidence ?? null,
        doc.resurrected ? 1 : 0,
        doc.error ?? null,
        doc.origin ?? null
      ]
      this.db
        .prepare(
          `insert into files(path, hash, size, mtime, atime, born, ext, summary, container, confidence, resurrected, error, origin)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(path) do update set
             hash = excluded.hash, size = excluded.size, mtime = excluded.mtime, atime = excluded.atime, born = excluded.born,
             ext = excluded.ext, summary = excluded.summary, container = excluded.container,
             confidence = excluded.confidence, resurrected = excluded.resurrected, error = excluded.error, origin = excluded.origin`
        )
        .run(...params)

      const fileId = (this.db.prepare('select id from files where path = ?').get(doc.path) as Row).id as number
      this.deleteChunksOf(fileId)
      // El contenido cambió: las entidades extraídas del anterior ya no valen.
      this.db.prepare('delete from entity_mentions where file_id = ?').run(fileId)
      this.db.prepare('update files set entities_hash = null, ocr_hash = null where id = ?').run(fileId)

      const insChunk = this.db.prepare('insert into chunks(file_id, ord, text, meta) values (?, ?, ?, ?)')
      const insFts = this.db.prepare('insert into chunks_fts(rowid, text) values (?, ?)')
      const insVec = this.db.prepare('insert into chunk_vec(rowid, embedding) values (?, ?)')
      chunks.forEach((chunk, i) => {
        const info = insChunk.run(fileId, chunk.ord, chunk.text, chunk.meta ? 1 : 0)
        const chunkId = Number(info.lastInsertRowid)
        insFts.run(chunkId, chunk.text)
        insVec.run(BigInt(chunkId), vectors[i])
      })
    })
  }

  async forget(path: string): Promise<void> {
    this.transaction(() => {
      const rows = this.db
        .prepare('select id from files where path = ? or substr(path, 1, ?) = ?')
        .all(path, path.length + 2, `${path}::`) as Row[]
      for (const row of rows) {
        const id = row.id as number
        this.deleteChunksOf(id)
        this.db.prepare('delete from files where id = ?').run(id)
      }
    })
  }

  /** Borra todo lo indexado (archivos, fragmentos, vectores y entidades). Las decisiones manuales se conservan. */
  private clearIndex(): void {
    this.db.exec('delete from chunks_fts; delete from chunk_vec; delete from chunks; delete from entity_mentions; delete from changes; delete from files;')
  }

  async forgetAll(): Promise<void> {
    this.transaction(() => {
      this.clearIndex()
      this.db.exec('delete from entity_links;')
    })
  }

  async hasPath(path: string): Promise<boolean> {
    return this.db.prepare('select 1 from files where path = ?').get(path) !== undefined
  }

  async getDoc(path: string): Promise<IndexedDoc | undefined> {
    const row = this.db.prepare('select * from files where path = ?').get(path) as Row | undefined
    return row ? rowToDoc(row) : undefined
  }

  async pendingOcrDocs(extensions: string[], maxSize: number): Promise<IndexedDoc[]> {
    if (extensions.length === 0) return []
    const rows = this.db
      .prepare(
        `select f.* from files f
         where f.ext in (${extensions.map(() => '?').join(',')})
           and f.size <= ? and f.size > 0 and f.error is null
           and instr(f.path, '::') = 0
           and (f.ocr_hash is null or f.ocr_hash != f.hash)
         order by f.size`
      )
      .all(...extensions, maxSize) as Row[]
    return rows.map(rowToDoc)
  }

  async markOcrDone(path: string): Promise<void> {
    this.db.prepare('update files set ocr_hash = hash where path = ?').run(path)
  }

  async getText(path: string): Promise<string | undefined> {
    const file = this.db.prepare('select id from files where path = ?').get(path) as Row | undefined
    if (!file) return undefined
    const rows = this.db.prepare('select text from chunks where file_id = ? and meta = 0 order by ord').all(file.id as number) as Row[]
    return rows.map((r) => r.text as string).join('\n')
  }

  async extensionCounts(): Promise<{ ext: string; count: number }[]> {
    const rows = this.db.prepare('select ext, count(*) as n from files group by ext').all() as Row[]
    return rows.map((r) => ({ ext: r.ext as string, count: r.n as number }))
  }

  async listFiles(filter?: FileFilter): Promise<IndexedDoc[]> {
    const { clause, params } = this.filterSql(filter)
    const rows = this.db
      .prepare(`select f.* from files f ${clause ? `where ${clause}` : ''} order by f.path`)
      .all(...params) as Row[]
    return rows.map(rowToDoc)
  }

  async search(query: HybridQuery): Promise<Hit[]> {
    const limit = query.limit ?? DEFAULT_LIMIT
    const candidates = Math.min(MAX_CANDIDATES, Math.max(limit * 10, 50))
    const scores = new Map<number, number>()
    const addRanks = (ids: number[], weight = 1): void => {
      ids.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + weight / (RRF_K + rank + 1)))
    }

    const lexicalIds = new Set<number>()
    const distances = new Map<number, number>()

    const match = query.text ? toFtsQuery(query.text) : null
    if (match) {
      const rows = this.db
        .prepare('select rowid as id from chunks_fts where chunks_fts match ? order by rank limit ?')
        .all(match, candidates) as Row[]
      const ids = rows.map((r) => r.id as number)
      ids.forEach((id) => lexicalIds.add(id))
      addRanks(ids)

      // Los fragmentos que contienen TODAS las palabras suben: "logo haka lens" prefiere el archivo con las tres.
      const all = query.text ? toFtsAllQuery(query.text) : null
      if (all) {
        const strict = this.db.prepare('select rowid as id from chunks_fts where chunks_fts match ? order by rank limit ?').all(all, candidates) as Row[]
        addRanks(strict.map((r) => r.id as number), 1.5)
      }
    }

    if (query.embedding) {
      const rows = this.db
        .prepare('select rowid as id, distance from chunk_vec where embedding match ? and k = ? order by distance')
        .all(this.toVector(query.embedding), candidates) as Row[]
      for (const r of rows) distances.set(r.id as number, r.distance as number)
      addRanks(rows.map((r) => r.id as number))
    }

    if (scores.size === 0) return []

    const ids = [...scores.keys()]
    const { clause, params } = this.filterSql(query.filter)
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(
        `select c.id as chunk_id, c.text as chunk_text, c.meta as chunk_meta, f.*
         from chunks c join files f on f.id = c.file_id
         where c.id in (${placeholders}) ${clause ? `and ${clause}` : ''}`
      )
      .all(...ids, ...params) as Row[]

    // Mejor fragmento por archivo; la similitud es la del fragmento más cercano.
    const best = new Map<string, Hit>()
    const snippetIsMeta = new Map<string, boolean>()
    for (const row of rows) {
      const chunkId = row.chunk_id as number
      const score = scores.get(chunkId) ?? 0
      const doc = rowToDoc(row)
      const distance = distances.get(chunkId)
      // Con vectores unitarios: coseno = 1 - d²/2.
      const similarity = distance === undefined ? undefined : Math.max(0, Math.min(1, 1 - (distance * distance) / 2))
      const lexical = lexicalIds.has(chunkId)
      const isMeta = row.chunk_meta === 1
      const current = best.get(doc.path)
      if (!current) {
        best.set(doc.path, { doc, score, snippet: trimSnippet(row.chunk_text as string), similarity, lexical })
        snippetIsMeta.set(doc.path, isMeta)
        continue
      }
      // El fragmento mostrado es el de contenido mejor puntuado; el de metadatos solo si no hay otro.
      const showsMeta = snippetIsMeta.get(doc.path) === true
      if ((showsMeta && !isMeta) || (showsMeta === isMeta && score > current.score)) {
        current.snippet = trimSnippet(row.chunk_text as string)
        snippetIsMeta.set(doc.path, isMeta)
      }
      if (score > current.score) current.score = score
      if (similarity !== undefined) current.similarity = Math.max(current.similarity ?? 0, similarity)
      current.lexical ||= lexical
    }
    for (const hit of best.values()) hit.snippetKind = snippetIsMeta.get(hit.doc.path) ? 'meta' : 'content'
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit)
  }

  // --- Entidades ---------------------------------------------------------

  // --- Cambios detectados -------------------------------------------------

  /** Anota un cambio. Si el mismo archivo cambió hace un momento (se está escribiendo), se junta con el anterior. */
  recordChange(c: ChangeInput): void {
    const ts = c.ts ?? Date.now()
    const last = this.db.prepare('select id, kind, ts from changes where path = ? order by id desc limit 1').get(c.path) as Row | undefined
    if (last && last.kind === c.kind && ts - (last.ts as number) < 60_000 && c.kind !== 'removed') {
      this.db.prepare('update changes set ts = ?, size = ?, summary = coalesce(?, summary) where id = ?').run(ts, c.size, c.summary ?? null, last.id as number)
      return
    }
    this.db.prepare('insert into changes(ts, kind, path, name, ext, size, summary) values (?, ?, ?, ?, ?, ?, ?)').run(ts, c.kind, c.path, c.name, c.ext, c.size, c.summary ?? null)
    this.db.exec('delete from changes where id <= (select max(id) from changes) - 1000')
  }

  /** Lo que se sabía de archivos ya eliminados (el resumen que tenían), por ruta. */
  knownSummaries(paths: string[]): Map<string, string> {
    const out = new Map<string, string>()
    for (let i = 0; i < paths.length; i += 500) {
      const chunk = paths.slice(i, i + 500)
      const rows = this.db
        .prepare(`select path, summary from changes where kind = 'removed' and summary is not null and path in (${chunk.map(() => '?').join(',')}) order by id`)
        .all(...chunk) as Row[]
      for (const r of rows) out.set(r.path as string, r.summary as string)
    }
    return out
  }

  /** Lo último que cambió, lo más reciente primero. Para lo que sigue en el índice, el resumen es el actual. */
  recentChanges(limit = 30): (ChangeInput & { id: number; ts: number; exists: boolean })[] {
    const rows = this.db
      .prepare(
        `select c.id, c.ts, c.kind, c.path, c.name, c.ext, c.size, coalesce(f.summary, c.summary) as summary, f.path is not null as present
         from changes c left join files f on f.path = c.path
         order by c.id desc limit ?`
      )
      .all(Math.max(1, Math.min(limit, 200))) as Row[]
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as number,
      kind: r.kind as ChangeInput['kind'],
      path: r.path as string,
      name: r.name as string,
      ext: r.ext as string,
      size: r.size as number,
      ...(r.summary ? { summary: r.summary as string } : {}),
      exists: r.present === 1
    }))
  }

  async setEntities(path: string, entities: ExtractedEntity[], summary?: string): Promise<void> {
    this.transaction(() => {
      const file = this.db.prepare('select id, hash from files where path = ?').get(path) as Row | undefined
      if (!file) return
      const id = file.id as number
      this.db.prepare('delete from entity_mentions where file_id = ?').run(id)
      const ins = this.db.prepare('insert or ignore into entity_mentions(file_id, kind, name, norm) values (?, ?, ?, ?)')
      for (const e of entities) {
        const norm = normalizeName(e.name)
        if (norm) ins.run(id, e.kind, e.name, norm)
      }
      this.db.prepare('update files set entities_hash = ? where id = ?').run(file.hash as string, id)
      if (summary) this.db.prepare('update files set summary = ? where id = ?').run(summary, id)
    })
  }

  async pendingEntityDocs(): Promise<IndexedDoc[]> {
    const rows = this.db
      .prepare(
        `select f.* from files f
         where f.error is null
           and exists (select 1 from chunks c where c.file_id = f.id and c.meta = 0)
           and (f.entities_hash is null or f.entities_hash != f.hash)
         order by f.path`
      )
      .all() as Row[]
    return rows.map(rowToDoc)
  }

  async entityMentions(kind?: EntityKind): Promise<EntityMention[]> {
    const rows = this.db
      .prepare(
        `select m.kind, m.name, m.norm, f.path from entity_mentions m join files f on f.id = m.file_id
         ${kind ? 'where m.kind = ?' : ''} order by m.kind, m.norm, f.path`
      )
      .all(...(kind ? [kind] : [])) as Row[]
    return rows.map((r) => ({ kind: r.kind as EntityKind, name: r.name as string, norm: r.norm as string, path: r.path as string }))
  }

  async setEntityLink(link: EntityLink): Promise<void> {
    const [a, b] = link.a < link.b ? [link.a, link.b] : [link.b, link.a]
    this.db
      .prepare(
        `insert into entity_links(kind, a, b, relation) values (?, ?, ?, ?)
         on conflict(kind, a, b) do update set relation = excluded.relation`
      )
      .run(link.kind, a, b, link.relation)
  }

  async removeEntityLink(kind: EntityKind, a: string, b: string): Promise<void> {
    const [x, y] = a < b ? [a, b] : [b, a]
    this.db.prepare('delete from entity_links where kind = ? and a = ? and b = ?').run(kind, x, y)
  }

  async entityLinks(kind?: EntityKind): Promise<EntityLink[]> {
    const rows = this.db
      .prepare(`select kind, a, b, relation from entity_links ${kind ? 'where kind = ?' : ''} order by kind, a, b`)
      .all(...(kind ? [kind] : [])) as Row[]
    return rows.map((r) => ({ kind: r.kind as EntityKind, a: r.a as string, b: r.b as string, relation: r.relation as EntityLink['relation'] }))
  }

  async close(): Promise<void> {
    this.db.close()
  }

  private filterSql(filter?: FileFilter): { clause: string; params: SQLInputValue[] } {
    const parts: string[] = []
    const params: SQLInputValue[] = []
    if (filter?.extensions && filter.extensions.length > 0) {
      parts.push(`f.ext in (${filter.extensions.map(() => '?').join(',')})`)
      params.push(...filter.extensions.map((e) => e.toLowerCase()))
    }
    if (filter?.excludeExtensions && filter.excludeExtensions.length > 0) {
      parts.push(`f.ext not in (${filter.excludeExtensions.map(() => '?').join(',')})`)
      params.push(...filter.excludeExtensions.map((e) => e.toLowerCase()))
    }
    if (filter?.folder) {
      parts.push('substr(f.path, 1, ?) = ?')
      params.push(filter.folder.length, filter.folder)
    }
    if (filter?.dateFrom !== undefined) {
      parts.push('f.mtime >= ?')
      params.push(filter.dateFrom)
    }
    if (filter?.dateTo !== undefined) {
      parts.push('f.mtime <= ?')
      params.push(filter.dateTo)
    }
    return { clause: parts.join(' and '), params }
  }
}

function trimSnippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH)}…` : flat
}

function rowToDoc(row: Row): IndexedDoc {
  const doc: IndexedDoc = {
    path: row.path as string,
    hash: row.hash as string,
    size: row.size as number,
    mtime: row.mtime as number,
    ext: row.ext as string
  }
  if (row.atime !== null && row.atime !== undefined) doc.atime = row.atime as number
  if (row.born !== null && row.born !== undefined) doc.born = row.born as number
  if (row.summary !== null && row.summary !== undefined) doc.summary = row.summary as string
  if (row.container !== null && row.container !== undefined) doc.container = row.container as string
  if (row.confidence !== null && row.confidence !== undefined) doc.confidence = row.confidence as Confidence
  if (row.resurrected === 1) doc.resurrected = true
  if (row.error !== null && row.error !== undefined) doc.error = row.error as string
  if (row.origin !== null && row.origin !== undefined) doc.origin = row.origin as string
  return doc
}
