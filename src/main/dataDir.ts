import { existsSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** Nombre de la carpeta de datos de la aplicación. */
export const DATA_DIR_NAME = 'ouija'
/** Nombre con que se guardaban los datos antes de que la aplicación se llamara OUIJA. */
const LEGACY_NAME = 'medium'

/**
 * Carpeta de datos dentro de `appData` (por ejemplo `~/.config/ouija`). Si solo existe la antigua
 * (`~/.config/medium`), se renombra para conservar el índice, la configuración y los modelos. Si no se
 * puede renombrar (por ejemplo, un archivo en uso en Windows), se sigue usando la antigua.
 */
export function prepareDataDir(appData: string): string {
  const target = join(appData, DATA_DIR_NAME)
  const legacy = join(appData, LEGACY_NAME)
  if (existsSync(target) || !existsSync(legacy)) return target
  try {
    renameSync(legacy, target)
    return target
  } catch {
    return legacy
  }
}

/** Para el servidor MCP: una configuración vieja puede apuntar a `…/medium`, ya renombrada a `…/ouija`. */
export function resolveDataDir(dir: string): string {
  if (existsSync(dir) || basename(dir) !== LEGACY_NAME) return dir
  const renamed = join(dirname(dir), DATA_DIR_NAME)
  return existsSync(renamed) ? renamed : dir
}

/** La carpeta de datos que ya existe, sin renombrar nada (la usa el servidor MCP, que solo lee). */
export function existingDataDir(appData: string): string {
  const target = join(appData, DATA_DIR_NAME)
  const legacy = join(appData, LEGACY_NAME)
  return !existsSync(target) && existsSync(legacy) ? legacy : target
}
