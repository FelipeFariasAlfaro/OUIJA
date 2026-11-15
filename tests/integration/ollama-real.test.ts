import { describe, expect, it } from 'vitest'
import { OllamaClient } from '@core/ai/ollama'

/** Prueba contra Ollama real. Se omite si el servidor o el modelo no están disponibles. */
async function ready(): Promise<boolean> {
  try {
    const models = await new OllamaClient().listModels()
    return models.some((m) => m.startsWith('bge-m3'))
  } catch {
    return false
  }
}
const available = await ready()

const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0)

describe.skipIf(!available)('Ollama real (bge-m3)', () => {
  it('entiende el significado en español, sin coincidir palabras', async () => {
    const client = new OllamaClient()
    const [query, poem, contract, recipe] = await client.embed([
      '¿dónde dejé los versos que le escribí a Rosa?',
      'Tus manos guardan la luz de marzo, y yo aprendo a nombrarla. Poema para Rosa.',
      'El arrendatario se obliga a pagar el canon mensual de arriendo por doce meses.',
      'Mezcle la harina con los huevos y hornee durante cuarenta minutos.'
    ])
    expect(query).toHaveLength(1024)
    expect(dot(query, poem)).toBeGreaterThan(dot(query, contract))
    expect(dot(query, poem)).toBeGreaterThan(dot(query, recipe))
  }, 120_000)
})
