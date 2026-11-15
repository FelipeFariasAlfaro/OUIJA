import { basename, dirname } from 'node:path'
import { extensionOf, KIND_LABEL, KIND_WORDS, kindOf } from '@shared/filetypes'
import { parseVPath } from '../media'

/** "LogoHakaLens_blanco-final(1)" -> "Logo Haka Lens blanco final 1": separa mayúsculas, guiones y números pegados. */
export function splitIdentifier(stem: string): string {
  return stem
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/**
 * Texto con el que un archivo se vuelve buscable aunque no se pueda leer su contenido: nombre,
 * nombre separado en palabras, tipo (en español e inglés) y las últimas carpetas de su ruta.
 * Así "¿dónde tengo el logo de haka lens?" encuentra `Logo Haka Lens blanco (1).png`.
 */
export function buildMetaText(path: string, size: number): string {
  const { container, inner } = parseVPath(path)
  const name = basename(inner ?? container)
  const ext = extensionOf(name)
  const kind = kindOf(ext)
  const stem = ext ? name.slice(0, name.length - ext.length - 1) : name
  const words = splitIdentifier(stem)

  const folders = dirname(inner ?? container)
    .split(/[\\/]/)
    .filter((p) => p && p !== '.')
    .slice(-4)
    .map(splitIdentifier)
    .filter(Boolean)
    .join(' / ')

  const lines = [name]
  if (words && words.toLowerCase() !== name.toLowerCase()) lines.push(words)
  lines.push(`${KIND_LABEL.es[kind]}${ext ? ` ${ext.toUpperCase()}` : ''} · ${KIND_WORDS[kind]} · ${formatSize(size)}`)
  if (folders) lines.push(`Carpeta: ${folders}`)
  if (inner) lines.push(`Dentro de: ${splitIdentifier(basename(container))}`)
  return lines.join('\n')
}
