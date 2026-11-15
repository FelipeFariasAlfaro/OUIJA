import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_IDS } from '@shared/ai'
import { AiError, createProvider, extractJson } from '@core/ai/providers'
import { Http } from '../../src/core/ai/providers/http'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | undefined
}

/** `fetch` de mentira: guarda cada llamada y responde con lo que devuelva `reply`. */
function fake(reply: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    }
    calls.push(call)
    return reply(call, calls.length)
  }) as typeof fetch
  return { f, calls }
}
const json = (body: unknown, status = 200) => Response.json(body, { status })
const KEY = 'sk-test-0123456789abcdef'
const SCHEMA = { type: 'object', properties: { found: { type: 'boolean' } }, required: ['found'] }

describe('OpenAI', () => {
  it('lista solo modelos de chat, los más nuevos primero, con la clave en el encabezado', async () => {
    const { f, calls } = fake(() =>
      json({
        data: [
          { id: 'text-embedding-3-small', created: 5 },
          { id: 'gpt-4o', created: 100 },
          { id: 'whisper-1', created: 6 },
          { id: 'gpt-5-mini', created: 300 },
          { id: 'gpt-4o-audio-preview', created: 150 },
          { id: 'o3', created: 200 },
          { id: 'dall-e-3', created: 7 },
          { id: 'gpt-image-1', created: 8 },
          { id: 'omni-moderation-latest', created: 9 }
        ]
      })
    )
    const models = await createProvider('openai', KEY, { fetch: f }).listModels()
    expect(models.map((m) => m.id)).toEqual(['gpt-5-mini', 'o3', 'gpt-4o'])
    expect(calls[0]).toMatchObject({ url: 'https://api.openai.com/v1/models', method: 'GET' })
    expect(calls[0].headers['authorization']).toBe(`Bearer ${KEY}`)
  })

  it('pide JSON con esquema, sin temperature y con max_completion_tokens', async () => {
    const { f, calls } = fake(() => json({ choices: [{ message: { content: '{"found":true}' } }] }))
    const out = await createProvider('openai', KEY, { fetch: f }).llm('gpt-5-mini').complete('Hola', { schema: SCHEMA, maxTokens: 200 })
    expect(out).toBe('{"found":true}')
    const body = calls[0].body!
    expect(body['model']).toBe('gpt-5-mini')
    expect(body['max_completion_tokens']).toBeGreaterThanOrEqual(200)
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('max_tokens')
    expect((body['response_format'] as { type: string }).type).toBe('json_schema')
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('si el modelo no admite el esquema, repite con "JSON válido"', async () => {
    const { f, calls } = fake((_c, n) => (n === 1 ? json({ error: { message: "Invalid parameter: 'response_format' of type 'json_schema' is not supported" } }, 400) : json({ choices: [{ message: { content: '```json\n{"found":false}\n```' } }] })))
    const out = await createProvider('openai', KEY, { fetch: f }).llm('gpt-4').complete('Hola', { schema: SCHEMA })
    expect(out).toBe('{"found":false}')
    expect(calls).toHaveLength(2)
    expect((calls[1].body!['response_format'] as { type: string }).type).toBe('json_object')
  })

  it('texto libre sin esquema', async () => {
    const { f } = fake(() => json({ choices: [{ message: { content: '  Hola mundo  ' } }] }))
    expect(await createProvider('openai', KEY, { fetch: f }).llm('gpt-4o').complete('Hola')).toBe('Hola mundo')
  })
})

describe('Claude (Anthropic)', () => {
  it('lista los modelos de la clave, con paginación y nombres legibles', async () => {
    const { f, calls } = fake((c) =>
      c.url.includes('after_id=m2')
        ? json({ data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }], has_more: false })
        : json({ data: [{ id: 'claude-opus-4-1', display_name: 'Claude Opus 4.1' }, { id: 'm2', display_name: 'Otro' }], has_more: true, last_id: 'm2' })
    )
    const models = await createProvider('anthropic', 'sk-ant-abcdefghij', { fetch: f }).listModels()
    expect(models).toEqual([
      { id: 'claude-opus-4-1', name: 'Claude Opus 4.1' },
      { id: 'm2', name: 'Otro' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }
    ])
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/models?limit=100')
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-abcdefghij')
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01')
    expect(calls[0].headers).not.toHaveProperty('authorization')
  })

  it('con esquema fuerza una herramienta y devuelve sus argumentos como JSON', async () => {
    const { f, calls } = fake(() => json({ content: [{ type: 'tool_use', name: 'responder', input: { found: true } }] }))
    const out = await createProvider('anthropic', 'sk-ant-abcdefghij', { fetch: f }).llm('claude-haiku-4-5').complete('Hola', { schema: SCHEMA, maxTokens: 100 })
    expect(JSON.parse(out)).toEqual({ found: true })
    const b = calls[0].body!
    expect(b['tool_choice']).toEqual({ type: 'tool', name: 'responder' })
    expect((b['tools'] as { input_schema: object }[])[0].input_schema).toEqual(SCHEMA)
    expect(b['max_tokens']).toBeGreaterThanOrEqual(100)
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
  })

  it('sin esquema devuelve el texto', async () => {
    const { f } = fake(() => json({ content: [{ type: 'text', text: 'Hola ' }, { type: 'text', text: 'mundo' }] }))
    expect(await createProvider('anthropic', 'sk-ant-abcdefghij', { fetch: f }).llm('x').complete('Hola')).toBe('Hola mundo')
  })

  it('si el modelo no admite la temperatura, repite sin ella', async () => {
    const { f, calls } = fake((_c, n) => (n === 1 ? json({ error: { message: '`temperature` is deprecated for this model' } }, 400) : json({ content: [{ type: 'text', text: 'ok' }] })))
    expect(await createProvider('anthropic', 'sk-ant-abcdefghij', { fetch: f }).llm('x').complete('Hola')).toBe('ok')
    expect(calls[0].body).toHaveProperty('temperature')
    expect(calls[1].body).not.toHaveProperty('temperature')
  })

  it('una respuesta sin la estructura pedida es un error claro', async () => {
    const { f } = fake(() => json({ content: [{ type: 'text', text: 'no usé la herramienta' }] }))
    await expect(createProvider('anthropic', 'sk-ant-abcdefghij', { fetch: f }).llm('x').complete('Hola', { schema: SCHEMA })).rejects.toMatchObject({ code: 'bad-response' })
  })
})

