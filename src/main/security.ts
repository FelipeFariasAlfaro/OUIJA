/**
 * Reglas de seguridad del proceso principal. Son funciones puras para poder probarlas sin Electron.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Qué puede cargar la interfaz. OUIJA es 100 % local (R9): solo archivos propios, datos incrustados
 * y `localhost` (Ollama y el servidor de desarrollo). Todo lo demás se bloquea (P5).
 */
export function isAllowedRequest(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  switch (url.protocol) {
    case 'file:':
    case 'data:':
    case 'blob:':
    case 'devtools:':
    case 'chrome-extension:': // herramientas de desarrollo
      return true
    case 'http:':
    case 'https:':
    case 'ws:':
    case 'wss:':
      return LOCAL_HOSTNAMES.has(url.hostname)
    default:
      return false
  }
}

/**
 * Solo las páginas de la propia aplicación pueden usar los canales IPC: el archivo empaquetado o el
 * servidor de desarrollo declarado al arrancar.
 */
export function isTrustedSender(senderUrl: string, appFileUrl: string, devServerUrl?: string): boolean {
  try {
    const sender = new URL(senderUrl)
    if (sender.protocol === 'file:') {
      const app = new URL(appFileUrl)
      return sender.pathname === app.pathname
    }
    if (devServerUrl) return sender.origin === new URL(devServerUrl).origin
    return false
  } catch {
    return false
  }
}

/** Valida un argumento de texto proveniente de la interfaz. */
export function asString(value: unknown, name: string, max = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error(`Argumento inválido: ${name}`)
  return value
}

export function asOneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`Argumento inválido: ${name}`)
  return value as T
}
