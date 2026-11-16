import type { ReactNode } from 'react'
import { kindOf, type FileKind } from '@shared/filetypes'
import type { Confidence } from '@shared/types'
import { useI18n } from '../i18n'

export const GHOST_BODY =
  'M50 4C34 4 25 16 23 33L15 30C9 27 5 32 8 38L18 56C19 70 18 80 20 90C26 96 32 90 38 93C44 96 50 90 56 93C62 96 70 91 76 90C86 88 93 86 93 80C90 72 84 62 81 54L90 40C94 34 91 25 86 26C82 27 80 31 79 34C77 17 68 4 50 4Z'
export const GHOST_FACE = [
  'M31 19C37 22 43 25 43 29C40 31 36 31 33 29C30 26 30 22 31 19Z',
  'M66 19C60 22 55 25 54 28C57 31 61 31 64 29C67 26 67 22 66 19Z',
  'M32 35C40 38 58 37 65 34C64 40 62 44 60 46L56 43L52 48L48 43L44 49L40 44L37 47C34 43 32 39 32 35Z'
]

/** El fantasma de OUIJA: solo el contorno, con la cara marcada. Toma el color del texto. */
export function GhostIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" aria-hidden="true">
      <path d={GHOST_BODY} fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
      {GHOST_FACE.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  )
}
const KIND_COLORS: Record<FileKind, string> = {
  document: 'bg-sky-500/15 text-sky-300',
  spreadsheet: 'bg-emerald-500/15 text-emerald-300',
  presentation: 'bg-orange-500/15 text-orange-300',
  text: 'bg-zinc-500/20 text-zinc-300',
  code: 'bg-violet-500/15 text-violet-300',
  data: 'bg-amber-500/15 text-amber-300',
  web: 'bg-cyan-500/15 text-cyan-300',
  ebook: 'bg-indigo-500/15 text-indigo-300',
  email: 'bg-blue-500/15 text-blue-300',
  image: 'bg-fuchsia-500/15 text-fuchsia-300',
  design: 'bg-pink-500/15 text-pink-300',
  audio: 'bg-teal-500/15 text-teal-300',
  video: 'bg-rose-500/15 text-rose-300',
  archive: 'bg-yellow-500/15 text-yellow-300',
  font: 'bg-stone-500/20 text-stone-300',
  executable: 'bg-red-500/15 text-red-300',
  other: 'bg-zinc-500/20 text-zinc-400'
}

/** Ícono con la extensión, de un color según el tipo de archivo. WordPerfect conserva su ámbar de siempre. */
export function FileIcon({ ext }: { ext: string }) {
  const color = ext === 'wpd' ? 'bg-amber-500/15 text-amber-300' : KIND_COLORS[kindOf(ext)]
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold uppercase tracking-wide ${color}`}>
      {(ext || '·').slice(0, 4)}
    </div>
  )
}

const CONF_STYLE: Record<Confidence, { dot: string; key: 'confHigh' | 'confMedium' | 'confLow' }> = {
  high: { dot: 'bg-emerald-400', key: 'confHigh' },
  medium: { dot: 'bg-amber-400', key: 'confMedium' },
  low: { dot: 'bg-rose-400', key: 'confLow' }
}

export function ResurrectedBadge({ confidence }: { confidence?: Confidence }) {
  const { t } = useI18n()
  const conf = confidence ? CONF_STYLE[confidence] : undefined
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200">
      <span aria-hidden="true">✦</span>
      {t.resurrected}
      {conf && (
        <span className="flex items-center gap-1 text-emerald-100/70" title={t[conf.key]}>
          <span className={`h-1.5 w-1.5 rounded-full ${conf.dot}`} />
          {t[conf.key]}
        </span>
      )}
    </span>
  )
}

const STOPWORDS = new Set([
  'para', 'por', 'con', 'que', 'qué', 'una', 'uno', 'los', 'las', 'del', 'donde', 'dónde', 'esta', 'está',
  'tengo', 'tiene', 'the', 'where', 'what', 'which', 'with', 'for', 'and', 'are', 'have'
])

export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = (query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter((w) => !STOPWORDS.has(w))
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (terms.length === 0) return <>{text}</>
  // Solo palabras completas: "rosa" no resalta dentro de "rosales".
  const parts = text.split(new RegExp(`(?<![\\p{L}\\p{N}])(${terms.join('|')})(?![\\p{L}\\p{N}])`, 'giu'))
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-violet-400/25 px-0.5 text-violet-100">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

export function ActionButton({
  children,
  onClick,
  primary,
  disabled
}: {
  children: ReactNode
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? 'bg-violet-500 text-white hover:bg-violet-400'
          : 'bg-white/5 text-zinc-300 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

/** Muestra una ruta acortando el centro para que se vea el inicio y el final. */
export function MiddleEllipsis({ text }: { text: string }) {
  const max = 64
  if (text.length <= max) return <>{text}</>
  const head = Math.ceil(max * 0.4)
  const tail = max - head - 1
  return <>{`${text.slice(0, head)}…${text.slice(-tail)}`}</>
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
