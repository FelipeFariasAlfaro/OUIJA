import type { Lang } from '@shared/types'

/** Preguntas de ejemplo genéricas. Si ya hay personas reconocidas, se suma una sobre la más frecuente. */
const BASE: Record<Lang, string[]> = {
  es: ['¿Dónde dejé mi último contrato?', '¿Qué documentos escribí el año pasado?'],
  en: ['Where did I leave my latest contract?', 'Which documents did I write last year?']
}

export function suggestionsFor(lang: Lang, topPerson?: string): string[] {
  const about = lang === 'es' ? `¿Qué archivos hablan de ${topPerson}?` : `Which files talk about ${topPerson}?`
  return topPerson ? [...BASE[lang], about] : BASE[lang]
}
