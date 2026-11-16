/**
 * Fecha en que se tomó una foto, leída del EXIF de un JPEG (DateTimeOriginal o, si falta, DateTime).
 * Las fotos copiadas de una cámara o un disco viejo suelen tener la fecha de la copia; el EXIF guarda la real.
 * Devuelve milisegundos (hora local tratada como UTC) o `undefined`. No lanza ante archivos dañados.
 */
export function exifDate(buf: Buffer): number | undefined {
  try {
    if (buf.length < 12 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined
    let p = 2
    while (p + 4 <= buf.length) {
      if (buf[p] !== 0xff) return undefined
      const marker = buf[p + 1]
      if (marker === 0xda || marker === 0xd9) return undefined // empieza la imagen: no hay EXIF antes
      const len = buf.readUInt16BE(p + 2)
      if (marker === 0xe1 && buf.toString('latin1', p + 4, p + 10) === 'Exif\0\0') return fromTiff(buf.subarray(p + 10, p + 2 + len))
      p += 2 + len
    }
  } catch {
    // archivo truncado o dañado
  }
  return undefined
}

function fromTiff(t: Buffer): number | undefined {
  const le = t.toString('latin1', 0, 2) === 'II'
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o))
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o))
  const tags = (ifd: number): Map<number, number> => {
    const out = new Map<number, number>()
    if (ifd + 2 > t.length) return out
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      if (e + 12 > t.length) break
      out.set(u16(e), u32(e + 8)) // para cadenas largas, el valor es el desplazamiento
    }
    return out
  }
  const ifd0 = tags(u32(4))
  const sub = ifd0.has(0x8769) ? tags(ifd0.get(0x8769) as number) : new Map<number, number>()
  const offset = sub.get(0x9003) ?? sub.get(0x9004) ?? ifd0.get(0x0132)
  if (offset === undefined || offset + 19 > t.length) return undefined
  const m = t.toString('latin1', offset, offset + 19).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return undefined
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
  if (y < 1990 || y > 2100) return undefined
  return Date.UTC(y, mo - 1, d, h, mi, s)
}
