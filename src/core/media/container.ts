import { extname } from 'node:path'
import { open7z } from './sevenZip'
import type { Container } from './types'
import { openZipFile } from './zip'

/** Extensiones que se abren con el lector propio. */
export const NATIVE_CONTAINER_EXTENSIONS = ['zip'] as const
/** Extensiones que requieren 7-Zip instalado. */
export const SEVEN_ZIP_EXTENSIONS = ['7z', 'rar', 'arj', 'lzh', 'lha'] as const

const NATIVE = new Set<string>(NATIVE_CONTAINER_EXTENSIONS)
const SEVEN = new Set<string>(SEVEN_ZIP_EXTENSIONS)

function extOf(path: string): string {
  return extname(path).slice(1).toLowerCase()
}

export function isContainerPath(path: string): boolean {
  const ext = extOf(path)
  return NATIVE.has(ext) || SEVEN.has(ext)
}

/**
 * Abre un contenedor en solo lectura. Nunca lanza: los problemas se informan en `errors`.
 * No escribe en disco ni modifica el original.
 */
export async function openContainer(path: string): Promise<Container> {
  const ext = extOf(path)
  try {
    if (NATIVE.has(ext)) return await openZipFile(path)
    if (SEVEN.has(ext)) return await open7z(path)
    return { entries: [], errors: [{ message: `Formato de contenedor no soportado: .${ext}` }], recovered: false }
  } catch (error) {
    return {
      entries: [],
      errors: [{ message: error instanceof Error ? error.message : String(error) }],
      recovered: false
    }
  }
}
