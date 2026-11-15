import type { Embedder, Summarizer } from '../indexing/types'

export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'
export const DEFAULT_EMBED_MODEL = 'bge-m3'

export type OllamaErrorCode = 'unavailable' | 'model-missing' | 'bad-response' | 'not-local'

export class OllamaError extends Error {
  constructor(
    readonly code: OllamaErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'OllamaError'
  }
  /** Fallos que impiden seguir (a diferencia de un documento puntual que no se pudo procesar). */
  get fatal(): boolean {
    return this.code === 'unavailable' || this.code === 'model-missing' || this.code === 'not-local'
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Garantiza que el servidor de modelos sea local (requisito de privacidad R9). */
export function assertLocalHost(host: string): URL {
  let url: URL
  try {
    url = new URL(host)
  } catch (error) {
    throw new OllamaError('not-local', `Dirección inválida: ${host}`, { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OllamaError('not-local', `Protocolo no permitido: ${url.protocol}`)
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new OllamaError('not-local', `OUIJA solo se conecta a servidores locales, no a ${url.hostname}`)
  }
  return url
}

export interface OllamaOptions {
  host?: string
  embedModel?: string
  /** Si se omite, `summarize` devuelve `undefined`. */
  chatModel?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

const EMBED_BATCH = 16

function normalize(v: number[]): Float32Array {
  const out = Float32Array.from(v)
  let norm = 0
  for (const x of out) norm += x * x
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}

export class OllamaClient implements Embedder, Summarizer {
  private readonly base: string
  readonly embedModel: string
  readonly chatModel: string | undefined
  private readonly timeoutMs: number
  private readonly doFetch: typeof fetch

  constructor(options: OllamaOptions = {}) {
    this.base = assertLocalHost(options.host ?? DEFAULT_OLLAMA_HOST).origin
    this.embedModel = options.embedModel ?? DEFAULT_EMBED_MODEL
    this.chatModel = options.chatModel
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.doFetch = options.fetch ?? fetch
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (error) {
      throw new OllamaError('unavailable', 'No se pudo conectar con Ollama. ¿Está en ejecución?', { cause: error })
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      if (res.status === 404 && /not found/i.test(detail)) {
        throw new OllamaError('model-missing', `Falta un modelo en Ollama: ${detail.slice(0, 200)}`)
      }
      throw new OllamaError('bad-response', `Ollama respondió ${res.status}: ${detail.slice(0, 200)}`)
    }
    try {
      return (await res.json()) as T
    } catch (error) {
      throw new OllamaError('bad-response', 'Respuesta de Ollama no válida', { cause: error })
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH)
      const res = await this.post<{ embeddings?: number[][] }>('/api/embed', {
        model: this.embedModel,
        input: batch,
        truncate: true
      })
      if (!res.embeddings || res.embeddings.length !== batch.length) {
        throw new OllamaError('bad-response', 'Ollama devolvió una cantidad inesperada de embeddings')
      }
      for (const e of res.embeddings) out.push(normalize(e))
    }
    return out
  }

  /** Dimensión de los vectores del modelo de embeddings. */
  async probeDimensions(): Promise<number> {
    const [v] = await this.embed(['dimension'])
    return v.length
  }

  /** Pide una respuesta al modelo de chat. Con `schema` fuerza una salida JSON válida para ese esquema. */
  async complete(prompt: string, options: { schema?: object; maxTokens?: number } = {}): Promise<string> {
    if (!this.chatModel) throw new OllamaError('model-missing', 'No hay un modelo de chat configurado')
    const res = await this.post<{ message?: { content?: string } }>('/api/chat', {
      model: this.chatModel,
      stream: false,
      think: false,
      format: options.schema,
      options: { temperature: 0, num_predict: options.maxTokens ?? 300 },
      messages: [{ role: 'user', content: prompt }]
    })
    return res.message?.content?.trim() ?? ''
  }

  async summarize(text: string): Promise<string | undefined> {
    if (!this.chatModel) return undefined
    const summary = await this.complete(
      'Resume en una o dos frases, en el mismo idioma del texto, de qué trata este documento. ' +
        'Usa solo lo que dice el texto. Responde solo con el resumen.\n\n' +
        text.slice(0, 4000),
      { maxTokens: 160 }
    )
    return summary || undefined
  }

  async listModels(): Promise<string[]> {
    let res: Response
    try {
      res = await this.doFetch(`${this.base}/api/tags`, { signal: AbortSignal.timeout(10_000) })
    } catch (error) {
      throw new OllamaError('unavailable', 'No se pudo conectar con Ollama. ¿Está en ejecución?', { cause: error })
    }
    if (!res.ok) throw new OllamaError('bad-response', `Ollama respondió ${res.status}`)
    const json = (await res.json()) as { models?: { name: string }[] }
    return (json.models ?? []).map((m) => m.name)
  }
}

const CHAT_PREFERENCE = ['qwen3.5', 'qwen3', 'llama3.1', 'llama3.2', 'gemma3', 'gemma2', 'mistral', 'phi']
const NOT_CHAT = /embed|bge|nomic|minilm|e5|rerank/i

/** Elige un modelo de chat entre los instalados. Devuelve `undefined` si no hay ninguno adecuado. */
export function pickChatModel(installed: string[]): string | undefined {
  const chat = installed.filter((m) => !NOT_CHAT.test(m))
  for (const prefix of CHAT_PREFERENCE) {
    const found = chat.find((m) => m.toLowerCase().startsWith(prefix))
    if (found) return found
  }
  return chat[0]
}
