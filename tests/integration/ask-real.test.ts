import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OllamaClient, pickChatModel } from '@core/ai/ollama'
import { findInvalidCitations, Orchestrator } from '@core/ai/orchestrator'
import { IndexPipeline } from '@core/indexing'
import { SqliteStore } from '@core/memory'
import { buildZip } from '../helpers/zipBuilder'

/** Extremo a extremo con Ollama real: indexa una carpeta y responde preguntas. Se omite sin los modelos. */
async function setup() {
  try {
    const models = await new OllamaClient().listModels()
    const chat = pickChatModel(models)
    return models.some((m) => m.startsWith('bge-m3')) && chat ? chat : undefined
  } catch {
    return undefined
  }
}
const chatModel = await setup()

describe.skipIf(!chatModel)('Pregunta y respuesta con modelos locales reales', () => {
  let root: string
  let store: SqliteStore
  let orchestrator: Orchestrator
  const t = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12))

  const put = (rel: string, text: string, when: Date) => {
    const full = join(root, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, text)
    utimesSync(full, when, when)
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'medium-real-'))
    put('Personal/borrador_final3.txt', 'Poema para Rosa\n\nTus manos guardan la luz de marzo,\ny yo, torpe, aprendo a nombrarla.\nCatorce versos escritos para ti, Rosa.', t(2019, 3, 12))
    put('Antiguos/contrato_arriendo_2015.txt', 'Contrato de arriendo de departamento ubicado en calle Lira. Vigencia de doce meses, renovable. Arrendador: Luis Mendoza.', t(2015, 4, 2))
    put('Trabajo/contrato_servicios.txt', 'Contrato de prestación de servicios profesionales de consultoría entre las partes, con plazo hasta diciembre de 2024.', t(2024, 1, 15))
    put('Cocina/receta_torta.txt', 'Receta de torta de chocolate: mezcle harina, huevos y cacao. Hornee cuarenta minutos a 180 grados.', t(2020, 7, 1))
    put('Viajes/diario_peru.txt', 'Diario de viaje por Cusco y Arequipa. Dos semanas de caminatas, buses y mucho frío en la altura.', t(2011, 8, 5))
    writeFileSync(
      join(root, 'respaldo_2008.zip'),
      buildZip([{ name: 'Poemas/rosa_v1.txt', data: 'Para Rosa, primer borrador del poema. Tus manos guardan la luz y yo aprendo a nombrarla.' }])
    )

    const client = new OllamaClient({ chatModel })
    store = new SqliteStore(':memory:', { dimensions: await client.probeDimensions() })
    await new IndexPipeline({ store, embedder: client }).indexFolder(root)
    orchestrator = new Orchestrator({ store, embedder: client, llm: client })
  }, 300_000)

  afterAll(async () => {
    await store?.close()
    rmSync(root, { recursive: true, force: true })
  })

  const ask = async (q: string) => {
    const started = Date.now()
    const r = await orchestrator.ask(q, { now: new Date('2026-11-14') })
    console.info(`[${Date.now() - started} ms] ${q}\n  → ${r.found ? 'found' : 'not found'} (${r.mode}${r.relaxed ? ', relaxed' : ''}) ${r.matches.map((m) => m.doc.path.slice(root.length + 1)).join(' | ')}\n  ${r.answer}\n  ${r.warnings.join(' / ')}`)
    return r
  }

  it('encuentra el poema para Rosa y su versión antigua dentro del ZIP', async () => {
    const r = await ask('¿Dónde está el poema para Rosa?')
    const found = r.matches.map((m) => m.doc.path.slice(root.length + 1))
    expect(r.found).toBe(true)
    expect(r.mode).toBe('full')
    expect(found[0]).toBe('Personal/borrador_final3.txt')
    expect(found).toContain('respaldo_2008.zip::Poemas/rosa_v1.txt')
    expect(found).not.toContain('Cocina/receta_torta.txt')
    expect(findInvalidCitations(r.answer, r.matches)).toEqual([])
  }, 180_000)

  it('lista los contratos y deja fuera lo que no es un contrato', async () => {
    const r = await ask('¿Qué contratos tengo guardados?')
    const found = r.matches.map((m) => m.doc.path.slice(root.length + 1))
    expect(found).toEqual(expect.arrayContaining(['Antiguos/contrato_arriendo_2015.txt', 'Trabajo/contrato_servicios.txt']))
    expect(found).not.toContain('Cocina/receta_torta.txt')
  }, 180_000)

  it('interpreta el año de la pregunta como filtro de fecha', async () => {
    const r = await ask('el contrato del 2015')
    expect(r.filter?.dateFrom).toBeDefined()
    expect(r.matches.map((m) => m.doc.path.slice(root.length + 1))).toEqual(['Antiguos/contrato_arriendo_2015.txt'])
  }, 180_000)

  it('dice que no encontró cuando no hay nada relacionado', async () => {
    const r = await ask('¿a qué hora es mi cita con el dentista?')
    expect(r.found).toBe(false)
    expect(r.matches).toEqual([])
  }, 180_000)
})
