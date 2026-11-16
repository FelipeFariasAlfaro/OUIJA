import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useI18n, type Dict } from '../i18n'
import { GhostIcon } from './ui'

/** Un paso del recorrido: qué elemento señala (`data-tour`) y qué textos usa. */
export interface TourStep {
  target: string
  title: keyof Dict
  text: keyof Dict
  /** Si el elemento no está en pantalla (por ejemplo, el contador cuando no se indexa), se omite. */
  optional?: boolean
}

export const TOUR_STEPS: TourStep[] = [
  { target: 'progress', title: 'tourProgressTitle', text: 'tourProgressText', optional: true },
  { target: 'search', title: 'tourSearchTitle', text: 'tourSearchText' },
  { target: 'tab-ghosts', title: 'tourGhostsTitle', text: 'tourGhostsText' },
  { target: 'tab-people', title: 'tourPeopleTitle', text: 'tourPeopleText' },
  { target: 'tab-crypt', title: 'tourCryptTitle', text: 'tourCryptText' },
  { target: 'tab-gallows', title: 'tourGallowsTitle', text: 'tourGallowsText' },
  { target: 'tab-settings', title: 'tourSettingsTitle', text: 'tourSettingsText' },
  { target: 'local', title: 'tourLocalTitle', text: 'tourLocalText' }
]

const CARD_W = 300
const GAP = 12
const PAD = 6

const find = (target: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-tour="${target}"]`)

/**
 * Recorrido guiado: oscurece la ventana, ilumina un elemento y muestra junto a él una tarjeta que lo
 * explica. Se avanza con Enter o →, se vuelve con ←, y Esc lo salta.
 */
export default function Tour({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  // Solo los pasos cuyo elemento existe al empezar (el contador solo aparece mientras se indexa).
  const [steps] = useState(() => TOUR_STEPS.filter((s) => !s.optional || find(s.target)))
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = steps[i]

  const measure = useCallback(() => setRect(step ? (find(step.target)?.getBoundingClientRect() ?? null) : null), [step])
  useLayoutEffect(measure, [measure])
  useEffect(() => {
    window.addEventListener('resize', measure)
    const timer = setInterval(measure, 500) // el contador cambia de ancho mientras avanza
    return () => {
      window.removeEventListener('resize', measure)
      clearInterval(timer)
    }
  }, [measure])

  // La tarjeta que se va (animación de salida) conserva sus botones: leer el paso actual de una
  // referencia evita que un clic sobre ella repita o salte pasos.
  const current = useRef(0)
  current.current = i
  const next = useCallback(() => {
    if (current.current + 1 >= steps.length) onDone()
    else setI(current.current + 1)
  }, [steps.length, onDone])
  const prev = useCallback(() => setI(Math.max(0, current.current - 1)), [])

  // Si el contador desaparece (terminó de leer) mientras se lo explica, se pasa al siguiente paso.
  useEffect(() => {
    if (step?.optional && !find(step.target)) next()
  }, [rect, step, next])

  useEffect(() => {
    // En fase de captura: así Esc no minimiza la ventana mientras el recorrido está abierto.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone()
      else if (e.key === 'Enter' || e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [next, prev, onDone])

  if (!step) return null

  // La tarjeta va debajo del elemento (o encima si no cabe), sin salirse de la ventana.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const below = !rect || rect.bottom + GAP + 190 < vh
  const left = rect ? Math.min(Math.max(12, rect.left + rect.width / 2 - CARD_W / 2), vw - CARD_W - 12) : (vw - CARD_W) / 2
  const top = rect ? (below ? rect.bottom + GAP : undefined) : vh / 2 - 90
  const bottom = rect && !below ? vh - rect.top + GAP : undefined
  const arrowLeft = rect ? Math.min(Math.max(18, rect.left + rect.width / 2 - left), CARD_W - 18) : CARD_W / 2

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="tour-title" data-testid="tour">
      {/* Bloquea los clics a la app mientras dura el recorrido. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
      {rect ? (
        <motion.div
          className="pointer-events-none absolute rounded-xl"
          initial={false}
          animate={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          style={{ boxShadow: '0 0 0 9999px rgba(4,3,10,.78), 0 0 0 1.5px rgba(196,181,253,.8), 0 0 28px 6px rgba(139,92,246,.55)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(4,3,10,.78)]" />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={{ opacity: 0, y: below ? 8 : -8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, filter: 'blur(4px)' }}
          transition={{ duration: 0.22 }}
          className="absolute rounded-2xl border border-violet-400/40 bg-[#0e0b1a]/95 p-4 shadow-[0_0_40px_rgba(139,92,246,.35)] backdrop-blur"
          style={{ left, top, bottom, width: CARD_W }}
        >
          {rect && (
            <span
              className={`absolute h-3 w-3 rotate-45 border-violet-400/40 bg-[#0e0b1a] ${below ? '-top-1.5 border-l border-t' : '-bottom-1.5 border-b border-r'}`}
              style={{ left: arrowLeft - 6 }}
            />
          )}
          <div className="flex items-center gap-2">
            <motion.span animate={{ y: [0, -3, 0], opacity: [0.8, 1, 0.8] }} transition={{ repeat: Infinity, duration: 2.4 }}>
              <GhostIcon className="h-6 w-6 text-violet-300 drop-shadow-[0_0_10px_rgba(167,139,250,.7)]" />
            </motion.span>
            <h3 id="tour-title" className="text-sm font-semibold text-violet-100">
              {t[step.title] as string}
            </h3>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-300">{t[step.text] as string}</p>
          <div className="mt-3.5 flex items-center gap-2">
            <span className="text-[11px] text-zinc-500">{t.tourStep(i + 1, steps.length)}</span>
            <button type="button" onClick={onDone} className="ml-auto text-[12px] text-zinc-500 hover:text-zinc-300">
              {t.tourSkip}
            </button>
            {i > 0 && (
              <button type="button" onClick={prev} className="rounded-md bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10">
                {t.back}
              </button>
            )}
            <button type="button" onClick={next} autoFocus className="rounded-md bg-violet-500 px-3 py-1 text-xs font-medium text-white hover:bg-violet-400">
              {i + 1 >= steps.length ? t.tourDone : t.next}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
