import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OllamaError } from '@core/ai/ollama'
import { Orchestrator, type Llm } from '@core/ai/orchestrator'
import { contextAround, EntityExtractor, EntityService, sanitizeEntities } from '@core/entities'
import { SqliteStore, type IndexedDoc } from '@core/memory'
import { FAKE_DIM, FakeEmbedder } from '../helpers/fakeEmbedder'

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12)

const THESIS = 'Agradecimientos: a Rosa Campos, por leer cada capítulo dos veces. Gracias también a Rosa y al Dr. Salinas, de la Universidad de Valparaíso. Proyecto Aurora, 2008.'
const DIARY = 'Diario de viaje. Rosita se negó a subir al bus en Cusco hasta que sacamos la última foto del valle. Rosa y Matías esperaban en Arequipa.'
const POEM = 'Poema para Rosa. Tus manos guardan la luz de marzo, y yo aprendo a nombrarla.'
const CONTRACT = 'Contrato de arriendo. Arrendador: Luis Mendoza. El Sr. Mendoza entregará el inmueble ubicado en calle Lira.'

let store: SqliteStore
beforeEach(() => {
  store = new SqliteStore(':memory:', { dimensions: FAKE_DIM })
})
afterEach(async () => store.close())

async function add(path: string, text: string, mtime: number): Promise<IndexedDoc> {
  const doc: IndexedDoc = { path, hash: `h:${path}:${text.length}`, size: text.length, mtime, atime: mtime, ext: 'txt' }
  await store.upsert(doc, [{ ord: 0, text, embedding: FakeEmbedder.vector(text) }])
  return doc
}

/** LLM falso: devuelve las entidades que se le indiquen por texto contenido. */
function llmReturning(table: Record<string, unknown>): Llm & { calls: number } {
  const llm = {
    calls: 0,
    async complete(prompt: string) {
      llm.calls++
      for (const [needle, out] of Object.entries(table)) if (prompt.includes(needle)) return typeof out === 'string' ? out : JSON.stringify(out)
      return JSON.stringify({ people: [], places: [], projects: [] })
    }
  }
  return llm
}

describe('sanitizeEntities', () => {
  it('conserva solo entidades que aparecen en el texto', () => {
    const r = sanitizeEntities(
      { people: ['Rosa Campos', 'Pedro Inventado', 'Dr. Salinas'], places: ['Valparaíso', 'Atlántida'], projects: ['Aurora', 'Proyecto Fantasma'] },
      THESIS
    )
    expect(r).toEqual([
      { kind: 'person', name: 'Rosa Campos' },
      { kind: 'person', name: 'Dr. Salinas' },
      { kind: 'place', name: 'Valparaíso' },
      { kind: 'project', name: 'Aurora' }
    ])
  })

  it('descarta pronombres, cargos sin nombre, duplicados y valores inválidos', () => {
    const text = 'Hoy el arrendador y Rosa hablaron. Rosa dijo que el cliente pagará, y yo aprobé.'
    const r = sanitizeEntities({ people: ['el arrendador', 'Rosa', 'rosa', 'ROSA', 'yo', 'cliente', 42, null, '', 'x'.repeat(100)], places: 'no es lista' }, text)
    expect(r).toEqual([{ kind: 'person', name: 'Rosa' }])
  })

  it('acepta cualquier forma de basura sin lanzar', () => {
    for (const raw of [null, undefined, 'texto', 12, [], {}, { people: 'x' }]) expect(sanitizeEntities(raw, 'texto')).toEqual([])
  })

  it('ignora tildes y puntuación al verificar la evidencia', () => {
    expect(sanitizeEntities({ people: ['Maria Jose Nunez'], places: [], projects: [] }, 'Escribió María-José Núñez ayer.')).toEqual([
      { kind: 'person', name: 'Maria Jose Nunez' }
    ])
  })
})