describe('Gemini', () => {
  it('manda la clave en el encabezado (nunca en la dirección) y lista solo modelos de texto', async () => {
    const { f, calls } = fake(() =>
      json({
        models: [
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'TTS', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/imagen-4.0', displayName: 'Imagen', supportedGenerationMethods: ['predict'] },
          { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] }
        ]
      })
    )
    const models = await createProvider('gemini', 'AIzaSyTESTKEY12345', { fetch: f }).listModels()
    expect(models).toEqual([
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
    ])
    expect(calls[0].headers['x-goog-api-key']).toBe('AIzaSyTESTKEY12345')
    expect(calls[0].url).not.toContain('AIza')
  })

  it('pide JSON, devuelve el texto y usa la ruta del modelo', async () => {
    const { f, calls } = fake(() => json({ candidates: [{ content: { parts: [{ text: '{"found":true}' }] } }] }))
    const out = await createProvider('gemini', 'AIzaSyTESTKEY12345', { fetch: f }).llm('gemini-2.5-flash').complete('Hola', { schema: SCHEMA })
    expect(out).toBe('{"found":true}')
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    const cfg = calls[0].body!['generationConfig'] as Record<string, unknown>
    expect(cfg['responseMimeType']).toBe('application/json')
    expect(JSON.stringify(calls[0].body!['contents'])).toContain('esquema')
  })

  it('una consulta bloqueada se explica', async () => {
    const { f } = fake(() => json({ promptFeedback: { blockReason: 'SAFETY' } }))
    await expect(createProvider('gemini', 'AIzaSyTESTKEY12345', { fetch: f }).llm('gemini-2.5-flash').complete('Hola')).rejects.toThrow(/SAFETY/)
  })

  it('no permite colar rutas en el nombre del modelo', () => {
    for (const bad of ['../../v1/files', 'a b', 'x?key=1', 'm/odel', '']) {
      expect(() => createProvider('gemini', 'AIzaSyTESTKEY12345', { fetch: fake(() => json({})).f }).llm(bad)).toThrow(AiError)
    }
  })
})

describe('DeepSeek', () => {
  it('usa su propio servidor y pide "JSON válido" con el esquema dentro del mensaje', async () => {
    const { f, calls } = fake(() => json({ choices: [{ message: { content: '{"found":true}' } }] }))
    await createProvider('deepseek', KEY, { fetch: f }).llm('deepseek-chat').complete('Hola', { schema: SCHEMA, maxTokens: 100 })
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions')
    expect(calls[0].body!['response_format']).toEqual({ type: 'json_object' })
    expect(calls[0].body!['max_tokens']).toBe(100)
    expect((calls[0].body!['messages'] as { content: string }[])[0].content).toContain('"found"')
  })

  it('el modelo que razona no recibe response_format, pero su JSON igual se rescata', async () => {
    const { f, calls } = fake(() => json({ choices: [{ message: { content: 'Aquí está:\n```json\n{"found":true}\n```' } }] }))
    const out = await createProvider('deepseek', KEY, { fetch: f }).llm('deepseek-reasoner').complete('Hola', { schema: SCHEMA })
    expect(out).toBe('{"found":true}')
    expect(calls[0].body).not.toHaveProperty('response_format')
  })

  it('lista los modelos que devuelve', async () => {
    const { f, calls } = fake(() => json({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }))
    expect((await createProvider('deepseek', KEY, { fetch: f }).listModels()).map((m) => m.id)).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(calls[0].url).toBe('https://api.deepseek.com/models')
  })
})

