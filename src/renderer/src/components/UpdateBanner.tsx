import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { UpdateState } from '@shared/ipc'
import { api } from '../api'
import { useI18n } from '../i18n'
import { GhostIcon } from './ui'

/** Aviso de versión nueva: se ofrece, se descarga con avance y se instala al reiniciar. */
export default function UpdateBanner() {
  const { t } = useI18n()
  const [state, setState] = useState<UpdateState | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    void api.updateState().then(setState).catch(() => undefined)
    return api.onUpdateState(setState)
  }, [])

  const show = state && ['available', 'downloading', 'ready'].includes(state.status) && dismissed !== state.latest
  return (
    <AnimatePresence>
      {show && state && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          role="status"
          data-testid="update-banner"
          className="mx-4 mb-2 flex items-center gap-3 rounded-xl border border-violet-400/40 bg-violet-500/10 px-3 py-2 text-[13px] text-violet-100 shadow-[0_0_24px_rgba(139,92,246,.25)]"
        >
          <GhostIcon className="h-5 w-5 shrink-0 text-violet-300" />
          <span className="min-w-0 flex-1 truncate">
            {state.status === 'ready' ? t.updReady(state.latest ?? '') : state.status === 'downloading' ? t.updDownloading(state.percent ?? 0) : t.updAvailable(state.latest ?? '')}
          </span>
          {state.status === 'downloading' && (
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full bg-violet-400 transition-all" style={{ width: `${state.percent ?? 0}%` }} />
            </span>
          )}
          {state.status === 'available' && (
            <button type="button" onClick={() => void api.updateDownload().then(setState)} className="rounded-md bg-violet-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-400">
              {state.canInstall ? t.updInstall : t.updDownload}
            </button>
          )}
          {state.status === 'ready' && (
            <button type="button" onClick={() => void api.updateInstall()} className="rounded-md bg-violet-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-400">
              {t.updRestart}
            </button>
          )}
          {state.status !== 'downloading' && (
            <button type="button" onClick={() => setDismissed(state.latest ?? '')} className="text-[12px] text-violet-200/70 hover:text-violet-100">
              {t.updLater}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
