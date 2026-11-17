import { useEffect, useMemo, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ABOUT } from '@shared/about'
import { api } from '../api'
import { useI18n } from '../i18n'
import { GhostIcon } from './ui'

/** Lápida de fondo, en un rincón: piedra agrietada con musgo y un epitafio. */
function Tombstone({ epitaph }: { epitaph: string }) {
  return (
    <svg viewBox="0 0 200 240" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="stone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b3550" />
          <stop offset="1" stopColor="#15121f" />
        </linearGradient>
        <radialGradient id="stone-glow" cx="0.5" cy="0.35" r="0.6">
          <stop offset="0" stopColor="#a78bfa" stopOpacity=".25" />
          <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Tierra removida */}
      <ellipse cx="100" cy="228" rx="96" ry="14" fill="#0b0912" />
      <path d="M22 215 C22 60 50 18 100 18 C150 18 178 60 178 215 Z" fill="url(#stone)" stroke="#5b5275" strokeWidth="2" />
      <path d="M22 215 C22 60 50 18 100 18 C150 18 178 60 178 215 Z" fill="url(#stone-glow)" />
      {/* Grietas */}
      <path d="M140 40 L128 70 L138 92 L124 120" fill="none" stroke="#0b0912" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M48 150 L62 165 L55 185" fill="none" stroke="#0b0912" strokeWidth="2" strokeLinecap="round" />
      {/* Cruz y epitafio */}
      <path d="M100 48 V92 M84 62 H116" stroke="#8b80a8" strokeWidth="6" strokeLinecap="round" />
      <text x="100" y="128" textAnchor="middle" fill="#9d93bd" fontSize="22" fontFamily="Georgia, serif" letterSpacing="4">
        R.I.P.
      </text>
      <text x="100" y="154" textAnchor="middle" fill="#7d7399" fontSize="10.5" fontFamily="Georgia, serif">
        {epitaph}
      </text>
      <text x="100" y="172" textAnchor="middle" fill="#6b6287" fontSize="10" fontFamily="Georgia, serif">
        2004 – 2011
      </text>
      {/* Musgo y hierba */}
      <path d="M22 215 q8 -14 14 0 q6 -18 12 0 q7 -12 12 0 M140 215 q6 -16 12 0 q6 -10 12 0 q6 -14 14 0" fill="none" stroke="#3f5a3a" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function Link({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => void api.openLink(href).catch(() => undefined)}
      className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-left transition-colors hover:border-rose-400/50 hover:bg-rose-500/10"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-violet-200 transition-colors group-hover:text-rose-200">{children}</span>
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</span>
        <span className="block truncate text-[13px] text-zinc-100">{href.replace(/^mailto:/, '').replace(/^https:\/\//, '').replace(/\/$/, '')}</span>
      </span>
    </button>
  )
}

/** "Acerca de": modal siniestro con brasas, niebla, un fantasma que late y una lápida en el rincón. */
export default function AboutModal({ version, onClose }: { version?: string; onClose: () => void }) {
  const { t } = useI18n()
  // Brasas que suben (posiciones y tiempos al azar, fijos durante la vida del modal).
  const embers = useMemo(
    () => Array.from({ length: 22 }, (_, i) => ({ i, left: Math.random() * 100, delay: -Math.random() * 9, duration: 6 + Math.random() * 6, size: 2 + Math.random() * 3 })),
    []
  )

  useEffect(() => {
    // En fase de captura: Esc cierra el modal y no minimiza la ventana.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
      data-testid="about"
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.92, opacity: 0, filter: 'blur(8px)' }}
        animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
        exit={{ scale: 0.95, opacity: 0, filter: 'blur(6px)' }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="about-card relative w-[min(560px,92vw)] overflow-hidden rounded-2xl border border-rose-500/30 bg-[#07050c] p-7"
      >
        {/* Fondo: niebla roja, viñeta, brasas y la lápida */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="about-fog absolute -inset-x-1/3 -bottom-10 h-40" />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 30%, transparent 30%, rgba(0,0,0,.75) 100%)' }} />
          {embers.map((e) => (
            <span
              key={e.i}
              className="about-ember absolute bottom-0 rounded-full"
              style={{ left: `${e.left}%`, width: e.size, height: e.size, animationDelay: `${e.delay}s`, animationDuration: `${e.duration}s` }}
            />
          ))}
          <div className="about-tomb absolute -bottom-3 -right-6 h-56 w-48 opacity-50">
            <Tombstone epitaph={t.aboutEpitaph} />
          </div>
        </div>

        <div className="relative">
          <div className="flex items-center gap-3">
            <motion.span animate={{ scale: [1, 1.08, 1], opacity: [0.85, 1, 0.85] }} transition={{ repeat: Infinity, duration: 2.2 }}>
              <GhostIcon className="h-12 w-12 text-rose-200 drop-shadow-[0_0_18px_rgba(244,63,94,.7)]" />
            </motion.span>
            <div>
              <h2 id="about-title" className="about-title text-2xl font-semibold tracking-[0.25em] text-rose-50">
                OUIJA
              </h2>
              {version && <p className="text-[11px] tracking-wider text-zinc-500">v{version}</p>}
            </div>
          </div>

          <p className="mt-5 max-w-[22rem] font-serif text-[15px] italic leading-relaxed text-zinc-300">{t.aboutQuote}</p>

          <p className="mt-6 text-[13px] text-zinc-400">
            {t.aboutMadeWith} <span className="font-semibold text-violet-200">Kiro AWS</span> {t.aboutBy}
          </p>
          <p className="about-author mt-0.5 text-xl font-semibold text-zinc-50">{ABOUT.author}</p>

          <div className="mt-5 grid max-w-[22rem] gap-2">
            <Link href={ABOUT.repo} label={t.aboutRepo}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.5 9.5 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
              </svg>
            </Link>
            <Link href={ABOUT.linkedin} label="LinkedIn">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4V21H3V9.75Zm6.5 0h3.83v1.54h.06c.53-1 1.84-2.06 3.79-2.06 4.05 0 4.8 2.67 4.8 6.13V21h-4v-5c0-1.2-.02-2.73-1.66-2.73-1.66 0-1.92 1.3-1.92 2.64V21h-4V9.75Z" />
              </svg>
            </Link>
          </div>

          <button type="button" onClick={onClose} autoFocus className="mt-6 rounded-lg border border-rose-400/40 px-4 py-1.5 text-xs text-rose-100 transition-colors hover:bg-rose-500/20">
            {t.aboutClose}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
