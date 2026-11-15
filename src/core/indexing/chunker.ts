export interface ChunkOptions {
  /** Tamaño objetivo en caracteres. */
  size?: number
  /** Solapamiento aproximado entre fragmentos consecutivos. */
  overlap?: number
  /** Máximo de fragmentos por documento. */
  maxChunks?: number
}

const DEFAULTS = { size: 800, overlap: 100, maxChunks: 200 }

/** Busca el mejor punto de corte (párrafo, línea, frase, espacio) cerca de `limit`, sin pasar de él. */
function cutPoint(text: string, start: number, limit: number): number {
  if (limit >= text.length) return text.length
  const window = text.slice(start, limit)
  const floor = Math.floor(window.length * 0.5)
  for (const sep of ['\n\n', '\n', '. ', '; ', ', ', ' ']) {
    const i = window.lastIndexOf(sep)
    if (i >= floor) return start + i + sep.length
  }
  return limit
}

/**
 * Divide el texto en fragmentos de tamaño acotado, cortando en límites naturales y con un poco
 * de solapamiento. Todo el contenido queda cubierto por al menos un fragmento (salvo si se
 * supera `maxChunks`).
 */
export function chunkText(input: string, options: ChunkOptions = {}): string[] {
  // `undefined` significa "usar el valor por defecto" (un spread lo habría pisado).
  const size = options.size ?? DEFAULTS.size
  const overlap = options.overlap ?? DEFAULTS.overlap
  const maxChunks = options.maxChunks ?? DEFAULTS.maxChunks
  if (size <= 0) throw new Error('size debe ser positivo')
  const step = Math.max(1, Math.min(overlap, Math.floor(size / 2)))
  const text = input.trim()
  if (!text) return []

  const chunks: string[] = []
  let start = 0
  while (start < text.length && chunks.length < maxChunks) {
    const end = cutPoint(text, start, Math.min(text.length, start + size))
    const piece = text.slice(start, end).trim()
    if (piece) chunks.push(piece)
    if (end >= text.length) break
    // Retrocede un poco para solapar, pero siempre avanza.
    start = Math.max(end - step, start + 1)
  }
  return chunks
}
