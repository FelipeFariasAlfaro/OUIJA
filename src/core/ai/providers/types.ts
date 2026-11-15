import type { AiErrorCode, AiModel } from '@shared/ai'

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'AiError'
  }
  /** Fallos que no se arreglan reintentando: la respuesta cae al modo ligero y se avisa al usuario. */
  get fatal(): boolean {
    return this.code === 'invalid-key' || this.code === 'forbidden' || this.code === 'quota' || this.code === 'network' || this.code === 'blocked' || this.code === 'model-unavailable'
  }
}

export interface CompleteOptions {
  schema?: object
  maxTokens?: number
}

/** Lo mismo que `Llm` del orquestador: un modelo de lenguaje que responde un texto (JSON si hay esquema). */
export interface RemoteLlm {
  complete(prompt: string, options?: CompleteOptions): Promise<string>
}

export interface ProviderDeps {
  fetch?: typeof fetch
  /** Solo pruebas: un servidor local que imita al proveedor. Se rechaza cualquier otro host. */
  baseUrl?: string
  timeoutMs?: number
}

export interface RemoteProvider {
  listModels(): Promise<AiModel[]>
  /** Un modelo de lenguaje que usa `model`. */
  llm(model: string): RemoteLlm
}