describe('EntityExtractor.indexPending', () => {
  it('procesa los documentos pendientes y no repite lo ya hecho', async () => {
    await add('/a/tesis.txt', THESIS, D(2008, 11, 2))
    await add('/a/poema.txt', POEM, D(2019, 3, 12))
    const llm = llmReturning({
      'Agradecimientos': { people: ['Rosa Campos', 'Rosa', 'Dr. Salinas'], places: ['Valparaíso'], projects: ['Aurora'] },
      'Poema para Rosa': { people: ['Rosa'], places: [], projects: [] }
    })
    const extractor = new EntityExtractor(store, llm)

    expect(await extractor.indexPending()).toEqual({ processed: 2, errors: 0 })
    expect(llm.calls).toBe(2)
    expect((await store.entityMentions('person')).map((x) => `${x.name}@${x.path}`).sort()).toEqual([
      'Dr. Salinas@/a/tesis.txt',
      'Rosa Campos@/a/tesis.txt',
      'Rosa@/a/poema.txt',
      'Rosa@/a/tesis.txt'
    ])

    expect(await extractor.indexPending()).toEqual({ processed: 0, errors: 0 })
    expect(llm.calls).toBe(2)
  })

  it('reextrae un archivo cuando su contenido cambia', async () => {
    await add('/a/nota.txt', 'Nota de trabajo con Rosa sobre el proyecto Aurora en la oficina de Cusco.', D(2020, 1, 1))
    const llm = llmReturning({ 'Nota de trabajo': { people: ['Rosa'], places: ['Cusco'], projects: ['Aurora'] }, 'Nota nueva': { people: ['Matías'], places: [], projects: [] } })
    const extractor = new EntityExtractor(store, llm)
    await extractor.indexPending()
    expect(await store.entityMentions()).toHaveLength(3)

    await add('/a/nota.txt', 'Nota nueva escrita por Matías con otro contenido distinto del anterior documento.', D(2021, 1, 1))
    expect(await store.entityMentions()).toEqual([]) // lo viejo se descarta al cambiar el contenido
    await extractor.indexPending()
    expect((await store.entityMentions()).map((x) => x.name)).toEqual(['Matías'])
  })

  it('un documento corto o sin entidades se marca como hecho', async () => {
    await add('/a/corto.txt', 'hola', D(2020, 1, 1))
    await add('/a/vacio.txt', 'Este documento no menciona a ninguna persona ni lugar en particular.', D(2020, 1, 1))
    const extractor = new EntityExtractor(store, llmReturning({}))
    await extractor.indexPending()
    expect(await store.pendingEntityDocs()).toEqual([])
  })

  it('una respuesta ilegible deja el documento pendiente y sigue con los demás', async () => {
    await add('/a/malo.txt', 'Documento malo con texto suficiente para pasar el mínimo de caracteres.', D(2020, 1, 1))
    await add('/a/bueno.txt', 'Documento bueno donde aparece Rosa en una frase con texto suficiente.', D(2020, 1, 2))
    const llm = llmReturning({ 'Documento malo': '{{{ no json', 'Documento bueno': { people: ['Rosa'], places: [], projects: [] } })
    const r = await new EntityExtractor(store, llm).indexPending()
    expect(r).toEqual({ processed: 2, errors: 1 })
    expect((await store.pendingEntityDocs()).map((d) => d.path)).toEqual(['/a/malo.txt'])
  })

  it('si Ollama cae, se detiene y lo hecho se conserva', async () => {
    await add('/a/1-uno.txt', 'Primer documento donde aparece Rosa en una frase con texto suficiente.', D(2020, 1, 1))
    await add('/a/2-dos.txt', 'Segundo documento donde aparece Rosa en una frase con texto suficiente.', D(2020, 1, 2))
    let n = 0
    const llm: Llm = {
      async complete() {
        if (++n === 2) throw new OllamaError('unavailable', 'sin conexión')
        return JSON.stringify({ people: ['Rosa'], places: [], projects: [] })
      }
    }
    await expect(new EntityExtractor(store, llm).indexPending()).rejects.toMatchObject({ code: 'unavailable' })
    expect((await store.entityMentions()).map((x) => x.path)).toEqual(['/a/1-uno.txt'])
    expect((await store.pendingEntityDocs()).map((d) => d.path)).toEqual(['/a/2-dos.txt'])
  })

  it('se puede cancelar', async () => {
    await add('/a/uno.txt', 'Primer documento donde aparece Rosa en una frase con texto suficiente.', D(2020, 1, 1))
    const controller = new AbortController()
    controller.abort()
    expect(await new EntityExtractor(store, llmReturning({})).indexPending({ signal: controller.signal })).toEqual({ processed: 0, errors: 0 })
  })
})

