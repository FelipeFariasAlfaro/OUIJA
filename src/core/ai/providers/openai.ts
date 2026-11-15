import type { AiModel } from '@shared/ai'
import { extractJson, Http, jsonPrompt } from './http'
import { AiError, type CompleteOptions, type ProviderDeps, type RemoteLlm, type RemoteProvider } from './types'

type Flavor = 'openai' | 'deepseek'

const NOT_CHAT = /audio|realtime|transcribe|tts|image|embedding|moderation|whisper|dall-e|davinci|babbage|search|sora|computer-use|codex|omni-moderation/i

/** OpenAI y DeepSeek hablan el mismo protocolo (chat/completions); cambian la dirección y algunos detalles. */
export function openAiCompatible(flavor: Flavor, apiKey: string, deps: ProviderDeps = {}): RemoteProvider {
  const base = flavor === 'openai' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com'
  const http = new Http(base, { authorization: `Bearer ${apiKey}` }, apiKey, deps)

  return {
    async listModels(): Promise<AiModel[]> {
      const res = (await http.request('GET', '/models')) as { data?: { id: string; created?: number }[] }
      let models = res.data ?? []
      if (flavor === 'openai') {
        models = models.filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !NOT_CHAT.test(m.id)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      }
      return models.map((m) => ({ id: m.id, name: m.id }))
    },

    llm(model: string): RemoteLlm {
      return {
        async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
          const limit = options.maxTokens ?? 300
          const reasoner = /reasoner|^o\d|gpt-5/.test(model)
          const body: Record<string, unknown> = {
            model,
            messages: [{ role: 'user', content: flavor === 'deepseek' && options.schema ? jsonPrompt(prompt, options.schema) : prompt }]
          }
          if (flavor === 'openai') {
            // Los modelos nuevos usan max_completion_tokens y gastan parte en razonar: se deja margen. Sin temperature: no la aceptan.
            body['max_completion_tokens'] = limit + 1500
            if (options.schema) body['response_format'] = { type: 'json_schema', json_schema: { name: 'respuesta', schema: options.schema, strict: false } }
          } else {
            body['max_tokens'] = limit + (reasoner ? 1500 : 0)
            if (!reasoner) body['temperature'] = 0
            if (options.schema && !reasoner) body['response_format'] = { type: 'json_object' }
          }

          let res: unknown
          try {
            res = await http.request('POST', '/chat/completions', body)
          } catch (error) {
            // Un modelo que no admite el esquema estricto: se repite con "JSON válido" a secas.
            if (flavor === 'openai' && options.schema && error instanceof AiError && error.status === 400 && /response_format|json_schema/i.test(error.message)) {
              body['response_format'] = { type: 'json_object' }
              body['messages'] = [{ role: 'user', content: jsonPrompt(prompt, options.schema) }]
              res = await http.request('POST', '/chat/completions', body)
            } else throw error
          }
          const content = (res as { choices?: { message?: { content?: string | null } }[] }).choices?.[0]?.message?.content
          if (!content) throw new AiError('bad-response', 'El modelo no devolvió texto')
          return options.schema ? extractJson(content) : content.trim()
        }
      }
    }
  }
}
