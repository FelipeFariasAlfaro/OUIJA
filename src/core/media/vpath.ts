/** Separador entre el contenedor y la ruta interna: `/ruta/respaldo.zip::carpeta/poema.doc`. */
export const VPATH_SEPARATOR = '::'

export function makeVPath(container: string, inner: string): string {
  return `${container}${VPATH_SEPARATOR}${inner}`
}

export interface ParsedVPath {
  /** Ruta del archivo real en disco. */
  container: string
  /** Ruta dentro del contenedor, o `undefined` si la ruta no es virtual. */
  inner?: string
}

/** Se separa en la primera aparición de `::`. No se admiten contenedores anidados. */
export function parseVPath(path: string): ParsedVPath {
  const i = path.indexOf(VPATH_SEPARATOR)
  if (i < 0) return { container: path }
  return { container: path.slice(0, i), inner: path.slice(i + VPATH_SEPARATOR.length) }
}

export function isVirtualPath(path: string): boolean {
  return path.includes(VPATH_SEPARATOR)
}

/** Normaliza un nombre interno. Devuelve `null` si es inseguro (`..`) o vacío. */
export function sanitizeInnerName(raw: string): string | null {
  const parts = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p !== '' && p !== '.')
  if (parts.length === 0 || parts.includes('..')) return null
  // Los controles y el separador virtual rompen la ruta virtual.
  // eslint-disable-next-line no-control-regex
  if (parts.some((p) => /[\u0000-\u001f]/.test(p))) return null
  const name = parts.join('/')
  return name.includes(VPATH_SEPARATOR) ? null : name
}
