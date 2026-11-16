import type { Chunk, FileFilter, Hit, HybridQuery, IndexedDoc } from './types'

/**
 * Contrato de la memoria de OUIJA. El producto solo accede al índice a través de esta interfaz,
 * de modo que SQLite, GLIA u otro motor sean intercambiables.
 */
export interface MemoryStore {
  /** Inserta o reemplaza por completo el archivo y sus fragmentos. Es idempotente. */
  upsert(doc: IndexedDoc, chunks: Chunk[]): Promise<void>
  /** Búsqueda híbrida (léxica + semántica) con filtros. */
  search(query: HybridQuery): Promise<Hit[]>
  /** Olvida un archivo y todo lo que contenga si es un contenedor (`ruta::*`). */
  forget(path: string): Promise<void>
  forgetAll(): Promise<void>
  listFiles(filter?: FileFilter): Promise<IndexedDoc[]>
  hasPath(path: string): Promise<boolean>
  /** Cuántos archivos hay por extensión . */
  extensionCounts(): Promise<{ ext: string; count: number }[]>
  getDoc(path: string): Promise<IndexedDoc | undefined>
  /** Imágenes sueltas pequeñas cuyo texto aún no se leyó (o cambiaron desde entonces). */
  pendingOcrDocs(extensions: string[], maxSize: number): Promise<IndexedDoc[]>
  /** Marca la imagen como leída para su contenido actual, tenga o no texto. */
  markOcrDone(path: string): Promise<void>
  /** Texto indexado del archivo (fragmentos en orden), o `undefined` si no existe. */
  getText(path: string): Promise<string | undefined>
  close(): Promise<void>
}
