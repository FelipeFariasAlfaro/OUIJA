import { api } from '../api'
import { useI18n } from '../i18n'

/** Minimizar, maximizar y cerrar: la ventana no tiene marco del sistema. */
export default function WindowControls() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
      <button type="button" title={t.minimize} aria-label={t.minimize} onClick={() => api.minimize()} className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-zinc-100">
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
          <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" title={t.maximize} aria-label={t.maximize} onClick={() => api.toggleMaximize()} className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-zinc-100">
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
          <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      <button type="button" title={t.close} aria-label={t.close} onClick={() => api.quit()} className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-rose-500/80 hover:text-white">
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
