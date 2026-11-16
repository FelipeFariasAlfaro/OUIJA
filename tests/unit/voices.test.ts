import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { exifDate, extractText } from '@core/extract'

const chaos = resolve('fixtures/chaos')
const read = (rel: string) => readFileSync(resolve(chaos, rel))
const input = (rel: string) => ({ name: rel.split('/').pop()!, read: async () => read(rel) })

beforeAll(() => {
  execFileSync('node', ['scripts/make-fixtures.mjs'])
})

describe('voces del más allá', () => {
  it('MSN Messenger: cada mensaje con fecha, quién habla y a quién', async () => {
    const r = await extractText(input('Messenger/historial_rosa.xml'))
    expect(r).toMatchObject({ origin: 'msn', resurrected: true, confidence: 'high' })
    expect(r.text).toContain('Conversación de MSN Messenger entre Rosa ~ la luz de marzo, Felipe')
    expect(r.text).toContain('[2006-03-13 01:16] Felipe → Rosa ~ la luz de marzo: Casi. Lo guardé en el disquete azul, mañana te lo llevo a Concepción <3')
  })
  it('un XML cualquiera no se confunde con un historial de MSN', async () => {
    const r = await extractText({ name: 'pom.xml', read: async () => Buffer.from('<project><Message>hola</Message></project>') })
    expect(r.origin).toBeUndefined()
  })
  it('.mbox: los correos uno tras otro, con asunto y remitente', async () => {
    const r = await extractText(input('Correo/familia.mbox'))
    expect(r.origin).toBe('mbox')
    expect(r.text).toContain('Subject: La receta de la abuela')
    expect(r.text).toContain('alfajores de la abuela Elena')
    expect(r.text).toContain('la imprimo y la pego')
  })
  it('Outlook Express: se rescatan los mensajes de los bytes y se marca como resucitado', async () => {
    const r = await extractText(input('Outlook Express/Bandeja de entrada.dbx'))
    expect(r).toMatchObject({ origin: 'outlook-express', resurrected: true })
    expect(r.confidence).not.toBe('high')
    expect(r.text).toContain('Correcciones de la tesis')
    expect(r.text).toContain('pasajes para Cusco')
    await expect(extractText({ name: 'falso.dbx', read: async () => Buffer.from('no soy outlook') })).rejects.toThrow()
  })
  it('EXIF: la fecha en que se tomó la foto, no la de la copia; tolera basura', () => {
    expect(exifDate(read('Fotos/cusco_valle.jpg'))).toBe(Date.UTC(2011, 7, 4, 17, 42, 10))
    expect(exifDate(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]))).toBeUndefined()
    expect(exifDate(Buffer.from('no es un jpeg'))).toBeUndefined()
    expect(exifDate(read('Logos Hakas/Logo Haka Lens blanco (1).png'))).toBeUndefined()
  })
})
