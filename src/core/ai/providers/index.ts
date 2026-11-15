import type { AiProviderId } from '@shared/ai'
import { anthropic } from './anthropic'
import { gemini } from './gemini'
import { openAiCompatible } from './openai'
import type { ProviderDeps, RemoteProvider } from './types'

export { ALLOWED_HOSTS, extractJson } from './http'
export { AiError, type CompleteOptions, type ProviderDeps, type RemoteLlm, type RemoteProvider } from './types'

export function createProvider(id: AiProviderId, apiKey: string, deps: ProviderDeps = {}): RemoteProvider {
  switch (id) {
    case 'openai':
      return openAiCompatible('openai', apiKey, deps)
    case 'deepseek':
      return openAiCompatible('deepseek', apiKey, deps)
    case 'anthropic':
      return anthropic(apiKey, deps)
    case 'gemini':
      return gemini(apiKey, deps)
  }
}
