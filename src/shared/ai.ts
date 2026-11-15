/** Modelos de lenguaje que OUIJA puede usar. Los embeddings (búsqueda por significado) son siempre locales. */

export type AiProviderId = 'openai' | 'anthropic' | 'gemini' | 'deepseek'
export const AI_PROVIDER_IDS: readonly AiProviderId[] = ['anthropic', 'openai', 'gemini', 'deepseek']

export interface AiProviderInfo {
  id: AiProviderId
  name: string
  /** Cómo se ve una clave de este proveedor. */
  keyHint: string
  /** Dónde se crea la clave (texto; no se abre ningún enlace). */
  keyWhere: string
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  anthropic: { id: 'anthropic', name: 'Claude', keyHint: 'sk-ant-…', keyWhere: 'console.anthropic.com → API keys' },
  openai: { id: 'openai', name: 'OpenAI', keyHint: 'sk-…', keyWhere: 'platform.openai.com → API keys' },
  gemini: { id: 'gemini', name: 'Gemini', keyHint: 'AIza…', keyWhere: 'aistudio.google.com → Get API key' },
  deepseek: { id: 'deepseek', name: 'DeepSeek', keyHint: 'sk-…', keyWhere: 'platform.deepseek.com → API keys' }
}

export function isAiProvider(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

/** Dónde corre el modelo de lenguaje: en este equipo (Ollama) o en un servicio externo. */
export interface AiSettings {
  mode: 'local' | 'remote'
  provider?: AiProviderId
  model?: string
  /**
   * Con un servicio externo, ¿también se le envía el texto de los documentos para reconocer personas y
   * resumirlos? Si no, eso solo se hace con un modelo local. Por defecto, no.
   */
  remoteDocuments: boolean
}

export const DEFAULT_AI: AiSettings = { mode: 'local', remoteDocuments: false }

export type AiErrorCode = 'invalid-key' | 'forbidden' | 'quota' | 'rate-limit' | 'model-unavailable' | 'network' | 'bad-response' | 'blocked'

export interface AiModel {
  id: string
  name: string
}

/** Estado de la configuración de IA. Nunca incluye la clave. */
export interface AiConfig {
  mode: 'local' | 'remote'
  provider?: AiProviderId
  model?: string
  remoteDocuments: boolean
  /** Hay una clave guardada (o en memoria) para el proveedor elegido. */
  hasKey: boolean
  /** Proveedores con clave disponible. */
  keyedProviders: AiProviderId[]
  /** La clave se guarda cifrada en disco. Si es `false`, solo dura mientras OUIJA esté abierto. */
  secureStorage: boolean
}

export interface AiSaveInput {
  mode: 'local' | 'remote'
  provider?: AiProviderId
  model?: string
  remoteDocuments?: boolean
}

/**
 * Resultado de una operación con el proveedor. Los errores viajan como datos porque Electron pierde
 * la clase y el código de un `Error` al cruzar el puente IPC.
 */
export type AiResult<T> = ({ ok: true } & T) | { ok: false; error: AiErrorCode | 'missing-key' | 'invalid-input'; message: string }

export type AiValidation = AiResult<{ models: AiModel[] }>
export type AiSaved = AiResult<{ config: AiConfig }>