describe('EntityStore', () => {
  it('olvidar un archivo borra sus entidades (P8)', async () => {
    await add('/a/uno.txt', THESIS, D(2008, 1, 1))
    await store.setEntities('/a/uno.txt', [{ kind: 'person', name: 'Rosa' }])
    await store.forget('/a/uno.txt')
    expect(await store.entityMentions()).toEqual([])
  })

  it('olvidar todo borra también las decisiones manuales', async () => {
    await add('/a/uno.txt', THESIS, D(2008, 1, 1))
    await store.setEntities('/a/uno.txt', [{ kind: 'person', name: 'Rosa' }])
    await new EntityService(store).merge('person', 'Rosa', 'Rosita')
    await store.forgetAll()
    expect(await store.entityMentions()).toEqual([])
    expect(await store.entityLinks()).toEqual([])
  })

  it('las decisiones manuales no dependen del orden de los nombres', async () => {
    await store.setEntityLink({ kind: 'person', a: 'z', b: 'a', relation: 'same' })
    await store.setEntityLink({ kind: 'person', a: 'a', b: 'z', relation: 'different' })
    expect(await store.entityLinks()).toEqual([{ kind: 'person', a: 'a', b: 'z', relation: 'different' }])
    await store.removeEntityLink('person', 'z', 'a')
    expect(await store.entityLinks()).toEqual([])
  })

  it('propiedad P8: tras olvidar archivos, toda entidad referencia archivos que existen', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.constantFrom('a', 'b', 'c', 'd'), fc.subarray(['Rosa', 'Rosita', 'Rosa Campos', 'Luis'], { minLength: 0 })), { minLength: 1, maxLength: 8 }),
        fc.subarray(['a', 'b', 'c', 'd']),
        async (files, toForget) => {
          const s = new SqliteStore(':memory:', { dimensions: FAKE_DIM })
          try {
            for (const [name, names] of files) {
              const text = `documento ${name} con nombres ${names.join(' ')}`
              await s.upsert({ path: `/p/${name}`, hash: text, size: 1, mtime: 1, ext: 'txt' }, [{ ord: 0, text, embedding: FakeEmbedder.vector(text) }])
              await s.setEntities(`/p/${name}`, names.map((n) => ({ kind: 'person' as const, name: n })))
            }
            for (const f of toForget) await s.forget(`/p/${f}`)

            for (const e of await new EntityService(s).people()) {
              expect(e.paths.length).toBeGreaterThan(0)
              for (const p of e.paths) expect(await s.hasPath(p)).toBe(true)
            }
          } finally {
            await s.close()
          }
        }
      ),
      { numRuns: 60 }
    )
  })
})

