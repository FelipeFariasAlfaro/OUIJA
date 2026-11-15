import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { DEFAULT_EXCLUDED_DIRS } from '@core/indexing'
import { assertLocalHost, DEFAULT_EMBED_MODEL, DEFAULT_OLLAMA_HOST } from '@core/ai/ollama'
import { DEFAULT_AI, isAiProvider, type AiSettings } from '@shared/ai'
import type { Settings } from '@shared/ipc'

export const DEFAULT_SETTINGS: Settings = {
  folders: [],
  excludeDirs: [...DEFAULT_EXCLUDED_DIRS],
  includeHidden: false,
  staleYears: 3,
  lang: 'es',
  shortcut: 'CommandOrControl+Shift+Space',
  ollamaHost: DEFAULT_OLLAMA_HOST,
  embedModel: DEFAULT_EMBED_MODEL,
  chatModel: '',
  embedDimensions: 1024,
  indexOnStart: true,
  watchFolders: true,
  ocrImages: true,
  onboarded: false,
  ai: { ...DEFAULT_AI }
}

const str = (v: unknown, fallback: string, max = 200): string => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const int = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : fallback

function strings(v: unknown, fallback: string[], max = 500): string[] {
  if (!Array.isArray(v)) return fallback
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 4096).map((x) => x.trim()))].slice(0, max)
}

function sanitizeAi(raw: unknown, base: AiSettings): AiSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const mode = o.mode === 'local' || o.mode === 'remote' ? o.mode : base.mode
  const provider = isAiProvider(o.provider) ? o.provider : undefined
  const model = typeof o.model === 'string' && o.model.length > 0 && o.model.length <= 120 ? o.model : undefined
  // El modo remoto solo vale con proveedor y modelo; si falta algo, se vuelve al local.
  if (mode === 'remote' && provider && model) return { mode, provider, model, remoteDocuments: bool(o.remoteDocuments, base.remoteDocuments) }
  return { mode: 'local', remoteDocuments: false, ...(provider ? { provider } : {}), ...(model ? { model } : {}) }
}

/**
 * Valida y completa la configuración. Lo que no sea válido vuelve a su valor por defecto o al valor
 * anterior: la configuración nunca queda en un estado que rompa la aplicación.
 */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  let ollamaHost = base.ollamaHost
  if (typeof o.ollamaHost === 'string') {
    try {
      ollamaHost = assertLocalHost(o.ollamaHost.trim()).origin // solo servidores locales (R9)
    } catch {
      ollamaHost = base.ollamaHost
    }
  }

  return {
    folders: strings(o.folders, base.folders).filter(isAbsolute).map((f) => resolve(f)),
    excludeDirs: strings(o.excludeDirs, base.excludeDirs),
    includeHidden: bool(o.includeHidden, base.includeHidden),
    staleYears: int(o.staleYears, base.staleYears, 1, 50),
    lang: o.lang === 'es' || o.lang === 'en' ? o.lang : base.lang,
    shortcut: str(o.shortcut, base.shortcut, 60),
    ollamaHost,
    embedModel: str(o.embedModel, base.embedModel, 100),
    chatModel: typeof o.chatModel === 'string' && o.chatModel.length <= 100 ? o.chatModel.trim() : base.chatModel,
    embedDimensions: int(o.embedDimensions, base.embedDimensions, 8, 8192),
    indexOnStart: bool(o.indexOnStart, base.indexOnStart),
    watchFolders: bool(o.watchFolders, base.watchFolders),
    ocrImages: bool(o.ocrImages, base.ocrImages),
    onboarded: bool(o.onboarded, base.onboarded),
    ai: o.ai === undefined ? base.ai : sanitizeAi(o.ai, base.ai)
  }
}

/** Configuración guardada en un archivo JSON, con escritura atómica. */
export class SettingsStore {
  private current: Settings = { ...DEFAULT_SETTINGS }

  constructor(private readonly file: string) {}

  get value(): Settings {
    return { ...this.current, folders: [...this.current.folders], excludeDirs: [...this.current.excludeDirs], ai: { ...this.current.ai } }
  }

  async load(): Promise<Settings> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      this.current = sanitizeSettings(raw)
      // Quien ya tenía carpetas antes de que existiera la bienvenida no debe verla.
      const hadSetup = typeof raw === 'object' && raw !== null && !('onboarded' in raw) && this.current.folders.length > 0
      if (hadSetup) this.current = { ...this.current, onboarded: true }
    } catch {
      this.current = { ...DEFAULT_SETTINGS } // no existe o está dañado
    }
    return this.value
  }

  /** Aplica un cambio parcial validado y lo guarda. */
  async update(patch: Partial<Settings>): Promise<Settings> {
    this.current = sanitizeSettings({ ...this.current, ...patch }, this.current)
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(this.current, null, 2), 'utf8')
    await rename(tmp, this.file)
    return this.value
  }
}
