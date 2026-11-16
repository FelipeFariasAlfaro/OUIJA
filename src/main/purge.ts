import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Marca que pide borrar los datos de OUIJA en el próximo arranque. */
const MARK = '.ouija-exorcism'
/** El motor local y los modelos descargados (varios GB) viven aquí. */
const ENGINE_DIR = 'ollama'

/**
 * "Exorcismo": deja pedido el borrado de todos los datos de la aplicación (índice, configuración,
 * claves, personas, caché). Se hace al volver a abrir, antes de que nada use la carpeta, para que en
 * Windows ningún archivo esté bloqueado. Los archivos del usuario no se tocan nunca.
 */
export function requestExorcism(dataDir: string, keepEngine: boolean): void {
  writeFileSync(join(dataDir, MARK), JSON.stringify({ keepEngine, at: Date.now() }))
}

/** Si hay un exorcismo pendiente, vacía la carpeta de datos. Devuelve `true` si lo hizo. */
export function runPendingExorcism(dataDir: string): boolean {
  const mark = join(dataDir, MARK)
  if (!existsSync(mark)) return false
  let keepEngine = true
  try {
    keepEngine = (JSON.parse(readFileSync(mark, 'utf8')) as { keepEngine?: unknown }).keepEngine !== false
  } catch {
    // marca dañada: por prudencia se conserva el motor
  }
  for (const entry of readdirSync(dataDir)) {
    if (entry === MARK || (keepEngine && entry === ENGINE_DIR)) continue
    rmSync(join(dataDir, entry), { recursive: true, force: true, maxRetries: 3 })
  }
  rmSync(mark, { force: true })
  return true
}
