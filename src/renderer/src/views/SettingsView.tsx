import { useEffect, useState, type ReactNode } from 'react'
import type { AppInfo, IndexState, OllamaStatus, Settings } from '@shared/ipc'
import type { Lang } from '@shared/types'
import { api } from '../api'
import { AI_PROVIDERS, type AiConfig } from '@shared/ai'
import AiWizard from '../ai/AiWizard'
import { ActionButton } from '../components/ui'
import { useI18n } from '../i18n'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-500">{title}</h3>
      {children}
    </section>
  )
}

export default function SettingsView({ settings, index, onSettings }: { settings: Settings; index: IndexState; onSettings: (s: Settings) => void }) {
  const { t, fmtDate } = useI18n()
  const [ollama, setOllama] = useState<OllamaStatus | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [confirmForget, setConfirmForget] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [ai, setAi] = useState<AiConfig | null>(null)
  const [changingAi, setChangingAi] = useState(false)

  useEffect(() => {
    void api.ollamaStatus().then(setOllama).catch(() => setOllama(null))
    void api.appInfo().then(setInfo).catch(() => setInfo(null))
    void api.aiConfig().then(setAi).catch(() => setAi(null))
  }, [index.phase])

  const phaseText =
    index.phase === 'idle'
      ? t.phaseIdle
      : index.phase === 'scanning'
        ? t.phaseScanning
        : index.phase === 'indexing'
          ? t.phaseIndexing
          : index.phase === 'reading'
            ? t.phaseReading
            : index.phase === 'entities'
              ? t.phaseEntities
              : t.phaseError
  const busy = index.phase === 'scanning' || index.phase === 'indexing' || index.phase === 'reading' || index.phase === 'entities'
  const pct = index.total > 0 ? Math.min(100, Math.round((index.processed / index.total) * 100)) : 0

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
      <Card title={t.settingsFolders}>
        {settings.folders.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.settingsNoFolders}</p>
        ) : (
          <ul className="space-y-1">
            {settings.folders.map((f) => (
              <li key={f} className="flex items-center gap-2 text-[13px] text-zinc-300">
                <span className="min-w-0 flex-1 truncate" title={f}>
                  {f}
                </span>
                <button type="button" onClick={() => void api.removeFolder(f).then(onSettings)} className="text-xs text-zinc-500 hover:text-rose-300">
                  {t.removeFolder}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2.5">
          <ActionButton onClick={() => void api.addFolder().then(onSettings)}>{t.addFolder}</ActionButton>
        </div>
      </Card>

      <Card title={t.settingsIndex}>
        <div className="flex items-center gap-2 text-[13px] text-zinc-300">
          <span className={`h-2 w-2 rounded-full ${index.phase === 'error' ? 'bg-rose-400' : busy ? 'animate-pulse bg-violet-400' : 'bg-emerald-400'}`} />
          {phaseText}
          {busy && index.total > 0 && (
            <span className="text-zinc-500">
              {index.processed}/{index.total}
            </span>
          )}
          {index.phase === 'error' && index.message && <span className="text-rose-300">{index.message === 'ollama' ? t.ollamaDownMessage : index.message}</span>}
        </div>
        {busy && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-violet-400 transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}
        {busy && index.current && <p className="mt-1 truncate text-[11px] text-zinc-600">{index.current}</p>}
        {!busy && index.lastRunAt && (
          <p className="mt-1 text-[11px] text-zinc-600">
            {t.lastRun}: {fmtDate(index.lastRunAt)}
          </p>
        )}
        <div className="mt-2.5 flex gap-2">
          {busy ? <ActionButton onClick={() => void api.cancelIndex()}>{t.cancel}</ActionButton> : <ActionButton primary onClick={() => void api.indexNow()}>{t.indexNow}</ActionButton>}
        </div>
      </Card>

      <Card title={t.aiTitle}>
        {ai && !changingAi && (
          <>
            <p className="text-[13px] text-zinc-200">
              {ai.mode === 'remote' && ai.provider && ai.model ? t.aiSavedRemote(AI_PROVIDERS[ai.provider].name, ai.model) : t.aiSavedLocal}
            </p>
            {ai.mode === 'remote' && !ai.hasKey && <p className="mt-1 text-[12px] text-amber-200/90">{t.aiMissingKey}</p>}
            {ai.mode === 'remote' && ai.remoteDocuments && <p className="mt-1 text-[11px] text-zinc-500">{t.aiDocsToggle}</p>}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <ActionButton onClick={() => setChangingAi(true)}>{t.aiChange}</ActionButton>
              {ai.keyedProviders.map((p) => (
                <button key={p} type="button" onClick={() => void api.aiForgetKey(p).then(setAi)} className="text-[11px] text-zinc-500 hover:text-rose-300">
                  {t.aiForgetKey} {AI_PROVIDERS[p].name}
                </button>
              ))}
            </div>
          </>
        )}
        {ai && changingAi && (
          <div className="flex min-h-[250px] flex-col">
            <AiWizard
              config={ai}
              onCancel={() => setChangingAi(false)}
              onSaved={(c) => {
                setAi(c)
                setChangingAi(false)
              }}
            />
          </div>
        )}
      </Card>

      <Card title={t.settingsModels}>
        <div className="flex items-center gap-2 text-[13px] text-zinc-300">
          <span className={`h-2 w-2 rounded-full ${ollama?.available ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          {ollama?.available ? t.ollamaOk : t.ollamaDown}
        </div>
        {ollama?.available && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-zinc-500">{t.modelEmbed}</dt>
            <dd className="text-zinc-300">{ollama.embedModelInstalled ? ollama.embedModel : t.modelNone}</dd>
            <dt className="text-zinc-500">{t.modelChat}</dt>
            <dd className="text-zinc-300">{ollama.chatModel ?? t.modelNone}</dd>
          </dl>
        )}
        {ollama?.hints.map((h) => (
          <div key={h.code} className="mt-2 text-[12px] text-amber-200/90">
            {h.code === 'start-ollama' ? t.hintStart : h.code === 'pull-embed' ? t.hintPullEmbed : t.hintPullChat}
            {h.command && <code className="ml-1.5 rounded bg-black/40 px-1.5 py-0.5 text-zinc-200">{h.command}</code>}
          </div>
        ))}
      </Card>

      <Card title={t.settingsGeneral}>
        <div className="flex items-center gap-3 text-[13px] text-zinc-300">
          <label htmlFor="lang" className="text-zinc-500">
            {t.language}
          </label>
          <select
            id="lang"
            value={settings.lang}
            onChange={(e) => void api.setSettings({ lang: e.target.value as Lang }).then(onSettings)}
            className="rounded-md border border-white/10 bg-[#14141f] px-2 py-1 text-xs text-zinc-200"
          >
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>
        <label className="mt-3 flex items-start gap-2 text-[13px] text-zinc-300">
          <input type="checkbox" checked={settings.ocrImages} onChange={(e) => void api.setSettings({ ocrImages: e.target.checked }).then(onSettings)} className="mt-0.5 accent-violet-500" />
          <span>
            {t.ocrImages}
            <span className="block text-[11px] text-zinc-500">{t.ocrHelp}</span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-2 text-[13px] text-zinc-300">
          <input type="checkbox" checked={settings.watchFolders} onChange={(e) => void api.setSettings({ watchFolders: e.target.checked }).then(onSettings)} className="mt-0.5 accent-violet-500" />
          <span>
            {t.watchToggle}
            <span className="block text-[11px] text-zinc-500">{t.watchHelp}</span>
          </span>
        </label>
        {info && (
          <p className="mt-2 text-[12px] text-zinc-400">
            {t.shortcut}: <kbd className="rounded bg-white/5 px-1">{info.shortcut.accelerator}</kbd> —{' '}
            <span className={info.shortcut.status === 'registered' ? 'text-emerald-300' : 'text-amber-200'}>{info.shortcut.status === 'registered' ? t.shortcutOk : t.shortcutNo}</span>
          </p>
        )}
        {info && /gnome/i.test(info.desktop) && <p className="mt-1 text-[12px] text-zinc-500">{t.trayGnome}</p>}
      </Card>

      <Card title={t.howToOpenTitle}>
        <p className="text-[13px] leading-relaxed text-zinc-400">{t.howToOpen}</p>
        <div className="mt-2.5">
          <ActionButton onClick={() => api.quit()}>{t.quit}</ActionButton>
        </div>
      </Card>

      <Card title={t.settingsPrivacy}>
        <p className="text-[13px] text-zinc-400">{t.privacyText}</p>
        <div className="mt-2.5">
          {confirmForget ? (
            <div className="space-y-2">
              <p className="text-[12px] text-amber-200/90">{t.forgetConfirm}</p>
              <div className="flex gap-2">
                <ActionButton
                  primary
                  onClick={() =>
                    void api.forgetAll().then(() => {
                      setConfirmForget(false)
                      setForgot(true)
                    })
                  }
                >
                  {t.forgetAll}
                </ActionButton>
                <ActionButton onClick={() => setConfirmForget(false)}>{t.cancel}</ActionButton>
              </div>
            </div>
          ) : (
            <ActionButton
              onClick={() => {
                setForgot(false)
                setConfirmForget(true)
              }}
            >
              {t.forgetAll}
            </ActionButton>
          )}
          {forgot && <p className="mt-2 text-[12px] text-emerald-300">{t.forgetDone}</p>}
        </div>
      </Card>
    </div>
  )
}
