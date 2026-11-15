import { isAiProvider, type AiConfig, type AiModel, type AiProviderId, type AiSaved, type AiSaveInput, type AiSettings, type AiValidation } from '@shared/ai'
import { AiError, createProvider, type ProviderDeps, type RemoteLlm } from '@core/ai/providers'
import type { Settings } from '@shared/ipc'
import type { SecretStore } from './secrets'

const PENDING_MS = 10 * 60_000
const TEST_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }

interface Pending {
  provider: AiProviderId
  key: string
  models: AiModel[]
  at: number
}

const secretId = (p: AiProviderId) => `ai:${p}`
const toFailure = (error: unknown): { ok: false; error: AiError['code']; message: string } =>
  error instanceof AiError ? { ok: false, error: error.code, message: error.message } : { ok: false, error: 'bad-response', message: error instanceof Error ? error.message : String(error) }

/**
 * Configuración del modelo de lenguaje: valida claves, lista modelos, prueba y guarda. La clave
 * entra una sola vez desde la interfaz y se queda aquí; nunca vuelve al renderer.
 */
export class AiService {
  private pending: Pending | null = null

  constructor(
    private readonly secrets: SecretStore,
    private readonly getSettings: () => Settings,
    private readonly updateAi: (ai: AiSettings) => Promise<unknown>,
    private readonly deps: ProviderDeps = {}
  ) {}

  config(): AiConfig {
    const ai = this.getSettings().ai
    const keyed = (['anthropic', 'openai', 'gemini', 'deepseek'] as const).filter((p) => this.secrets.has(secretId(p)))
    return {
      mode: ai.mode,
      provider: ai.provider,
      model: ai.model,
      remoteDocuments: ai.remoteDocuments,
      hasKey: ai.provider !== undefined && this.secrets.has(secretId(ai.provider)),
      keyedProviders: keyed,
      secureStorage: this.secrets.secure
    }
  }

  private live(): Pending | null {
    if (this.pending && Date.now() - this.pending.at > PENDING_MS) this.pending = null
    return this.pending
  }

  /** Comprueba la clave pidiendo la lista de modelos que esa clave puede usar. */
  async validate(provider: AiProviderId, apiKey: string): Promise<AiValidation> {
    const key = apiKey.trim()
    if (!isAiProvider(provider) || key.length < 8 || key.length > 400 || /\s/.test(key)) {
      return { ok: false, error: 'invalid-input', message: 'La clave no tiene un formato válido' }
    }
    try {
      const models = await createProvider(provider, key, this.deps).listModels()
      if (models.length === 0) return { ok: false, error: 'model-unavailable', message: 'La clave es válida pero no tiene modelos disponibles' }
      this.pending = { provider, key, models, at: Date.now() }
      return { ok: true, models }
    } catch (error) {
      this.pending = null
      return toFailure(error)
    }
  }

  /** Modelos disponibles con la clave ya guardada. */
  async listModels(provider: AiProviderId): Promise<AiValidation> {
    const key = this.secrets.get(secretId(provider))
    if (!isAiProvider(provider) || !key) return { ok: false, error: 'missing-key', message: 'No hay una clave guardada para este proveedor' }
    try {
      return { ok: true, models: await createProvider(provider, key, this.deps).listModels() }
    } catch (error) {
      return toFailure(error)
    }
  }

  /** Prueba el modelo con una consulta mínima; solo si responde se guarda todo. */
  async save(input: AiSaveInput): Promise<AiSaved> {
    const current = this.getSettings().ai
    if (input.mode === 'local') {
      await this.updateAi({ ...current, mode: 'local', remoteDocuments: false })
      this.pending = null
      return { ok: true, config: this.config() }
    }

    const { provider, model } = input
    if (!isAiProvider(provider) || typeof model !== 'string' || model.length === 0 || model.length > 120) {
      return { ok: false, error: 'invalid-input', message: 'Falta elegir proveedor y modelo' }
    }
    const pending = this.live()
    const usePending = pending?.provider === provider
    const key = usePending ? pending.key : this.secrets.get(secretId(provider))
    if (!key) return { ok: false, error: 'missing-key', message: 'Falta la clave de este proveedor' }

    try {
      const known = usePending ? pending.models : await createProvider(provider, key, this.deps).listModels()
      if (!known.some((m) => m.id === model)) return { ok: false, error: 'model-unavailable', message: 'Ese modelo no está disponible con esta clave' }
      const reply = await createProvider(provider, key, this.deps).llm(model).complete('Responde con un JSON {"ok": true}.', { schema: TEST_SCHEMA, maxTokens: 30 })
      JSON.parse(reply)
    } catch (error) {
      return error instanceof SyntaxError ? { ok: false, error: 'bad-response', message: 'El modelo no respondió en el formato esperado' } : toFailure(error)
    }

    if (usePending) await this.secrets.set(secretId(provider), key)
    this.pending = null
    await this.updateAi({ mode: 'remote', provider, model, remoteDocuments: input.remoteDocuments ?? current.remoteDocuments })
    return { ok: true, config: this.config() }
  }

  /** Borra la clave. Si era la que se usaba, vuelve al modelo local. */
  async forgetKey(provider: AiProviderId): Promise<AiConfig> {
    if (!isAiProvider(provider)) return this.config()
    await this.secrets.delete(secretId(provider))
    const ai = this.getSettings().ai
    if (ai.provider === provider) await this.updateAi({ mode: 'local', remoteDocuments: false })
    return this.config()
  }

  /** El modelo remoto en uso, o `null` si el modo es local o falta la clave. */
  remote(): { llm: RemoteLlm; provider: AiProviderId; model: string } | null {
    const ai = this.getSettings().ai
    if (ai.mode !== 'remote' || !ai.provider || !ai.model) return null
    const key = this.secrets.get(secretId(ai.provider))
    if (!key) return null
    return { llm: createProvider(ai.provider, key, this.deps).llm(ai.model), provider: ai.provider, model: ai.model }
  }
}
