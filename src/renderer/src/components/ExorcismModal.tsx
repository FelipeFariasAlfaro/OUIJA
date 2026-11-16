import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api'
import { useI18n } from '../i18n'
import { GhostIcon } from './ui'

/** Confirmación del exorcismo: borra todos los datos de OUIJA y la reabre desde la bienvenida. */
export default function ExorcismModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [keepEngine, setKeepEngine] = useState(true)
  const [working, setWorking] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || working) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, working])

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !working && onClose()} role="alertdialog" aria-modal="true" aria-labelledby="exorcism-title" data-testid="exorcism">
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="about-card relative w-[min(520px,92vw)] overflow-hidden rounded-2xl border border-rose-500/40 bg-[#07050c] p-6"
      >
        <div aria-hidden="true" className="about-fog pointer-events-none absolute -inset-x-1/3 -bottom-10 h-36" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <motion.span animate={working ? { rotate: [0, -8, 8, 0], opacity: [1, 0.4, 1] } : { y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: working ? 0.6 : 2.4 }}>
              <GhostIcon className="h-10 w-10 text-rose-200 drop-shadow-[0_0_16px_rgba(244,63,94,.7)]" />
            </motion.span>
            <h2 id="exorcism-title" className="about-title text-xl font-semibold tracking-wide text-rose-50">
              {t.exorcismModalTitle}
            </h2>
          </div>
          <p className="mt-4 text-[13px] text-zinc-300">{t.exorcismModalText}</p>
          <ul className="mt-2 space-y-1">
            {t.exorcismItems.split('\n').map((line) => (
              <li key={line} className="flex gap-2 text-[13px] text-zinc-300">
                <span className="text-rose-400">✝</span>
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-emerald-300/90">{t.exorcismSafe}</p>
          <label className="mt-3 flex items-start gap-2 text-[12px] text-zinc-300">
            <input type="checkbox" checked={keepEngine} onChange={(e) => setKeepEngine(e.target.checked)} className="mt-0.5 accent-violet-500" />
            {t.exorcismKeep}
          </label>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => {
                setWorking(true)
                void api.exorcise(keepEngine).catch(() => setWorking(false))
              }}
              className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-medium text-white shadow-[0_0_18px_rgba(244,63,94,.5)] transition-colors hover:bg-rose-500 disabled:opacity-60"
            >
              {working ? t.exorcismWorking : t.exorcismConfirm}
            </button>
            {!working && (
              <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-4 py-1.5 text-xs text-zinc-300 hover:bg-white/10">
                {t.cancel}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
