import { opendir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { isIgnoredFile } from '@shared/filetypes'
import type { ScannedFile } from './types'

export const DEFAULT_EXCLUDED_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.ssh',
  '.gnupg',
  '.aws',
  '.kube',
  '.docker',
  '__pycache__',
  'venv',
  '.venv',
  'site-packages',
  'bower_components',
  '.gradle',
  '.next',
  '.nuxt',
  '$RECYCLE.BIN',
  'System Volume Information'
]


export interface ScanOptions {
  /** Nombres de carpeta a omitir (coincidencia exacta con el nombre, sin ruta). */
  excludeDirs?: readonly string[]
  includeHidden?: boolean
  onError?: (path: string, error: unknown) => void
}

/** Todo archivo se indexa (al menos por nombre y tipo), salvo compilados, temporales y de sistema. */
export function isIndexablePath(path: string): boolean {
  return !isIgnoredFile(path)
}

/** Construye un `ScannedFile` si la ruta es indexable. Devuelve `null` si no lo es. */
export async function statIndexable(path: string): Promise<ScannedFile | null> {
  if (!isIndexablePath(path)) return null
  const s = await stat(path)
  if (!s.isFile()) return null
  return {
    path,
    size: s.size,
    mtime: Math.round(s.mtimeMs),
    atime: Math.round(s.atimeMs),
    // Algunos sistemas de archivos no tienen fecha de creación (0). Una copia puede tenerla posterior a mtime.
    born: Math.round(s.birthtimeMs > 0 ? Math.min(s.birthtimeMs, s.mtimeMs) : s.mtimeMs),
    ext: extname(path).slice(1).toLowerCase()
  }
}

/** Decide si una carpeta o archivo debe ignorarse por su nombre. */
export function isExcludedName(name: string, isDir: boolean, options: ScanOptions = {}): boolean {
  if (!options.includeHidden && name.startsWith('.')) return true
  return isDir && (options.excludeDirs ?? DEFAULT_EXCLUDED_DIRS).includes(name)
}

/**
 * Recorre una carpeta de forma recursiva y entrega los archivos indexables.
 * Omite enlaces simbólicos (evita ciclos), carpetas excluidas y archivos ocultos.
 */
export async function* scanFolder(root: string, options: ScanOptions = {}): AsyncGenerator<ScannedFile> {
  const pending: string[] = [root]
  while (pending.length > 0) {
    const dir = pending.pop() as string
    let handle
    try {
      handle = await opendir(dir)
    } catch (error) {
      options.onError?.(dir, error)
      continue
    }
    try {
      for await (const entry of handle) {
        if (entry.isSymbolicLink()) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!isExcludedName(entry.name, true, options)) pending.push(full)
        } else if (entry.isFile() && !isExcludedName(entry.name, false, options)) {
          try {
            const file = await statIndexable(full)
            if (file) yield file
          } catch (error) {
            options.onError?.(full, error)
          }
        }
      }
    } catch (error) {
      options.onError?.(dir, error)
    }
  }
}