describe('EntityService', () => {
  async function seed() {
    await add('/a/tesis.txt', THESIS, D(2008, 11, 2))
    await add('/a/diario.txt', DIARY, D(2011, 8, 5))
    await add('/a/poema.txt', POEM, D(2019, 3, 12))
    await add('/a/contrato.txt', CONTRACT, D(2015, 4, 2))
    await store.setEntities('/a/tesis.txt', [{ kind: 'person', name: 'Rosa Campos' }, { kind: 'person', name: 'Rosa' }, { kind: 'person', name: 'Dr. Salinas' }, { kind: 'place', name: 'Valparaíso' }])
    await store.setEntities('/a/diario.txt', [{ kind: 'person', name: 'Rosita' }, { kind: 'person', name: 'Rosa' }, { kind: 'person', name: 'Matías' }, { kind: 'place', name: 'Cusco' }])
    await store.setEntities('/a/poema.txt', [{ kind: 'person', name: 'Rosa' }])
    await store.setEntities('/a/contrato.txt', [{ kind: 'person', name: 'Luis Mendoza' }, { kind: 'person', name: 'Sr. Mendoza' }])
    return new EntityService(store)
  }

  it('reconstruye personas con sus alias y archivos', async () => {
    const people = await (await seed()).people()
    const rosa = people.find((p) => p.name === 'Rosa Campos')
    expect(rosa).toBeDefined()
    // "Rosa" aparece con "Rosa Campos" (tesis) y con "Rosita" (diario), y Rosita es diminutivo de Rosa.
    expect(rosa!.aliases).toEqual(['Rosa', 'Rosita'])
    expect(people.map((p) => p.name)).toContain('Luis Mendoza')
    expect(people.filter((p) => p.name === 'Luis Mendoza')[0].aliases).toEqual(['Sr. Mendoza'])
  })

  it('arma la línea de tiempo en orden cronológico con contexto', async () => {
    const service = await seed()
    await service.merge('person', 'Rosita', 'Rosa')
    await service.merge('person', 'Rosa', 'Rosa Campos')
    const rosa = (await service.people()).find((p) => p.name === 'Rosa Campos')!
    const timeline = await service.timeline(rosa.id)

    expect(timeline!.items.map((i) => i.doc.path)).toEqual(['/a/tesis.txt', '/a/diario.txt', '/a/poema.txt'])
    expect(timeline!.items[1].context).toContain('Rosita se negó')
    expect(timeline!.items.every((i) => i.context !== undefined)).toBe(true)
  })

  it('merge y split cambian el resultado y se pueden deshacer', async () => {
    const service = await seed()
    const before = (await service.people()).length
    await service.merge('person', 'Matías', 'Luis Mendoza')
    expect((await service.people()).length).toBe(before - 1)
    await service.clearDecision('person', 'Matías', 'Luis Mendoza')
    expect((await service.people()).length).toBe(before)

    await service.split('person', 'Rosa', 'Rosa Campos')
    expect((await service.people()).some((p) => p.name === 'Rosa Campos' && p.aliases.length === 0)).toBe(true)
  })

  it('encuentra qué entidades menciona una pregunta, sin importar tildes', async () => {
    const service = await seed()
    expect((await service.mentionedIn('¿qué archivos hablan de rosa campos?')).map((e) => e.name)).toContain('Rosa Campos')
    expect((await service.mentionedIn('¿y de VALPARAISO?')).map((e) => e.name)).toEqual(['Valparaíso'])
    expect(await service.mentionedIn('algo sin nombres')).toEqual([])
  })

  it('timeline de una entidad inexistente es undefined', async () => {
    expect(await (await seed()).timeline('person:nadie')).toBeUndefined()
  })
})

describe('contextAround', () => {
  it('devuelve el entorno del nombre, sin importar tildes', () => {
    expect(contextAround('Fuimos a Valparaíso en tren con mucha gente.', ['valparaiso'])).toContain('Valparaíso')
    expect(contextAround('nada que ver', ['Rosa'])).toBeUndefined()
  })
})

