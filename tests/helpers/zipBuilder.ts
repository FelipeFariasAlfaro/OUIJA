import { crc32, deflateRawSync } from 'node:zlib'

export interface ZipItem {
  name: string
  data: Buffer | string
  method?: 'store' | 'deflate'
  /** Marca el nombre como UTF-8 (bit 11). */
  utf8?: boolean
}

/** Construye un ZIP válido y simple (sin ZIP64) para pruebas. */
export function buildZip(items: ZipItem[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const item of items) {
    const data = Buffer.isBuffer(item.data) ? item.data : Buffer.from(item.data, 'utf8')
    const method = item.method === 'store' ? 0 : 8
    const comp = method === 0 ? data : deflateRawSync(data)
    const name = Buffer.from(item.name, 'utf8')
    const flags = item.utf8 === false ? 0 : 0x800
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE((30 << 9) | (1 << 5) | 1, 12) // 2010-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(flags, 8)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt16LE(0, 12)
    entry.writeUInt16LE((30 << 9) | (1 << 5) | 1, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(comp.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)

    parts.push(local, name, comp)
    central.push(entry, name)
    offset += local.length + name.length + comp.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(items.length, 8)
  eocd.writeUInt16LE(items.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralBuf, eocd])
}
