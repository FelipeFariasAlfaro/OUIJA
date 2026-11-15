// Genera `fixtures/chaos/`: una carpeta desordenada para la demo y las pruebas e2e.
// Uso: node scripts/make-fixtures.mjs
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'

const ROOT = 'fixtures/chaos'

const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»'
const cp437 = (text) => Buffer.from([...text].map((c) => (CP437_HIGH.includes(c) ? 0x80 + CP437_HIGH.indexOf(c) : c.charCodeAt(0))))

function zip(items) {
  const parts = []
  const central = []
  let offset = 0
  for (const { name, data } of items) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const comp = deflateRawSync(raw)
    const nm = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE((28 << 9) | (6 << 5) | 3, 12) // 2008-06-03
    local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nm.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x800, 8)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt16LE((28 << 9) | (6 << 5) | 3, 14)
    entry.writeUInt32LE(crc32(raw), 16)
    entry.writeUInt32LE(comp.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(nm.length, 28)
    entry.writeUInt32LE(offset, 42)
    parts.push(local, nm, comp)
    central.push(entry, nm)
    offset += local.length + nm.length + comp.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(items.length, 8)
  end.writeUInt16LE(items.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, dir, end])
}

// PNG de 1×1 píxel válido.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0005fe02fea75b0a7d0000000049454e44ae426082', 'hex')

const POEM_V1 = 'Para Rosa, primer borrador.\nTus manos guardan la luz,\ny yo aprendo a nombrarla.\n'
const files = [
  ['2019-03-12', 'Personal/borrador_final3.rtf', '{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}}\\f0 Poema para Rosa\\par Tus manos guardan la luz de marzo,\\par y yo, torpe, aprendo a nombrarla.\\par Catorce versos escritos para ti, Rosa.\\par}'],
  ['2008-06-03', 'Respaldos/escritorio-2008.zip', zip([
    { name: 'Poemas/rosa_v1.txt', data: cp437(POEM_V1.replace('luz', 'luz del día en Concepción')) },
    { name: 'Tesis/tesis_borrador_v2.wpd', data: Buffer.concat([Buffer.from([0xff, 0x57, 0x50, 0x43, 0x10, 0, 0, 0, 1, 2, 22, 0]), Buffer.from('Agradecimientos: a Rosa Campos, por leer cada capítulo dos veces, y al doctor Salinas, de la Universidad de Valparaíso, por guiar este trabajo.'), Buffer.alloc(64)]) },
    { name: 'Fotos/viaje_peru_2011.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) }
  ])],
  ['2011-08-05', 'Antiguos/diario_viaje_peru.txt', 'Diario de viaje por Cusco y Arequipa. Rosita se neg\u00c3\u00b3 a subir al bus hasta que sacamos la \u00c3\u00baltima foto del valle. Rosa y Mat\u00c3\u00adas nos esperaban en Arequipa con una lista de lugares.\n'],
  ['2015-04-02', 'Contratos/contrato_arriendo_2015.txt', 'Contrato de arriendo de departamento ubicado en calle Lira, Santiago. Vigencia de doce meses, renovable. Arrendador: Luis Mendoza.\n'],
  ['2024-01-15', 'Contratos/contrato_servicios.txt', 'Contrato de prestación de servicios profesionales de consultoría entre las partes, con plazo hasta diciembre de 2024.\n'],
  ['2020-07-01', 'Cocina/receta_torta.txt', 'Receta de torta de chocolate: mezcle harina, huevos y cacao. Hornee cuarenta minutos a 180 grados.\n'],
  ['2023-05-10', 'Logos Hakas/Logo Haka Lens blanco (1).png', PNG],
  ['2026-11-13', 'Descargas/ElevenLabs_2026-11-13T22_56_23_Camila_pvc.mp3', Buffer.from('ID3\x03\x00\x00')],
  ['2018-02-02', 'Misc/datos_binarios', Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 37 + 11) % 256))]
]

rmSync(ROOT, { recursive: true, force: true })
for (const [date, rel, data] of files) {
  const full = join(ROOT, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, data)
  const when = new Date(`${date}T12:00:00Z`)
  utimesSync(full, when, when)
}
console.log(`${files.length} archivos en ${ROOT}`)
