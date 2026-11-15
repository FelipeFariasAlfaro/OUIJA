import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { FolderSuggestion, Settings, SetupState, SetupStep as Step } from '@shared/ipc'
import { api } from '../api'
import { ActionButton } from '../components/ui'
import { useI18n, type Dict } from '../i18n'

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`
const mb = (bytes: number) => (bytes >= 1e9 ? gb(bytes) : `${Math.round(bytes / 1e6)} MB`)

const ERRORS: Record<string, keyof Dict> = {
  offline: 'errOffline',
  'no-space': 'errNoSpace',
  checksum: 'errChecksum',
  unsupported: 'errUnsupported',
  start: 'errStart',
  blocked: 'errBlocked'
}
const DETAILS: Record<string, keyof Dict> = {
  checking: 'detailChecking',
  downloading: 'detailDownloading',
  verifying: 'detailVerifying',
  extracting: 'detailExtracting',
  starting: 'detailStarting',
  pulling: 'detailPulling'
}
const LABELS = { runtime: 'stepRuntime', embed: 'stepEmbed', chat: 'stepChat' } as const

function Status({ step }: { step: Step }) {
  if (step.status === 'done') return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">✓</span>
  if (step.status === 'skipped') return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-zinc-400">–</span>
  if (step.status === 'error') return <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-400/20 text-rose-300">!</span>
  if (step.status === 'running') return <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-300" />
  return <span className="h-5 w-5 rounded-full border border-white/15" />
}

function Row({ step }: { step: Step }) {
  const { t } = useI18n()
  const pct = step.total > 0 ? Math.min(100, Math.round((step.completed / step.total) * 100)) : 0
  const showBar = step.status === 'running' && step.total > 0 && (step.detail === 'downloading' || step.detail === 'pulling')
  let text = ''
  if (step.status === 'done') text = t.stepDone
  else if (step.status === 'pending') text = `${t.stepWaiting} · ${gb(step.sizeBytes)}`
  else if (step.status === 'skipped') text = step.note === 'remote' ? t.stepSkippedRemote : t.stepSkippedMemory
  else if (step.status === 'running') text = step.detail ? `${t[DETAILS[step.detail]] as string}${showBar ? ` ${pct}%` : ''}` : ''
  else if (step.status === 'error') text = step.errorMessage === 'cancelled' ? t.cancelled : (t[ERRORS[step.error ?? ''] ?? 'errGeneric'] as string)

  return (
    <li className="flex items-start gap-3">
      <div className="pt-0.5">
        <Status step={step} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-zinc-100">{t[LABELS[step.id]] as string}</span>
          {step.note && step.status !== 'skipped' && step.id !== 'runtime' && <span className="truncate text-[11px] text-zinc-500">{step.note}</span>}
        </div>
        <p className={`text-[12px] ${step.status === 'error' ? 'text-rose-300' : 'text-zinc-500'}`}>{text}</p>
        {showBar && (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <motion.div className="h-full rounded-full bg-violet-400" animate={{ width: `${pct}%` }} transition={{ duration: 0.3 }} />
          </div>
        )}
        {showBar && step.total > 0 && (
          <p className="mt-0.5 text-[10px] text-zinc-600">
            {mb(step.completed)} / {mb(step.total)}
          </p>
        )}
      </div>
    </li>
  )
}

/** Última pantalla de la bienvenida: instala lo necesario y deja elegir carpetas. */
export default function SetupStep({ settings, onFinish }: { settings: Settings; onFinish: (s: Settings) => void }) {
  const { t } = useI18n()
  const [state, setState] = useState<SetupState | null>(null)
  const [folders, setFolders] = useState<FolderSuggestion[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set(settings.folders))
  const [finishing, setFinishing] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const started = useRef(false)

  const start = useCallback(() => void api.setupStart().then(setState).catch(() => undefined), [])

  useEffect(() => {
    const off = api.onSetupState(setState)
    void api.setupState().then((s) => {
      setState(s)
      if (!s.complete && !started.current) {
        started.current = true
        start() // sin intervención: empieza apenas se llega a este paso
      }
    })
    void api.suggestFolders().then(setFolders)
    return () => {
      off()
    }
  }, [start])

  const toggle = async (path: string) => {
    const on = chosen.has(path)
    const next = new Set(chosen)
    if (on) next.delete(path)
    else next.add(path)
    setChosen(next)
    await (on ? api.removeFolder(path) : api.addSuggestedFolder(path)).catch(() => setChosen(chosen))
  }

  const pickOther = async () => {
    const after = await api.addFolder()
    setChosen(new Set(after.folders))
  }

  const finish = async () => {
    setFinishing(true)
    onFinish(await api.finishOnboarding())
  }

  const steps = state?.steps ?? []
  const failed = steps.some((s) => s.status === 'error')
  const running = state?.running === true
  const ready = state?.ready === true
  const missing = (state?.tools ?? []).filter((x) => !x.found)
  const toolLabel = { libreoffice: t.toolLibreoffice, tesseract: t.toolTesseract, poppler: t.toolPoppler, '7zip': t.toolSevenZip }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr] gap-6 px-8 pb-4 pt-3">
      <section className="flex min-h-0 flex-col">
        <h2 className="text-lg font-semibold text-zinc-100">{t.setupTitle}</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{t.setupSub}</p>
        <ul className="mt-4 space-y-3.5">{steps.map((s) => <Row key={s.id} step={s} />)}</ul>
        {failed && !running && (
          <div className="mt-3">
            <ActionButton primary onClick={start}>
              {t.retry}
            </ActionButton>
          </div>
        )}

        {missing.length > 0 && (
          <div className="mt-auto pt-3">
            <button type="button" onClick={() => setShowTools(!showTools)} className="text-[12px] text-zinc-400 hover:text-zinc-200">
              {showTools ? '▾' : '▸'} {t.optionalTools}
            </button>
            {showTools && (
              <div className="mt-1.5 space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <p className="text-[11px] text-zinc-500">{t.optionalToolsText}</p>
                {missing.map((x) => (
                  <div key={x.id} className="text-[11px]">
                    <span className="text-zinc-300">{toolLabel[x.id]}</span>
                    <code className="mt-0.5 block truncate rounded bg-black/40 px-1.5 py-0.5 text-zinc-400" title={x.hint}>
                      {x.hint}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="flex min-h-0 flex-col">
        <h2 className="text-lg font-semibold text-zinc-100">{t.foldersTitle}</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{t.foldersSub}</p>
        <ul className="mt-4 space-y-2 overflow-y-auto">
          {folders.length === 0 && <li className="text-[13px] text-zinc-500">{t.foldersNone}</li>}
          {folders.map((f) => {
            const on = chosen.has(f.path)
            return (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => void toggle(f.path)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? 'border-violet-400/50 bg-violet-400/10' : 'border-white/10 hover:bg-white/[0.04]'}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-md border text-[12px] ${on ? 'border-violet-400 bg-violet-400 text-[#0d0d16]' : 'border-white/20'}`}>{on ? '✓' : ''}</span>
                  <span className="min-w-0">
                    <span className="block text-sm text-zinc-100">{f.name}</span>
                    <span className="block truncate text-[11px] text-zinc-500" title={f.path}>
                      {f.path}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="mt-2">
          <ActionButton onClick={() => void pickOther()}>{t.otherFolder}</ActionButton>
        </div>

        <div className="mt-auto flex flex-col items-end gap-2 pt-3">
          {!ready && running && <p className="text-[11px] text-zinc-500">{t.waitingModels}</p>}
          <div className="flex items-center gap-3">
            {!ready && (
              <button type="button" disabled={finishing} onClick={() => void finish()} className="text-[12px] text-zinc-500 hover:text-zinc-300">
                {t.startLater}
              </button>
            )}
            <button
              type="button"
              disabled={!ready || finishing}
              onClick={() => void finish()}
              className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors enabled:hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t.start}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
