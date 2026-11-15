import { constants, createReadStream } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

/**
 * Abre un archivo para lectura sin actualizar su fecha de último acceso (O_NOATIME, solo Linux y
 * solo si somos dueños del archivo). Sin esto, indexar haría que todos los archivos parezcan
 * recién usados y la detección de fantasmas dejaría de servir.
 */
export async function openQuiet(path: string): Promise<FileHandle> {
  const noatime = (constants as Record<string, number>).O_NOATIME
  if (noatime) {
    try {
      return await open(path, constants.O_RDONLY | noatime)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EINVAL' && code !== 'ENOTSUP') throw error
    }
  }
  return open(path, 'r')
}

/** Lee el archivo completo, o solo sus primeros `max` bytes. */
export async function readFileQuiet(path: string, max?: number): Promise<Buffer> {
  const handle = await openQuiet(path)
  try {
    if (max === undefined) return await handle.readFile()
    const buf = Buffer.alloc(max)
    const { bytesRead } = await handle.read(buf, 0, max, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const EDGE = 1024 * 1024

/**
 * Huella del contenido. Si el archivo supera `partialAbove`, se calcula con el primer y el último
 * megabyte más el tamaño: identifica el archivo sin leer gigas de video.
 */
export async function hashFileQuiet(
  path: string,
  createHash: () => { update(b: Buffer | Uint8Array | string): unknown; digest(enc: 'hex'): string },
  options?: { partialAbove: number }
): Promise<string> {
  const handle = await openQuiet(path)
  const hash = createHash()
  try {
    const size = (await handle.stat()).size
    if (options && size > options.partialAbove) {
      const head = Buffer.alloc(EDGE)
      const tail = Buffer.alloc(EDGE)
      const h = await handle.read(head, 0, EDGE, 0)
      const t = await handle.read(tail, 0, EDGE, Math.max(0, size - EDGE))
      hash.update(head.subarray(0, h.bytesRead))
      hash.update(tail.subarray(0, t.bytesRead))
      hash.update(`:${size}`)
      return `partial:${hash.digest('hex')}`
    }
    for await (const chunk of createReadStream('', { fd: handle.fd, autoClose: false })) hash.update(chunk as Buffer)
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}
