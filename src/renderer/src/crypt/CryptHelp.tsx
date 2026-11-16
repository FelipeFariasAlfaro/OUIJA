import { useEffect, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { GhostIcon } from '../components/ui'
import { useI18n } from '../i18n'

export type StepState = 'done' | 'pending' | 'info'

export interface HelpStatus {
  hasFolder: boolean
  files: number
  indexing: boolean
  souls: number
  portraits: number
  voices: number
  /** Hay un modelo de lenguaje que puede escribir el epitafio y reconocer personas. */
  model: boolean
}

function Step({ n, state, title, text, children }: { n: number; state: StepState; title: string; text: string; children?: ReactNode }) {
  const mark =
    state === 'done' ? (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">✓</span>
    ) : state === 'pending' ? (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-300/50 text-[12px] text-amber-200">{n}</span>
    ) : (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-violet-300/40 text-[12px] text-violet-200">{n}</span>
    )
  return (
    <li className="flex gap-3" data-state={state}>
      {mark}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-zinc-100">{title.replace(/^\d+\.\s*/, "")}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">{text}</p>
        {children && <div className="mt-1.5 flex flex-wrap gap-2">{children}</div>}
      </div>
    </li>
  )
}

const Action = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className="rounded-md border border-violet-400/40 px-2.5 py-1 text-[11px] text-violet-100 transition-colors hover:bg-violet-500/20">
    {children}
  </button>
)

/**
 * Guía de la Cripta: qué hace, paso a paso, con el estado real de cada paso y un botón para resolver
 * lo que falta (abrir una carpeta, indexar, elegir un modelo, exportar).
 */
export default function CryptHelp({
  status,
  onClose,
  onOpenOther,
  onIndex,
  onSettings,
  onExport
}: {
  status: HelpStatus
  onClose: () => void
  onOpenOther: () => void
  onIndex: () => void
  onSettings: () => void
  onExport?: () => void
}) {
  const { t } = useI18n()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const read: StepState = status.files > 0 && !status.indexing ? 'done' : 'pending'
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="crypt-help-title" data-testid="crypt-help">
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.94, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="crypt-hero relative max-h-[88vh] w-[min(620px,94vw)] overflow-y-auto rounded-2xl border border-violet-400/30 p-6"
      >
        <div className="flex items-center gap-3">
          <GhostIcon className="h-9 w-9 text-violet-300 drop-shadow-[0_0_14px_rgba(167,139,250,.6)]" />
          <h2 id="crypt-help-title" className="text-lg font-semibold text-zinc-50">
            {t.cryptHelpTitle}
          </h2>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-zinc-300">{t.cryptHelpIntro}</p>

        <ol className="mt-4 space-y-3.5">
          <Step n={1} state={status.hasFolder ? 'done' : 'pending'} title={t.cryptHelp1Title} text={t.cryptHelp1Text}>
            <Action onClick={onOpenOther}>{t.cryptOther}</Action>
          </Step>
          <Step n={2} state={read} title={t.cryptHelp2Title} text={status.indexing ? t.cryptHelp2Busy : status.files > 0 ? t.cryptHelp2Done(status.files) : t.cryptHelp2Text}>
            {status.hasFolder && !status.indexing && <Action onClick={onIndex}>{t.indexNow}</Action>}
          </Step>
          <Step n={3} state={status.souls > 0 ? 'done' : status.model ? 'pending' : 'pending'} title={t.cryptHelp3Title} text={status.souls > 0 ? t.cryptHelp3Done(status.souls) : status.model ? t.cryptHelp3Wait : t.cryptHelp3NoModel}>
            {!status.model && <Action onClick={onSettings}>{t.cryptHelpModel}</Action>}
          </Step>
          <Step n={4} state="info" title={t.cryptHelp4Title} text={t.cryptHelp4Text(status.portraits, status.voices)} />
          <Step n={5} state={status.model ? 'done' : 'info'} title={t.cryptHelp5Title} text={status.model ? t.cryptHelp5Model : t.cryptHelp5Template}>
            {!status.model && <Action onClick={onSettings}>{t.cryptHelpModel}</Action>}
          </Step>
          <Step n={6} state="info" title={t.cryptHelp6Title} text={t.cryptHelp6Text}>
            {onExport && <Action onClick={onExport}>{t.cryptExport}</Action>}
          </Step>
        </ol>

        <p className="mt-4 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">{t.cryptHelpPrivacy}</p>
        <button type="button" onClick={onClose} className="mt-4 rounded-lg border border-violet-400/40 px-4 py-1.5 text-xs text-violet-100 transition-colors hover:bg-violet-500/20">
          {t.cryptHelpClose}
        </button>
      </motion.div>
    </motion.div>
  )
}
