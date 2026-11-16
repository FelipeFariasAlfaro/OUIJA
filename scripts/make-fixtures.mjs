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

// JPEG mínimo con EXIF: la foto se tomó en `taken` ("AAAA:MM:DD HH:MM:SS"), aunque el archivo sea una copia posterior.
function jpegWithExif(taken) {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 12 + 4 + 20)
  tiff.write('II', 0, 'latin1')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4) // IFD0
  tiff.writeUInt16LE(1, 8)
  tiff.writeUInt16LE(0x8769, 10) // puntero al IFD de EXIF
  tiff.writeUInt16LE(4, 12)
  tiff.writeUInt32LE(1, 14)
  tiff.writeUInt32LE(26, 18)
  tiff.writeUInt32LE(0, 22)
  tiff.writeUInt16LE(1, 26) // IFD de EXIF
  tiff.writeUInt16LE(0x9003, 28) // DateTimeOriginal
  tiff.writeUInt16LE(2, 30)
  tiff.writeUInt32LE(20, 32)
  tiff.writeUInt32LE(44, 36)
  tiff.writeUInt32LE(0, 40)
  tiff.write(`${taken}\0`, 44, 'latin1')
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const len = Buffer.alloc(2)
  len.writeUInt16BE(app1.length + 2)
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])])
}
// Historial de MSN Messenger (2006), tal como lo guardaba Messenger.
const MSN = `<?xml version="1.0"?>
<?xml-stylesheet type='text/xsl' href='MessageLog.xsl'?>
<Log FirstSessionID="1" LastSessionID="1">
<Message Date="12-03-2006" Time="22:15:02" DateTime="2006-03-13T01:15:02.000Z" SessionID="1"><From><User FriendlyName="Rosa ~ la luz de marzo"/></From><To><User FriendlyName="Felipe"/></To><Text Style="font-family:Tahoma; color:#800080; ">¿Terminaste el poema que me prometiste?</Text></Message>
<Message Date="12-03-2006" Time="22:16:40" DateTime="2006-03-13T01:16:40.000Z" SessionID="1"><From><User FriendlyName="Felipe"/></From><To><User FriendlyName="Rosa ~ la luz de marzo"/></To><Text Style="font-family:Tahoma; ">Casi. Lo guardé en el disquete azul, mañana te lo llevo a Concepción &lt;3</Text></Message>
<Message Date="12-03-2006" Time="22:17:05" DateTime="2006-03-13T01:17:05.000Z" SessionID="1"><From><User FriendlyName="Rosa ~ la luz de marzo"/></From><To><User FriendlyName="Felipe"/></To><Text Style="font-family:Tahoma; color:#800080; ">No lo pierdas como el de la tesis :P</Text></Message>
</Log>
`
// Buzón .mbox (2009): dos correos.
const MBOX = `From mamá Tue Sep 15 10:20:00 2009
From: Carmen Alfaro <carmen@correo.cl>
To: Felipe <felipe@correo.cl>
Subject: La receta de la abuela
Date: Tue, 15 Sep 2009 10:20:00 -0300

Hijo, aquí va la receta de los alfajores de la abuela Elena: maicena, manjar y mucho cariño.
Guárdala bien, que es la única copia que queda.

From felipe Wed Sep 16 08:00:00 2009
From: Felipe <felipe@correo.cl>
To: Carmen Alfaro <carmen@correo.cl>
Subject: Re: La receta de la abuela
Date: Wed, 16 Sep 2009 08:00:00 -0300

Gracias mamá, la imprimo y la pego en el refrigerador.
`
// Carpeta de Outlook Express (2004): cabecera binaria y mensajes guardados en bloques.
const DBX = Buffer.concat([
  Buffer.from([0xcf, 0xad, 0x12, 0xfe, 0xc5, 0xfd, 0x74, 0x6f]),
  Buffer.alloc(120),
  Buffer.from('From: Profesor Salinas <salinas@uv.cl>\r\nSubject: Correcciones de la tesis\r\n\r\nEstimado Felipe: revisé el capítulo tres de la tesis. Faltan las referencias de Valparaíso y el agradecimiento a Rosa Campos.\r\n', 'latin1'),
  Buffer.alloc(64, 0x01),
  Buffer.from('From: Rosa Campos <rosa@correo.cl>\r\nSubject: Viaje a Cusco\r\n\r\nYa compré los pasajes para Cusco en agosto. Lleva la cámara nueva.\r\n', 'latin1'),
  Buffer.alloc(200)
])
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
  ['2006-03-13', 'Messenger/historial_rosa.xml', MSN],
  ['2009-09-16', 'Correo/familia.mbox', MBOX],
  ['2004-11-20', 'Outlook Express/Bandeja de entrada.dbx', DBX],
  // Copiada en 2020 desde la cámara: el EXIF dice que se tomó el 4 de agosto de 2011.
  ['2020-01-10', 'Fotos/cusco_valle.jpg', jpegWithExif('2011:08:04 17:42:10')],
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
