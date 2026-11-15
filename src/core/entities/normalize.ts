/** Minúsculas, sin tildes ni puntuación, con espacios simples. "Sr. Mendoza" -> "sr mendoza". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
