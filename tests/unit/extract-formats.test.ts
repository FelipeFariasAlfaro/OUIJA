import { describe, expect, it } from 'vitest'
import { extractText, ExtractError, htmlToText, isSupportedExtension } from '@core/extract'
import { emlToText, svgToText } from '../../src/core/extract/formats'
import { buildEpub, buildOdt, buildPptx, buildXlsx } from '../helpers/officeBuilder'

const run = (name: string, data: Buffer | string) => extractText({ name, read: async () => (Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')) })

describe('hojas de cálculo, presentaciones y libros', () => {
  it('xlsx: nombre de la hoja y valores, fila por fila', async () => {
    const r = await run('presupuesto.xlsx', buildXlsx([['Concepto', 'Monto'], ['Arriendo', 450000], ['Luz & agua', 32000]]))
    expect(r.text).toBe('# Presupuesto\nConcepto\tMonto\nArriendo\t450000\nLuz & agua\t32000')
    expect(r.method).toBe('office')
  })

  it('pptx: texto de cada diapositiva', async () => {
    const r = await run('charla.pptx', buildPptx([['Arquitectura Moderna', 'con Appium 2'], ['Conclusiones']]))
    expect(r.text).toBe('Diapositiva 1\nArquitectura Moderna\ncon Appium 2\n\nDiapositiva 2\nConclusiones')
  })

  it('odt/ods/odp: texto del documento', async () => {
    expect((await run('carta.odt', buildOdt(['Querida Rosa', 'Te escribo desde Lima']))).text).toBe('Querida Rosa\nTe escribo desde Lima')
  })

  it('epub: texto de los capítulos', async () => {
    const r = await run('libro.epub', buildEpub(['<h1>Capítulo uno</h1><p>Había una vez</p>', '<p>Fin</p>']))
    expect(r.text).toContain('Capítulo uno')
    expect(r.text).toContain('Había una vez')
    expect(r.text).toContain('Fin')
  })

  it('un contenedor dañado falla con ExtractError y no con otra cosa', async () => {
    await expect(run('roto.xlsx', 'esto no es un zip')).rejects.toBeInstanceOf(ExtractError)
    await expect(run('roto.pptx', Buffer.from([1, 2, 3]))).rejects.toBeInstanceOf(ExtractError)
  })
})

describe('web, svg y correo', () => {
  it('html: solo el texto visible', () => {
    const t = htmlToText('<html><head><title>Mi página</title><style>p{color:red}</style></head><body><script>var x = "oculto"</script><h1>Hola</h1><p>Mundo &amp; más</p><!-- nada --></body></html>')
    expect(t).toBe('Mi página\nHola\nMundo & más')
    expect(t).not.toContain('oculto')
    expect(t).not.toContain('color')
  })

  it('svg: sus textos y títulos', async () => {
    const r = await run('logo.svg', '<svg><title>Logo Haka</title><g><text x="1">HAKA</text><text>LENS</text></g></svg>')
    expect(r.text.split('\n').sort()).toEqual(['HAKA', 'LENS', 'Logo Haka'])
    expect(svgToText('<svg><rect/></svg>')).toBe('')
  })

  it('eml: asunto, remitente y cuerpo, también en base64 y quoted-printable', () => {
    const simple = 'From: Ana <ana@x.cl>\r\nTo: Luis <luis@x.cl>\r\nSubject: =?UTF-8?B?' + Buffer.from('Reunión').toString('base64') + '?=\r\nDate: Mon, 3 Mar 2025 10:00:00 -0300\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nHola Luis, la reuni=C3=B3n es ma=C3=B1ana.'
    const t = emlToText(Buffer.from(simple))
    expect(t).toContain('Subject: Reunión')
    expect(t).toContain('From: Ana <ana@x.cl>')
    expect(t).toContain('la reunión es mañana.')

    const multipart = ['Subject: Adjunto', 'Content-Type: multipart/alternative; boundary="B1"', '', '--B1', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from('Texto plano del correo').toString('base64'), '--B1', 'Content-Type: text/html', '', '<p>otra versión</p>', '--B1--', ''].join('\r\n')
    expect(emlToText(Buffer.from(multipart))).toContain('Texto plano del correo')
  })
})

describe('código y datos', () => {
  it('lee código, json y xml como texto', async () => {
    expect((await run('app.py', 'def saludar():\n    return "hola"')).text).toContain('def saludar')
    expect((await run('datos.json', '{"nombre": "Rosa"}')).text).toContain('Rosa')
    expect((await run('config.xml', '<a><b>valor</b></a>')).method).toBe('text')
  })

  it('qué extensiones se pueden leer y cuáles solo se conocen por nombre', () => {
    for (const ext of ['txt', 'py', 'json', 'xlsx', 'pptx', 'odt', 'epub', 'html', 'eml', 'svg', 'pdf', 'doc', 'xls']) expect(isSupportedExtension(ext), ext).toBe(true)
    for (const ext of ['mp3', 'mp4', 'exe', 'ttf', 'psd', 'png']) expect(isSupportedExtension(ext), ext).toBe(false)
    expect(isSupportedExtension('png', { ocr: true })).toBe(true)
    expect(isSupportedExtension('mp3', { ocr: true })).toBe(false)
  })
})
