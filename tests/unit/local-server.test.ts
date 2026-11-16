import { describe, expect, it } from 'vitest'
import { detectLocalServers, localServerBase, localServerLlm } from '../../src/core/ai/localServer'
import { sanitizeSettings } from '../../src/main/core/settings'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('servidores locales compatibles con OpenAI', () => {
  it('encuentra los que responden y descarta los modelos de embeddings', async () => {
    const fetch = (async (url: string) => {
      if (url.startsWith('http://127.0.0.1:1234/')) return json({ data: [{ id: 'qwen2.5-7b-instruct' }, { id: 'text-embedding-nomic-embed-text-v1.5' }] })
      if (url.startsWith('http://127.0.0.1:1337/')) return json({ data: [] })
      throw new Error('ECONNREFUSED')
    }) as typeof globalThis.fetch
    const found = await detectLocalServers({ fetch })
    expect(found).toEqual([{ name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234', models: ['qwen2.5-7b-instruct'] }])
  })
  it('solo acepta direcciones de este equipo', () => {
    expect(localServerBase('http://localhost:1234/v1/')).toBe('http://localhost:1234')
    expect(() => localServerBase('http://192.168.1.20:1234')).toThrow()
    expect(() => localServerBase('https://api.openai.com/v1')).toThrow()
  })
  it('pide JSON con esquema, quita el razonamiento <think> y, si el servidor no entiende el esquema, lo pide en el texto', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      bodies.push(body)
      if (body['response_format']) return json({ error: 'response_format not supported' }, 400)
      return json({ choices: [{ message: { content: '<think>pienso…</think>```json\n{"ok":true}\n```' } }] })
    }) as typeof globalThis.fetch
    const llm = localServerLlm('http://127.0.0.1:1234', 'qwen2.5-7b-instruct', { fetch })
    expect(await llm.complete('hola', { schema: { type: 'object' } })).toBe('{"ok":true}')
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toMatchObject({ model: 'qwen2.5-7b-instruct', response_format: { type: 'json_schema' } })
    expect(String((bodies[1].messages as { content: string }[])[0].content)).toContain('JSON')
  })
  it('la configuración rechaza servidores remotos y vuelve a Ollama', () => {
    expect(sanitizeSettings({ localServer: { baseUrl: 'http://127.0.0.1:1234/v1', model: 'm', name: 'LM Studio' } }).localServer).toEqual({ baseUrl: 'http://127.0.0.1:1234', model: 'm', name: 'LM Studio' })
    expect(sanitizeSettings({ localServer: { baseUrl: 'http://evil.com:1234', model: 'm' } }).localServer).toBeNull()
    expect(sanitizeSettings({ localServer: null }).localServer).toBeNull()
    expect(sanitizeSettings({}).localServer).toBeNull()
  })
})
