import { AiError, type ProviderDeps } from './types'

/** Los únicos servidores externos con los que OUIJA habla, y solo con una clave que el usuario puso. */
export const ALLOWED_HOSTS = new Set(['api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.deepseek.com'])
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export class Http {
  private readonly doFetch: typeof fetch
  private readonly timeoutMs: number
  readonly base: string

  constructor(
    defaultBase: string,
    private readonly headers: Record<string, string>,
    private readonly secret: string,
    deps: ProviderDeps = {}
  ) {
    this.doFetch = deps.fetch ?? fetch
    this.timeoutMs = deps.timeoutMs ?? 60_000
    this.base = (deps.baseUrl ?? defaultBase).replace(/\/+$/, '')
    const url = new URL(this.base)
    const local = LOCAL.has(url.hostname)
    const allowed = url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname)
    // `baseUrl` solo se acepta hacia localhost (pruebas). Contra un host remoto, solo los de la lista y con https.
    if (deps.baseUrl ? !local : !allowed) throw new AiError('blocked', `Servidor no permitido: ${url.hostname}`)
  }

  /** Quita la clave de cualquier texto que vaya a mostrarse. */
  redact(text: string): string {
    return this.secret ? text.split(this.secret).join('•••') : text
  }

  async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method,
        headers: { ...this.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (error) {
      throw new AiError('network', 'No se pudo conectar con el servicio. Revisa tu conexión.', undefined, { cause: error })
    }
    const text = await res.text().catch(() => '')
    if (!res.ok) throw this.toError(res.status, text)
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new AiError('bad-response', 'Respuesta del servicio no válida', res.status, { cause: error })
    }
  }

  private toError(status: number, text: string): AiError {
    let message = text.slice(0, 300)
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
      message = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? message
    } catch {
      // se queda el texto crudo
    }
    message = this.redact(message)
    const lower = message.toLowerCase()
    if (status === 401 || /api key not valid|invalid api key|incorrect api key|invalid x-api-key|authentication/.test(lower)) return new AiError('invalid-key', message, status)
    if (status === 402 || /insufficient[_ ]quota|exceeded your current quota|billing|insufficient balance|credit balance/.test(lower)) return new AiError('quota', message, status)
    if (status === 403) return new AiError('forbidden', message, status)
    if (status === 404) return new AiError('model-unavailable', message, status)
    if (status === 429) return new AiError('rate-limit', message, status)
    return new AiError('bad-response', message || `El servicio respondió ${status}`, status)
  }
}

/** Añade el esquema al prompt para los proveedores que solo garantizan "JSON válido", no un esquema. */
export function jsonPrompt(prompt: string, schema?: object): string {
  if (!schema) return prompt
  return `${prompt}\n\nResponde únicamente con un objeto JSON válido que cumpla este esquema, sin texto adicional ni bloques de código:\n${JSON.stringify(schema)}`
}

/** Saca el objeto JSON de una respuesta aunque venga con ```json o texto alrededor. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  return start >= 0 && end > start ? body.slice(start, end + 1) : body
}
