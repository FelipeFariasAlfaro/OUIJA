import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Container, ContainerEntry, ContainerError } from './types'
import { sanitizeInnerName } from './vpath'

const execFileAsync = promisify(execFile)

const CANDIDATES = ['7zz', '7z', '7za', '7zr']
const MAX_ENTRY_BYTES = 512 * 1024 * 1024
const LIST_TIMEOUT_MS = 60_000
const READ_TIMEOUT_MS = 120_000

let cached: Promise<string | null> | undefined

/** Busca un ejecutable de 7-Zip en el PATH. El resultado se guarda en caché. */
export function find7z(): Promise<string | null> {
  cached ??= (async () => {
    for (const bin of CANDIDATES) {
      try {
        await execFileAsync(bin, [], { timeout: 10_000 })
        return bin
      } catch (error) {
        // 7z sin argumentos puede salir con código distinto de 0 pero existir.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && 'stdout' in (error as object)) return bin
      }
    }
    return null
  })()
  return cached
}

/** Solo para pruebas. */
export function reset7zCache(): void {
  cached = undefined
}

interface Block {
  path?: string
  size?: number
  mtime?: number
  folder: boolean
  encrypted: boolean
}

export function parse7zListing(output: string): Block[] {
  const blocks: Block[] = []
  let current: Block | undefined
  for (const line of output.split(/\r?\n/)) {
    const eq = line.indexOf(' = ')
    if (eq < 0) continue
    const key = line.slice(0, eq)
    const value = line.slice(eq + 3)
    if (key === 'Path') {
      current = { path: value, folder: false, encrypted: false }
      blocks.push(current)
    } else if (!current) {
      continue
    } else if (key === 'Size') {
      const n = Number(value)
      if (Number.isFinite(n)) current.size = n
    } else if (key === 'Modified') {
      const ms = Date.parse(value.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1'))
      if (!Number.isNaN(ms)) current.mtime = ms
    } else if (key === 'Folder') {
      current.folder = value === '+'
    } else if (key === 'Attributes') {
      if (value.startsWith('D')) current.folder = true
    } else if (key === 'Encrypted') {
      current.encrypted = value === '+'
    }
  }
  return blocks
}

export async function open7z(archive: string): Promise<Container> {
  const bin = await find7z()
  if (!bin) {
    return { entries: [], errors: [{ message: '7-Zip no está instalado' }], recovered: false }
  }

  let stdout: string
  try {
    const result = await execFileAsync(bin, ['l', '-slt', '-ba', '--', archive], {
      timeout: LIST_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024
    })
    stdout = result.stdout
  } catch (error) {
    return { entries: [], errors: [{ message: `No se pudo listar: ${messageOf(error)}` }], recovered: false }
  }

  const entries: ContainerEntry[] = []
  const errors: ContainerError[] = []
  for (const block of parse7zListing(stdout)) {
    if (block.folder || block.path === undefined) continue
    const name = sanitizeInnerName(block.path)
    if (!name) {
      errors.push({ name: block.path, message: 'nombre inválido o inseguro' })
      continue
    }
    const original = block.path
    entries.push({
      name,
      size: block.size,
      mtime: block.mtime,
      read: async () => {
        if (block.encrypted) throw new Error(`"${name}" está cifrado`)
        if (block.size !== undefined && block.size > MAX_ENTRY_BYTES) throw new Error(`"${name}" es demasiado grande`)
        try {
          const { stdout: data } = await execFileAsync(bin, ['e', '-so', '-y', '-spd', '--', archive, original], {
            encoding: 'buffer',
            timeout: READ_TIMEOUT_MS,
            maxBuffer: MAX_ENTRY_BYTES
          })
          return data
        } catch (error) {
          throw new Error(`No se pudo leer "${name}": ${messageOf(error)}`, { cause: error })
        }
      }
    })
  }
  return { entries, errors, recovered: false }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
