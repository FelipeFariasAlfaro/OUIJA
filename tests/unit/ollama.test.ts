import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertLocalHost, OllamaClient, OllamaError } from '@core/ai/ollama'

let server: Server
let host: string
const seen: { url: string; body: unknown }[] = []
let mode: 'ok' | 'missing' | 'error' = 'ok'

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined
      seen.push({ url: req.url ?? '', body })
      if (mode === 'missing') {
        res.writeHead(404).end('model "bge-m3" not found, try pulling it first')
        return
      }
      if (mode === 'error') {
        res.writeHead(500).end('boom')
        return
      }
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/embed') {
        const input = body.input as string[]
        res.end(JSON.stringify({ embeddings: input.map((t) => [t.length, 0, 0]) }))
      } else if (req.url === '/api/chat') {
        res.end(JSON.stringify({ message: { content: '  Un poema para Rosa.  ' } }))
      } else if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'bge-m3:latest' }] }))
      } else res.writeHead(404).end('nope')
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((ok) => server.close(() => ok())))

describe('assertLocalHost (P5)', () => {
  it('acepta solo servidores locales', () => {
    for (const ok of ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434']) {
      expect(() => assertLocalHost(ok)).not.toThrow()
    }
    for (const bad of ['http://example.com', 'https://api.openai.com', 'http://192.168.1.10:11434', 'file:///etc/passwd', 'no-es-url']) {
      expect(() => assertLocalHost(bad)).toThrow(OllamaError)
    }
  })

  it('el cliente rechaza hosts remotos al crearse', () => {
    expect(() => new OllamaClient({ host: 'http://example.com' })).toThrow(/solo se conecta a servidores locales/)
  })
})

describe('OllamaClient', () => {
  it('calcula embeddings por lotes, normalizados y en orden', async () => {
    mode = 'ok'
    seen.length = 0
    const client = new OllamaClient({ host })
    const texts = Array.from({ length: 20 }, (_, i) => 'x'.repeat(i + 1))
    const vectors = await client.embed(texts)

    expect(vectors).toHaveLength(20)
    expect(seen.filter((s) => s.url === '/api/embed')).toHaveLength(2) // lotes de 16
    for (const v of vectors) expect(Math.hypot(...v)).toBeCloseTo(1)
    expect((seen[0].body as { model: string }).model).toBe('bge-m3')
  })

  it('un texto vacío no hace llamadas', async () => {
    seen.length = 0
    expect(await new OllamaClient({ host }).embed([])).toEqual([])
    expect(seen).toHaveLength(0)
  })

  it('resume solo si hay modelo de chat', async () => {
    mode = 'ok'
    expect(await new OllamaClient({ host }).summarize('texto')).toBeUndefined()
    expect(await new OllamaClient({ host, chatModel: 'llama3.1:8b' }).summarize('texto')).toBe('Un poema para Rosa.')
  })

  it('distingue modelo faltante, error de servidor y servidor caído', async () => {
    mode = 'missing'
    await expect(new OllamaClient({ host }).embed(['a'])).rejects.toMatchObject({ code: 'model-missing', fatal: true })
    mode = 'error'
    await expect(new OllamaClient({ host }).embed(['a'])).rejects.toMatchObject({ code: 'bad-response', fatal: false })
    await expect(new OllamaClient({ host: 'http://127.0.0.1:1', timeoutMs: 2000 }).embed(['a'])).rejects.toMatchObject({
      code: 'unavailable',
      fatal: true
    })
  })

  it('lista modelos', async () => {
    mode = 'ok'
    expect(await new OllamaClient({ host }).listModels()).toEqual(['bge-m3:latest'])
  })
})