describe('Orchestrator con entidades (R7.4)', () => {
  it('"¿qué archivos hablan de Rosa?" trae archivos que solo la mencionan con otro nombre', async () => {
    await add('/a/tesis.txt', THESIS, D(2008, 11, 2))
    await add('/a/diario.txt', DIARY, D(2011, 8, 5))
    await add('/a/contrato.txt', CONTRACT, D(2015, 4, 2))
    await store.setEntities('/a/tesis.txt', [{ kind: 'person', name: 'Rosa Campos' }, { kind: 'person', name: 'Rosa' }])
    await store.setEntities('/a/diario.txt', [{ kind: 'person', name: 'Rosa' }, { kind: 'person', name: 'Rosita' }])
    await store.setEntities('/a/contrato.txt', [{ kind: 'person', name: 'Luis Mendoza' }])
    const entities = new EntityService(store)
    await entities.merge('person', 'Rosa', 'Rosita')

    const r = await new Orchestrator({ store, embedder: new FakeEmbedder(), entities }).ask('¿qué archivos hablan de Rosita?')

    const paths = r.matches.map((m) => m.doc.path)
    expect(paths).toEqual(expect.arrayContaining(['/a/tesis.txt', '/a/diario.txt']))
    expect(paths).not.toContain('/a/contrato.txt')
    expect(r.found).toBe(true)
  })

  it('el modelo no puede descartar los archivos de la persona nombrada', async () => {
    await add('/a/tesis.txt', THESIS, D(2008, 11, 2))
    await add('/a/diario.txt', DIARY, D(2011, 8, 5))
    await store.setEntities('/a/tesis.txt', [{ kind: 'person', name: 'Rosa Campos' }])
    await store.setEntities('/a/diario.txt', [{ kind: 'person', name: 'Rosa' }, { kind: 'person', name: 'Rosita' }])
    const prompts: string[] = []
    const llm: Llm = {
      async complete(prompt) {
        prompts.push(prompt)
        if (prompt.includes('Convierte la pregunta')) return JSON.stringify({ query: 'Rosa', extensions: [], dateFrom: null, dateTo: null })
        // El modelo "duda" y solo elige el primero.
        return JSON.stringify({ found: true, relevant: [1], answer: 'Solo uno.' })
      }
    }
    const r = await new Orchestrator({ store, embedder: new FakeEmbedder(), llm, entities: new EntityService(store) }).ask('¿qué archivos hablan de Rosa?')

    expect(r.matches.map((m) => m.doc.path).sort()).toEqual(['/a/diario.txt', '/a/tesis.txt'])
    expect(prompts.at(-1)).toContain('Menciona a «Rosa Campos»')
    expect(r.answer).not.toBe('Solo uno.') // la respuesta del modelo ya no describe todo el resultado
  })

  it('si el modelo dice que no hay nada pero la persona existe, igual devuelve sus archivos', async () => {
    await add('/a/tesis.txt', THESIS, D(2008, 11, 2))
    await store.setEntities('/a/tesis.txt', [{ kind: 'person', name: 'Rosa Campos' }])
    const llm: Llm = {
      async complete(prompt) {
        if (prompt.includes('Convierte la pregunta')) return JSON.stringify({ query: 'Rosa', extensions: [], dateFrom: null, dateTo: null })
        return JSON.stringify({ found: false, relevant: [], answer: '' })
      }
    }
    const r = await new Orchestrator({ store, embedder: new FakeEmbedder(), llm, entities: new EntityService(store) }).ask('¿qué archivos hablan de Rosa?')
    expect(r.found).toBe(true)
    expect(r.matches.map((m) => m.doc.path)).toEqual(['/a/tesis.txt'])
  })

  it('respeta los filtros de fecha', async () => {
    await add('/a/tesis.txt', THESIS, D(2008, 11, 2))
    await add('/a/poema.txt', POEM, D(2019, 3, 12))
    await store.setEntities('/a/tesis.txt', [{ kind: 'person', name: 'Rosa' }])
    await store.setEntities('/a/poema.txt', [{ kind: 'person', name: 'Rosa' }])
    const r = await new Orchestrator({ store, embedder: new FakeEmbedder(), entities: new EntityService(store) }).ask('archivos de Rosa del 2019')
    expect(r.matches.map((m) => m.doc.path)).toEqual(['/a/poema.txt'])
  })
})
