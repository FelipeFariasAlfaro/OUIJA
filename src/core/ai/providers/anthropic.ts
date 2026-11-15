import type { AiModel } from '@shared/ai'
import { Http } from './http'
import { AiError, type CompleteOptions, type ProviderDeps, type RemoteLlm, type RemoteProvider } from './types'

const MAX_PAGES = 5

export function anthropic(apiKey: string, deps: ProviderDeps = {}): RemoteProvider {
  const http = new Http('https://api.anthropic.com/v1', { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, apiKey, deps)

  return {
    async listModels(): Promise<AiModel[]> {
      const out: AiModel[] = []
      let after: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = `?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ''}`
        const res = (await http.request('GET', `/models${q}`)) as { data?: { id: string; display_name?: string }[]; has_more?: boolean; last_id?: string }
        for (const m of res.data ?? []) out.push({ id: m.id, name: m.display_name ?? m.id })
        if (!res.has_more || !res.last_id) break
        after = res.last_id
      }
      return out
    },

    llm(model: string): RemoteLlm {
      return {
        async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
          const body: Record<string, unknown> = {
            model,
            max_tokens: (options.maxTokens ?? 300) + 500,
            temperature: 0,
            messages: [{ role: 'user', content: prompt }]
          }
          // Con esquema, se obliga al modelo a "llamar" a una herramienta cuyos argumentos son la respuesta: JSON garantizado.
          if (options.schema) {
            body['tools'] = [{ name: 'responder', description: 'Entrega la respuesta con la estructura pedida.', input_schema: options.schema }]
            body['tool_choice'] = { type: 'tool', name: 'responder' }
          }

          let res: unknown
          try {
            res = await http.request('POST', '/messages', body)
          } catch (error) {
            // Algunos modelos nuevos no admiten fijar la temperatura.
            if (error instanceof AiError && error.status === 400 && /temperature/i.test(error.message)) {
              delete body['temperature']
              res = await http.request('POST', '/messages', body)
            } else throw error
          }
          const content = (res as { content?: { type: string; text?: string; input?: unknown }[] }).content ?? []
          if (options.schema) {
            const tool = content.find((b) => b.type === 'tool_use')
            if (!tool) throw new AiError('bad-response', 'El modelo no devolvió la estructura pedida')
            return JSON.stringify(tool.input)
          }
          const text = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
          if (!text) throw new AiError('bad-response', 'El modelo no devolvió texto')
          return text
        }
      }
    }
  }
}
