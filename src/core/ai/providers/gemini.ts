import type { AiModel } from '@shared/ai'
import { extractJson, Http, jsonPrompt } from './http'
import { AiError, type CompleteOptions, type ProviderDeps, type RemoteLlm, type RemoteProvider } from './types'

const MAX_PAGES = 5
const NOT_TEXT = /embed|imagen|veo|tts|aqa|image|live|audio|robotics|computer-use|learnlm/i

export function gemini(apiKey: string, deps: ProviderDeps = {}): RemoteProvider {
  const http = new Http('https://generativelanguage.googleapis.com/v1beta', { 'x-goog-api-key': apiKey }, apiKey, deps)

  return {
    async listModels(): Promise<AiModel[]> {
      const out: AiModel[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = (await http.request('GET', `/models?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`)) as {
          models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[]
          nextPageToken?: string
        }
        for (const m of res.models ?? []) {
          const id = m.name.replace(/^models\//, '')
          if (m.supportedGenerationMethods?.includes('generateContent') && !NOT_TEXT.test(id)) out.push({ id, name: m.displayName ?? id })
        }
        if (!res.nextPageToken) break
        token = res.nextPageToken
      }
      return out
    },

    llm(model: string): RemoteLlm {
      if (!/^[\w.-]+$/.test(model)) throw new AiError('model-unavailable', 'Nombre de modelo no válido')
      return {
        async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
          const res = (await http.request('POST', `/models/${model}:generateContent`, {
            contents: [{ role: 'user', parts: [{ text: jsonPrompt(prompt, options.schema) }] }],
            // Los modelos que "piensan" gastan parte del límite en ello: se deja margen.
            generationConfig: { temperature: 0, maxOutputTokens: (options.maxTokens ?? 300) + 2048, ...(options.schema ? { responseMimeType: 'application/json' } : {}) }
          })) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; promptFeedback?: { blockReason?: string } }
          const text = (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
          if (!text) throw new AiError('bad-response', res.promptFeedback?.blockReason ? `El servicio bloqueó la consulta (${res.promptFeedback.blockReason})` : 'El modelo no devolvió texto')
          return options.schema ? extractJson(text) : text
        }
      }
    }
  }
}
