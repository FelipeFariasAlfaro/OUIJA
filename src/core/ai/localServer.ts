import { assertLocalHost } from './ollama'
import { extractJson, jsonPrompt } from './providers/http'
import type { Llm } from './orchestrator'

/**
 * Servidores de modelos locales que hablan el protocolo de OpenAI (`/v1/models`, `/v1/chat/completions`):
 * LM Studio, llama.cpp, Jan, vLLM, LocalAI… Solo se aceptan en este equipo (localhost).
 */
export const KNOWN_LOCAL_SERVERS: { name: string; port: number }[] = [
  { name: 'LM Studio', port: 1234 },
  { name: 'llama.cpp / LocalAI', port: 8080 },
  { name: 'Jan', port: 1337 },
  { name: 'vLLM', port: 8000 }
]

export interface LocalServer {
  name: string
  baseUrl: string
  models: string[]
}

export interface LocalServerDeps {
  fetch?: typeof fetch
  /** Puertos a revisar (por defecto, los de los servidores conocidos). */
  servers?: { name: string; port: number }[]
  timeoutMs?: number
}

/** Los modelos de embeddings no responden preguntas. */
const NOT_CHAT = /embed|bge|nomic|minilm|e5-|rerank|whisper|tts/i

/** Normaliza la dirección del servidor (siempre local) y le quita la barra final y el `/v1`. */
export function localServerBase(url: string): string {
  const u = assertLocalHost(url.trim())
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}`
}

/** Busca servidores compatibles con OpenAI en los puertos habituales. No lanza: lo que no responde se omite. */
export async function detectLocalServers(deps: LocalServerDeps = {}): Promise<LocalServer[]> {
  const doFetch = deps.fetch ?? fetch
  const list = deps.servers ?? KNOWN_LOCAL_SERVERS
  const found = await Promise.all(
    list.map(async ({ name, port }) => {
      const baseUrl = `http://127.0.0.1:${port}`
      try {
        const res = await doFetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(deps.timeoutMs ?? 1200) })
        if (!res.ok) return null
        const body = (await res.json()) as { data?: { id?: unknown }[] }
        const models = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string' && !NOT_CHAT.test(id))
        return models.length > 0 ? { name, baseUrl, models } : null
      } catch {
        return null
      }
    })
  )
  return found.filter((s): s is LocalServer => s !== null)
}

/** Modelo de lenguaje servido por un servidor local compatible con OpenAI. */
export function localServerLlm(baseUrl: string, model: string, deps: Pick<LocalServerDeps, 'fetch' | 'timeoutMs'> = {}): Llm {
  const base = localServerBase(baseUrl)
  const doFetch = deps.fetch ?? fetch
  const post = async (body: Record<string, unknown>): Promise<Response> =>
    doFetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 120_000)
    })
  return {
    async complete(prompt, options = {}) {
      const body: Record<string, unknown> = { model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: (options.maxTokens ?? 300) + 600, stream: false }
      if (options.schema) body['response_format'] = { type: 'json_schema', json_schema: { name: 'respuesta', schema: options.schema, strict: false } }
      let res = await post(body)
      // Un servidor que no entiende el esquema: se pide el JSON en el texto.
      if (!res.ok && options.schema && res.status >= 400 && res.status < 500) {
        delete body['response_format']
        body['messages'] = [{ role: 'user', content: jsonPrompt(prompt, options.schema) }]
        res = await post(body)
      }
      if (!res.ok) throw new Error(`El servidor local respondió ${res.status}`)
      const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] }
      // Los modelos que "piensan" en voz alta envuelven el razonamiento en <think>…</think>.
      const content = (data.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      if (!content) throw new Error('El modelo local no devolvió texto')
      return options.schema ? extractJson(content) : content
    }
  }
}
