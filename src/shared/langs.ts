/** Idiomas de la interfaz. Puro y sin dependencias: lo usan el núcleo, el proceso principal y la interfaz. */
export const LANG_IDS = ['es', 'en', 'pt', 'fr', 'ja', 'zh'] as const
export type Lang = (typeof LANG_IDS)[number]

export const LANG_INFO: Record<Lang, { name: string; locale: string; hint: string; english: string }> = {
  es: { name: 'Español', locale: 'es-CL', hint: 'Continuar en español', english: 'Spanish' },
  en: { name: 'English', locale: 'en-US', hint: 'Continue in English', english: 'English' },
  pt: { name: 'Português', locale: 'pt-BR', hint: 'Continuar em português', english: 'Portuguese' },
  fr: { name: 'Français', locale: 'fr-FR', hint: 'Continuer en français', english: 'French' },
  ja: { name: '日本語', locale: 'ja-JP', hint: '日本語で続ける', english: 'Japanese' },
  zh: { name: '中文', locale: 'zh-CN', hint: '使用中文继续', english: 'Simplified Chinese' }
}

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANG_IDS as readonly string[]).includes(v)

/** El idioma del sistema, si OUIJA lo habla; si no, inglés. */
export function langFromLocale(locale: string): Lang {
  const base = locale.toLowerCase().split(/[-_]/)[0]
  return isLang(base) ? base : 'en'
}
