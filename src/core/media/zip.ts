import { stat } from 'node:fs/promises'
import { crc32, inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'
import { openQuiet } from '../fsQuiet'
import type { Container, ContainerEntry, ContainerError } from './types'
import { sanitizeInnerName } from './vpath'

const inflateRawAsync = promisify(inflateRaw)

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const LOCAL_HEADER = 30
const EOCD_SIZE = 22
const MAX_COMMENT = 0xffff
const MAX_ENTRY_BYTES = 512 * 1024 * 1024
const MAX_ENTRIES = 200_000
const MAX_SCAN_BYTES = 256 * 1024 * 1024

/** Acceso aleatorio de solo lectura. */
export interface Source {
  size: number
  read(offset: number, length: number): Promise<Buffer>
}

export function bufferSource(buf: Buffer): Source {
  return { size: buf.length, read: async (offset, length) => buf.subarray(offset, offset + length) }
}

/** Abre el archivo solo durante cada lectura, así no quedan descriptores abiertos. */
export async function fileSource(path: string): Promise<Source> {
  const { size } = await stat(path)
  return {
    size,
    read: async (offset, length) => {
      const handle = await openQuiet(path)
      try {
        const buf = Buffer.alloc(Math.max(0, Math.min(length, size - offset)))
        const { bytesRead } = await handle.read(buf, 0, buf.length, offset)
        return buf.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
    }
  }
}

interface RawEntry {
  name: string
  method: number
  flags: number
  crc?: number
  compSize: number
  size?: number
  mtime?: number
  /** Posición del inicio de los datos comprimidos, si ya se conoce. */
  dataStart?: number
  localOffset: number
}

function decodeName(raw: Buffer, flags: number): string {
  if (flags & 0x800) return raw.toString('utf8')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    return raw.toString('latin1')
  }
}

function dosToMs(date: number, time: number): number | undefined {
  const month = (date >> 5) & 15
  const day = date & 31
  if (month < 1 || month > 12 || day < 1) return undefined
  const ms = new Date(
    ((date >> 9) & 127) + 1980,
    month - 1,
    day,
    (time >> 11) & 31,
    (time >> 5) & 63,
    (time & 31) * 2
  ).getTime()
  return Number.isNaN(ms) ? undefined : ms
}

async function decompress(method: number, data: Buffer): Promise<Buffer> {
  if (method === 0) return data
  if (method === 8) return inflateRawAsync(data, { maxOutputLength: MAX_ENTRY_BYTES })
  throw new Error(`método de compresión ${method} no soportado`)
}

function verify(entry: RawEntry, out: Buffer): Buffer {
  if (entry.crc !== undefined && crc32(out) !== entry.crc) {
    throw new Error(`CRC incorrecto en "${entry.name}": contenido dañado`)
  }
  return out
}

function toEntry(raw: RawEntry, loadData: () => Promise<Buffer>): ContainerEntry {
  return {
    name: raw.name,
    size: raw.size,
    mtime: raw.mtime,
    read: async () => {
      if (raw.flags & 1) throw new Error(`"${raw.name}" está cifrado`)
      if (raw.size !== undefined && raw.size > MAX_ENTRY_BYTES) throw new Error(`"${raw.name}" es demasiado grande`)
      return verify(raw, await decompress(raw.method, await loadData()))
    }
  }
}

function fromSource(src: Source, raw: RawEntry): ContainerEntry {
  return toEntry(raw, async () => {
    let start = raw.dataStart
    if (start === undefined) {
      const hdr = await src.read(raw.localOffset, LOCAL_HEADER)
      if (hdr.length < LOCAL_HEADER || hdr.readUInt32LE(0) !== SIG_LOCAL) {
        throw new Error(`Encabezado local dañado en "${raw.name}"`)
      }
      start = raw.localOffset + LOCAL_HEADER + hdr.readUInt16LE(26) + hdr.readUInt16LE(28)
    }
    const data = await src.read(start, raw.compSize)
    if (data.length !== raw.compSize) throw new Error(`Datos truncados en "${raw.name}"`)
    return data
  })
}

async function findEocd(src: Source): Promise<{ count: number; size: number; offset: number } | null> {
  const tailLength = Math.min(src.size, EOCD_SIZE + MAX_COMMENT)
  if (tailLength < EOCD_SIZE) return null
  const tail = await src.read(src.size - tailLength, tailLength)
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== SIG_EOCD) continue
    if (i + EOCD_SIZE + tail.readUInt16LE(i + 20) > tail.length) continue
    return { count: tail.readUInt16LE(i + 10), size: tail.readUInt32LE(i + 12), offset: tail.readUInt32LE(i + 16) }
  }
  return null
}