describe('errores', () => {
  const cases: [number, unknown, string][] = [
    [401, { error: { message: 'Incorrect API key provided' } }, 'invalid-key'],
    [400, { error: { message: 'API key not valid. Please pass a valid API key.' } }, 'invalid-key'],
    [402, { error: { message: 'Insufficient Balance' } }, 'quota'],
    [429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.' } }, 'quota'],
    [429, { error: { message: 'Rate limit reached' } }, 'rate-limit'],
    [403, { error: { message: 'permission denied' } }, 'forbidden'],
    [404, { error: { message: 'model not found' } }, 'model-unavailable'],
    [500, { error: { message: 'boom' } }, 'bad-response']
  ]
  for (const id of AI_PROVIDER_IDS) {
    it(`${id}: traduce los códigos HTTP a errores claros`, async () => {
      for (const [status, body, code] of cases) {
        const { f } = fake(() => json(body, status))
        await expect(createProvider(id, KEY, { fetch: f }).listModels(), `${status}`).rejects.toMatchObject({ code })
      }
    })

    it(`${id}: sin red es "network" y la clave nunca aparece en el mensaje`, async () => {
      const boom = (async () => {
        throw new TypeError(`fetch failed ${KEY}`)
      }) as typeof fetch
      const error = await createProvider(id, KEY, { fetch: boom }).listModels().catch((e: unknown) => e)
      expect(error).toMatchObject({ code: 'network' })
      expect((error as Error).message).not.toContain(KEY)
    })
  }

  it('si el servicio devuelve la clave en el error, se oculta', async () => {
    const { f } = fake(() => json({ error: { message: `Incorrect API key provided: ${KEY}` } }, 401))
    const error = (await createProvider('openai', KEY, { fetch: f }).listModels().catch((e: unknown) => e)) as AiError
    expect(error.code).toBe('invalid-key')
    expect(error.message).not.toContain(KEY)
    expect(error.message).toContain('•••')
  })

  it('"fatal" distingue lo que no se arregla reintentando', () => {
    for (const code of ['invalid-key', 'forbidden', 'quota', 'network', 'blocked', 'model-unavailable'] as const) expect(new AiError(code, 'x').fatal).toBe(true)
    for (const code of ['rate-limit', 'bad-response'] as const) expect(new AiError(code, 'x').fatal).toBe(false)
  })
})

describe('solo habla con los proveedores conocidos', () => {
  it('rechaza una dirección base remota y acepta localhost (pruebas)', () => {
    for (const id of AI_PROVIDER_IDS) {
      expect(() => createProvider(id, KEY, { baseUrl: 'https://evil.example.com/v1' })).toThrow(/no permitido/)
      expect(() => createProvider(id, KEY, { baseUrl: 'http://127.0.0.1:9999' })).not.toThrow()
    }
  })

  it('propiedad: ningún host que no sea local pasa como dirección base', () => {
    fc.assert(
      fc.property(fc.constantFrom('http', 'https'), fc.domain(), (scheme, host) => {
        fc.pre(host !== 'localhost')
        expect(() => new Http('https://api.openai.com/v1', {}, KEY, { baseUrl: `${scheme}://${host}/v1` })).toThrow(AiError)
      }),
      { numRuns: 200 }
    )
  })

  it('las direcciones por defecto son las oficiales y con https', async () => {
    const hosts: Record<string, string> = { openai: 'api.openai.com', anthropic: 'api.anthropic.com', gemini: 'generativelanguage.googleapis.com', deepseek: 'api.deepseek.com' }
    for (const id of AI_PROVIDER_IDS) {
      const { f, calls } = fake(() => json({ data: [], models: [] }))
      await createProvider(id, KEY, { fetch: f }).listModels()
      expect(new URL(calls[0].url)).toMatchObject({ protocol: 'https:', hostname: hosts[id] })
    }
  })
})

describe('extractJson', () => {
  it('saca el objeto de bloques de código y de texto alrededor', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJson('Claro: {"a":{"b":2}} listo')).toBe('{"a":{"b":2}}')
    expect(extractJson('{"a":1}')).toBe('{"a":1}')
    expect(extractJson('sin json')).toBe('sin json')
  })
})
