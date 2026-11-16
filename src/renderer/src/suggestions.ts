import type { Lang } from '@shared/types'

/** Preguntas de ejemplo genéricas. Si ya hay personas reconocidas, se suma una sobre la más frecuente. */
const BASE: Record<Lang, string[]> = {
  es: ['¿Dónde dejé mi último contrato?', '¿Qué documentos escribí el año pasado?'],
  en: ['Where did I leave my latest contract?', 'Which documents did I write last year?'],
  pt: ['Onde deixei meu último contrato?', 'Quais documentos escrevi no ano passado?'],
  fr: ['Où ai-je laissé mon dernier contrat ?', "Quels documents ai-je écrits l'année dernière ?"],
  ja: ['最新の契約書はどこに置いた?', '去年書いた文書は?'],
  zh: ['我最近的合同放在哪里了?', '我去年写了哪些文档?']
}

const ABOUT: Record<Lang, (p: string) => string> = {
  es: (p) => `¿Qué archivos hablan de ${p}?`,
  en: (p) => `Which files talk about ${p}?`,
  pt: (p) => `Quais arquivos falam de ${p}?`,
  fr: (p) => `Quels fichiers parlent de ${p} ?`,
  ja: (p) => `${p}について書かれたファイルは?`,
  zh: (p) => `哪些文件提到了${p}?`
}

export function suggestionsFor(lang: Lang, topPerson?: string): string[] {
  return topPerson ? [...BASE[lang], ABOUT[lang](topPerson)] : BASE[lang]
}