/** Lee el directorio central. Devuelve `null` si no es utilizable. */
async function readCentral(src: Source): Promise<Container | null> {
  const eocd = await findEocd(src)
  if (!eocd) return null
  if (eocd.offset + eocd.size > src.size || eocd.size === 0) return null
  const dir = await src.read(eocd.offset, eocd.size)
  if (dir.length !== eocd.size) return null

  const entries: ContainerEntry[] = []
  const errors: ContainerError[] = []
  let pos = 0
  while (pos + 46 <= dir.length && entries.length + errors.length < MAX_ENTRIES) {
    if (dir.readUInt32LE(pos) !== SIG_CENTRAL) break
    const head = pos
    const flags = dir.readUInt16LE(head + 8)
    const nameLen = dir.readUInt16LE(head + 28)
    const next = head + 46 + nameLen + dir.readUInt16LE(head + 30) + dir.readUInt16LE(head + 32)
    if (next > dir.length) break
    pos = next

    const rawName = decodeName(dir.subarray(head + 46, head + 46 + nameLen), flags)
    if (rawName.endsWith('/') || rawName.endsWith('\\')) continue // directorio

    const name = sanitizeInnerName(rawName)
    if (!name) {
      errors.push({ name: rawName, message: 'nombre inválido o inseguro' })
      continue
    }
    const compSize = dir.readUInt32LE(head + 20)
    const size = dir.readUInt32LE(head + 24)
    const localOffset = dir.readUInt32LE(head + 42)
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      errors.push({ name, message: 'ZIP64 no soportado' })
      continue
    }
    entries.push(
      fromSource(src, {
        name,
        method: dir.readUInt16LE(head + 10),
        flags,
        crc: dir.readUInt32LE(head + 16),
        compSize,
        size,
        mtime: dosToMs(dir.readUInt16LE(head + 14), dir.readUInt16LE(head + 12)),
        localOffset
      })
    )
  }
  if (entries.length === 0 && errors.length === 0) return null
  return { entries, errors, recovered: false }
}

export async function readZip(src: Source): Promise<Container> {
  try {
    const central = await readCentral(src)
    if (central) return central
  } catch {
    // Se intenta el rescate abajo.
  }
  return scanLocalHeaders(src)
}

export async function openZipFile(path: string): Promise<Container> {
  return readZip(await fileSource(path))
}

/** Rescate: recorre el archivo buscando encabezados locales cuando el directorio central falta o está roto. */
async function scanLocalHeaders(src: Source): Promise<Container> {
  if (src.size > MAX_SCAN_BYTES) {
    return { entries: [], errors: [{ message: 'ZIP dañado y demasiado grande para rescatar' }], recovered: false }
  }
  let buf: Buffer
  try {
    buf = await src.read(0, src.size)
  } catch (error) {
    return { entries: [], errors: [{ message: `No se pudo leer: ${errorMessage(error)}` }], recovered: false }
  }

  const sig = Buffer.alloc(4)
  sig.writeUInt32LE(SIG_LOCAL)
  const entries: ContainerEntry[] = []
  const errors: ContainerError[] = []
  let cursor = buf.indexOf(sig)

  while (cursor >= 0 && cursor + LOCAL_HEADER <= buf.length && entries.length < MAX_ENTRIES) {
    const flags = buf.readUInt16LE(cursor + 6)
    const method = buf.readUInt16LE(cursor + 8)
    const nameLen = buf.readUInt16LE(cursor + 26)
    const dataStart = cursor + LOCAL_HEADER + nameLen + buf.readUInt16LE(cursor + 28)
    const hasDescriptor = (flags & 8) !== 0
    const declared = buf.readUInt32LE(cursor + 18)

    if (nameLen === 0 || dataStart > buf.length) {
      cursor = buf.indexOf(sig, cursor + 1)
      continue
    }

    let end: number
    if (declared > 0 && !hasDescriptor) {
      end = dataStart + declared
    } else {
      const nextSig = buf.indexOf(sig, dataStart)
      end = nextSig < 0 ? buf.length : nextSig
    }
    const rawName = decodeName(buf.subarray(cursor + LOCAL_HEADER, cursor + LOCAL_HEADER + nameLen), flags)
    const name = rawName.endsWith('/') ? null : sanitizeInnerName(rawName)
    const nextCursor = buf.indexOf(sig, Math.min(end, buf.length))

    if (name) {
      if (end > buf.length) {
        errors.push({ name, message: 'datos truncados' })
      } else {
        const raw: RawEntry = {
          name,
          method,
          flags,
          crc: hasDescriptor ? undefined : buf.readUInt32LE(cursor + 14),
          compSize: end - dataStart,
          size: hasDescriptor ? undefined : buf.readUInt32LE(cursor + 22),
          mtime: dosToMs(buf.readUInt16LE(cursor + 12), buf.readUInt16LE(cursor + 10)),
          dataStart,
          localOffset: cursor
        }
        const slice = buf.subarray(dataStart, end)
        entries.push(toEntry(raw, async () => slice))
      }
    }
    cursor = nextCursor
  }

  if (entries.length === 0 && errors.length === 0) {
    errors.push({ message: 'No se encontraron entradas ZIP legibles' })
  }
  return { entries, errors, recovered: entries.length > 0 }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
