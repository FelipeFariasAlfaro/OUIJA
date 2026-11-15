/** Palabras vacías de preguntas en español e inglés: no aportan a la búsqueda léxica. */
const STOPWORDS = new Set(
  (
    'de del la las el los lo un una unos unas y o u a al en con sin por para sobre entre desde hasta que qué quien quién ' +
    'quienes cual cuál cuales cuáles donde dónde cuando cuándo como cómo cuanto cuánto cuantos cuántos es son fue ser ' +
    'está están estaba hay tengo tienes tiene tenemos mi mis tu tus su sus me te se nos le les yo ' +
    'archivo archivos documento documentos carpeta carpetas fichero ' +
    'the of and or to in on at for with from by is are was were be a an my your what where when which who how do does i ' +
    'file files document documents folder'
  ).split(' ')
)

export const isStopword = (token: string): boolean => STOPWORDS.has(token)

/** Quita plural simple para poder buscar por prefijo ("contratos" y "contrato"). */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

/**
 * Convierte una pregunta en una consulta FTS5 segura: palabras con sentido, unidas con OR, y por
 * prefijo si son largas. Devuelve `null` si no queda ninguna palabra útil.
 */
function ftsTerms(text: string): string[] {
  const tokens = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => !STOPWORDS.has(t))
  return [...new Set(tokens)].map((t) => {
    const s = stem(t)
    return s.length >= 4 ? `"${s}"*` : `"${t}"`
  })
}

export function toFtsQuery(text: string): string | null {
  const terms = ftsTerms(text)
  return terms.length === 0 ? null : terms.join(' OR ')
}

/** Todas las palabras a la vez. Sirve para subir los archivos que coinciden con la pregunta completa. */
export function toFtsAllQuery(text: string): string | null {
  const terms = ftsTerms(text)
  return terms.length >= 2 ? terms.join(' AND ') : null
}
