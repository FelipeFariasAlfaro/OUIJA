import { relative, resolve, sep } from 'node:path'
import chokidar from 'chokidar'
import type { IndexPipeline } from './pipeline'
import { isExcludedName, statIndexable, type ScanOptions } from './scanner'

export interface FolderWatcher {
  /** Se resuelve cuando se vació la cola de trabajo pendiente. */
  idle(): Promise<void>
  close(): Promise<void>
}

export interface WatchOptions extends ScanOptions {
  onIndexed?: (path: string) => void
  onRemoved?: (path: string) => void
  /** Milisegundos de estabilidad antes de procesar un archivo recién escrito. */
  stabilityMs?: number
}

/**
 * Vigila una carpeta y mantiene el índice al día: crear o modificar reindexa solo ese archivo,
 * borrar lo olvida.
 */
export async function watchFolder(
  root: string,
  pipeline: IndexPipeline,
  options: WatchOptions = {}
): Promise<FolderWatcher> {
  const folder = resolve(root)
  let queue: Promise<void> = Promise.resolve()
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((error: unknown) => options.onError?.(folder, error))
  }

  const ignored = (path: string): boolean => {
    const rel = relative(folder, path)
    if (!rel || rel.startsWith('..')) return false
    return rel.split(sep).some((part, i, parts) => isExcludedName(part, i < parts.length - 1, options))
  }

  const watcher = chokidar.watch(folder, {
    ignoreInitial: true,
    ignored,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: options.stabilityMs ?? 300, pollInterval: 100 }
  })

  const upsert = (path: string) =>
    enqueue(async () => {
      const file = await statIndexable(path)
      if (!file) return
      await pipeline.indexFile(file)
      options.onIndexed?.(path)
    })

  watcher.on('add', upsert).on('change', upsert)
  watcher.on('unlink', (path) =>
    enqueue(async () => {
      await pipeline.forgetPath(path)
      options.onRemoved?.(path)
    })
  )
  watcher.on('unlinkDir', (path) =>
    enqueue(async () => {
      await pipeline.forgetFolder(path, true)
      options.onRemoved?.(path)
    })
  )
  watcher.on('error', (error) => options.onError?.(folder, error))

  await new Promise<void>((ok) => watcher.once('ready', () => ok()))

  return {
    idle: async () => {
      let seen: Promise<void>
      do {
        seen = queue
        await seen
      } while (seen !== queue)
    },
    close: async () => {
      await watcher.close()
      await queue
    }
  }
}
