import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OllamaClient, pickChatModel } from '@core/ai/ollama'
import { Orchestrator } from '@core/ai/orchestrator'
import { EntityExtractor, EntityService } from '@core/entities'
import { IndexPipeline } from '@core/indexing'
import { SqliteStore } from '@core/memory'

async function detect() {
  try {
    const models = await new OllamaClient().listModels()
    const chat = pickChatModel(models)
    return models.some((m) => m.startsWith('bge-m3')) && chat ? chat : undefined
  } catch {
    return undefined
  }
}
const chatModel = await detect()

describe.skipIf(!chatModel)('Entidades con modelos locales reales', () => {
  let root: string
  let store: SqliteStore
  let client: OllamaClient
  let entities: EntityService

  const put = (rel: string, text: string, when: Date) => {
    const full = join(root, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, text)
    utimesSync(full, when, when)
  }
  const t = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12))

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ouija-ents-'))
    put(
      'tesis.txt',
      'Agradecimientos. A Rosa Campos, por leer cada capítulo dos veces, y al doctor Salinas, de la Universidad de Valparaíso, por guiar este trabajo. ' +
        'El proyecto Aurora estudia redes de sensores. Gracias también a mis padres.',
      t(2008, 11, 2)
    )
    put(
      'diario_peru.txt',
      'Diario de viaje. Rosita se negó a subir al bus en Cusco hasta que sacamos la última foto del valle. Rosa y Matías nos esperaban en Arequipa con una lista de lugares.',
      t(2011, 8, 5)
    )
    put('poema.txt', 'Poema para Rosa. Tus manos guardan la luz de marzo, y yo, torpe, aprendo a nombrarla. Catorce versos escritos para ti.', t(2019, 3, 12))
    put(
      'contrato.txt',
      'Contrato de arriendo de departamento en calle Lira, Santiago. Arrendador: Luis Mendoza. El Sr. Mendoza entregará el inmueble en buen estado. Vigencia de doce meses.',
      t(2015, 4, 2)
    )
    put('receta.txt', 'Receta de torta de chocolate: mezcle harina, huevos y cacao. Hornee cuarenta minutos a 180 grados y deje enfriar antes de servir.', t(2020, 7, 1))

    client = new OllamaClient({ chatModel })
    store = new SqliteStore(':memory:', { dimensions: await client.probeDimensions() })
    await new IndexPipeline({ store, embedder: client }).indexFolder(root)
    const extractor = new EntityExtractor(store, client)
    const result = await extractor.indexPending({
      onProgress: (p) => p.current && console.info(`  entidades ${p.processed}/${p.total} ${p.current.split('/').pop()}`)
    })
    expect(result.errors).toBe(0)
    entities = new EntityService(store)
  }, 600_000)

  afterAll(async () => {
    await store?.close()
    rmSync(root, { recursive: true, force: true })
  })

  const dump = async () => {
    const mentions = await store.entityMentions()
    console.info(mentions.map((m) => `${m.kind}:${m.name}@${m.path.split('/').pop()}`).join('\n'))
  }

  it('extrae personas, lugares y proyectos con evidencia en el texto', async () => {
    await dump()
    const m = await store.entityMentions()
    const has = (kind: string, name: string, file: string) => m.some((x) => x.kind === kind && x.name.includes(name) && x.path.endsWith(file))

    expect(has('person', 'Rosa Campos', 'tesis.txt')).toBe(true)
    expect(has('person', 'Salinas', 'tesis.txt')).toBe(true)
    expect(has('place', 'Valparaíso', 'tesis.txt')).toBe(true)
    expect(has('project', 'Aurora', 'tesis.txt')).toBe(true)
    expect(has('person', 'Rosita', 'diario_peru.txt')).toBe(true)
    expect(has('place', 'Cusco', 'diario_peru.txt')).toBe(true)
    expect(has('person', 'Mendoza', 'contrato.txt')).toBe(true)
    expect(m.filter((x) => x.path.endsWith('receta.txt') && x.kind === 'person')).toEqual([])
  })

  it('une a Rosa solo con evidencia y deja que el usuario complete lo que falta', async () => {
    const people = await entities.people()
    console.info(people.map((p) => `${p.name} [${p.aliases.join(', ')}] ${p.paths.map((x) => x.split('/').pop()).join(', ')}`).join('\n'))

    // Rosa y Rosita aparecen juntas en el diario: la unión es automática. "Rosa Campos" solo aparece
    // en la tesis, sin Rosa: no hay evidencia para unirlas sola.
    const rosa = people.find((p) => p.norms.includes('rosa'))
    expect(rosa?.norms).toEqual(expect.arrayContaining(['rosa', 'rosita']))
    expect(people.some((p) => p.name === 'Rosa Campos' && !p.norms.includes('rosa'))).toBe(true)

    await entities.merge('person', 'Rosa', 'Rosa Campos')
    const merged = (await entities.people()).find((p) => p.norms.includes('rosa campos'))!
    const timeline = await entities.timeline(merged.id)
    expect(timeline!.items.map((i) => i.doc.path.split('/').pop())).toEqual(['tesis.txt', 'diario_peru.txt', 'poema.txt'])
    expect(timeline!.items.every((i) => i.context)).toBe(true)

    await entities.clearDecision('person', 'Rosa', 'Rosa Campos')
  })

  it('responde "¿qué archivos hablan de Rosa?" usando las entidades', async () => {
    const r = await new Orchestrator({ store, embedder: client, llm: client, entities }).ask('¿qué archivos hablan de Rosa?')
    console.info(r.answer, '\n', r.matches.map((m) => m.doc.path.split('/').pop()).join(' | '))
    const found = r.matches.map((m) => m.doc.path.split('/').pop())
    expect(found).toEqual(expect.arrayContaining(['tesis.txt', 'diario_peru.txt', 'poema.txt']))
    expect(found).not.toContain('receta.txt')
    expect(found).not.toContain('contrato.txt')
  }, 180_000)
})
