import { useEffect, useState, type ReactNode } from 'react'
import type { AppInfo, IndexState, KindCount, LocalModels, OllamaStatus, Settings, UpdateState } from '@shared/ipc'
import { KIND_LABEL } from '@shared/filetypes'
import type { Lang } from '@shared/types'
import { LANG_IDS, LANG_INFO } from '@shared/langs'
import { api } from '../api'
import { AI_PROVIDERS, type AiConfig } from '@shared/ai'
import AiWizard from '../ai/AiWizard'
import { ProviderLogo } from '../ai/ProviderLogo'
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

export default function SettingsView({ settings, index, onSettings, onTour }: { settings: Settings; index: IndexState; onSettings: (s: Settings) => void; onTour?: () => void }) {
  const { lang, t, fmtDate } = useI18n()
  const [kinds, setKinds] = useState<KindCount[]>([])
  const [mcp, setMcp] = useState<string | null>(null)
  const [upd, setUpd] = useState<UpdateState | null>(null)
  const [locals, setLocals] = useState<LocalModels | null>(null)
  const loadLocals = () => void api.localModels().then(setLocals).catch(() => setLocals(null))
  useEffect(loadLocals, [])
  /** Elige el modelo local de respuestas: automático, uno de Ollama o uno de otro servidor local. */
  const chooseLocal = (value: string) => {
    const patch: Partial<Settings> =
      value === 'auto'
        ? { chatModel: '', localServer: null }
        : value.startsWith('ollama:')
          ? { chatModel: value.slice(7), localServer: null }
          : (() => {
              const [i, ...rest] = value.slice(4).split('|')
              const srv = locals?.servers[Number(i)]
              return srv ? { localServer: { baseUrl: srv.baseUrl, model: rest.join('|'), name: srv.name } } : {}
            })()
    void api
      .setSettings(patch)
      .then(onSettings)
      .then(() => api.ollamaStatus().then(setOllama))
  }
  const localValue = settings.localServer
    ? (() => {
        const i = locals?.servers.findIndex((s) => s.baseUrl === settings.localServer?.baseUrl) ?? -1
        return i >= 0 ? `srv:${i}|${settings.localServer.model}` : 'current-server'
      })()
    : settings.chatModel
      ? `ollama:${settings.chatModel}`
      : 'auto'
  useEffect(() => {
    void api.updateState().then(setUpd).catch(() => undefined)
    return api.onUpdateState(setUpd)
  }, [])
  const [copied, setCopied] = useState(false)
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
    void api.fileKinds().then(setKinds).catch(() => setKinds([]))
    void api.mcpConfig().then(setMcp).catch(() => setMcp(null))
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

      <Card title={t.kindsTitle}>
        <p className="mb-2 text-[12px] text-zinc-500">{t.kindsHelp}</p>
        {kinds.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.kindsEmpty}</p>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2" data-testid="kind-list">
              {kinds.map(({ kind, count }) => {
                const included = !settings.excludedKinds.includes(kind)
                return (
                  <li key={kind}>
                    <label className="flex items-center gap-2 text-[13px] text-zinc-300">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => {
                          const next = included ? [...settings.excludedKinds, kind] : settings.excludedKinds.filter((k) => k !== kind)
                          void api.setSettings({ excludedKinds: next }).then(onSettings)
                        }}
                        className="accent-violet-500"
                      />
                      <span className="flex-1">{KIND_LABEL[lang][kind]}</span>
                      <span className="text-[11px] text-zinc-500">{t.kindsCount(count)}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {settings.excludedKinds.length > 0 && (
              <div className="mt-2 flex items-center gap-3 text-[12px] text-amber-200">
                {t.kindsExcluded(settings.excludedKinds.length)}
                <ActionButton onClick={() => void api.setSettings({ excludedKinds: [] }).then(onSettings)}>{t.kindsAll}</ActionButton>
              </div>
            )}
          </>
        )}
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

      <Card title={t.aiCardTitle}>
        {ai && !changingAi && (
          <>
            {(() => {
              const remote = ai.mode === 'remote' && ai.provider && ai.model ? { name: AI_PROVIDERS[ai.provider].name, id: ai.provider, model: ai.model } : null
              const localChat = ollama?.available && ollama.chatModel ? (ollama.chatServer ? `${ollama.chatServer} · ${ollama.chatModel}` : ollama.chatModel) : undefined
              const local = (model: string) => (
                <>
                  <span className="rounded-full bg-emerald-400/10 px-1.5 py-px text-[10px] text-emerald-200">{t.aiWhereLocal}</span>
                  <span className="truncate text-zinc-200">{model}</span>
                </>
              )
              const external = remote && (
                <>
                  <ProviderLogo id={remote.id} className="h-3.5 w-3.5 shrink-0 text-violet-300" />
                  <span className="rounded-full bg-violet-400/15 px-1.5 py-px text-[10px] text-violet-200">{t.aiWhereRemote}</span>
                  <span className="truncate text-zinc-200">
                    {remote.name} · {remote.model}
                  </span>
                </>
              )
              const none = (text: string) => <span className="text-amber-200/90">{text}</span>
              const rows: [string, React.ReactNode][] = [
                [t.aiRoleSearch, ollama?.available && ollama.embedModelInstalled ? local(ollama.embedModel) : none(t.aiRoleSearchMissing)],
                [t.aiRoleAnswers, external || (localChat ? local(localChat) : none(t.aiRoleLight))],
                [t.aiRoleDocs, remote && ai.remoteDocuments ? external : localChat ? local(localChat) : none(t.aiRoleOff)]
              ]
              return (
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13px]" data-testid="ai-roles">
                  {rows.map(([role, who]) => (
                    <div key={role} className="contents">
                      <dt className="text-zinc-500">{role}</dt>
                      <dd className="flex min-w-0 items-center gap-1.5">{who}</dd>
                    </div>
                  ))}
                </dl>
              )
            })()}
            {ai.mode === 'remote' && !ai.hasKey && <p className="mt-2 text-[12px] text-amber-200/90">{t.aiMissingKey}</p>}
            {ai.mode === 'local' && (
              <div className="mt-3" data-testid="local-model">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="local-model" className="text-[13px] text-zinc-500">
                    {t.aiLocalModel}
                  </label>
                  <select
                    id="local-model"
                    value={localValue}
                    onChange={(e) => chooseLocal(e.target.value)}
                    className="max-w-full rounded-md border border-white/10 bg-[#14141f] px-2 py-1 text-xs text-zinc-200"
                  >
                    <option value="auto">{t.aiLocalAuto}</option>
                    {settings.localServer && localValue === 'current-server' && (
                      <option value="current-server">
                        {settings.localServer.name ?? settings.localServer.baseUrl} · {settings.localServer.model}
                      </option>
                    )}
                    {settings.chatModel && !locals?.ollama.includes(settings.chatModel) && !settings.localServer && <option value={`ollama:${settings.chatModel}`}>Ollama · {settings.chatModel}</option>}
                    {(locals?.ollama.length ?? 0) > 0 && (
                      <optgroup label="Ollama">
                        {locals!.ollama.map((m) => (
                          <option key={m} value={`ollama:${m}`}>
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {locals?.servers.map((srv, i) => (
                      <optgroup key={srv.baseUrl} label={`${srv.name} · ${srv.baseUrl.replace(/^https?:\/\//, '')}`}>
                        {srv.models.map((m) => (
                          <option key={m} value={`srv:${i}|${m}`}>
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button type="button" onClick={loadLocals} className="text-[11px] text-violet-300 hover:text-violet-200">
                    {t.aiLocalRescan}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{t.aiLocalHelp}</p>
                {locals && locals.ollama.length === 0 && locals.servers.length === 0 && <p className="mt-1 text-[11px] text-amber-200/90">{t.aiLocalNone}</p>}
              </div>
            )}
            <p className="mt-2.5 text-[11px] text-zinc-500">{ai.mode === 'remote' ? t.aiRemoteNote : t.aiLocalNote}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <ActionButton onClick={() => setChangingAi(true)}>{t.aiChange}</ActionButton>
              {ai.keyedProviders.map((p) => (
                <button key={p} type="button" onClick={() => void api.aiForgetKey(p).then(setAi)} className="text-[11px] text-zinc-500 hover:text-rose-300">
                  {t.aiForgetKey} {AI_PROVIDERS[p].name}
                </button>
              ))}
            </div>
            <div className="mt-3 border-t border-white/5 pt-2.5">
              <div className="flex items-center gap-2 text-[12px] text-zinc-400">
                <span className={`h-1.5 w-1.5 rounded-full ${ollama?.available ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                {ollama?.available ? t.ollamaOk : t.ollamaDown}
              </div>
              {ollama?.hints
                .filter((h) => !(h.code === 'pull-chat' && ai.mode === 'remote'))
                .map((h) => (
                  <div key={h.code} className="mt-1.5 text-[12px] text-amber-200/90">
                    {h.code === 'start-ollama' ? t.hintStart : h.code === 'pull-embed' ? t.hintPullEmbed : t.hintPullChat}
                    {h.command && <code className="ml-1.5 rounded bg-black/40 px-1.5 py-0.5 text-zinc-200">{h.command}</code>}
                  </div>
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
                void api.getSettings().then(onSettings) // la barra superior muestra qué IA responde
              }}
            />
          </div>
        )}
      </Card>
      {mcp && (
        <Card title={t.mcpTitle}>
          <p className="text-[12px] leading-relaxed text-zinc-400">{t.mcpText}</p>
          <pre data-testid="mcp-config" className="mt-2 max-h-40 overflow-auto rounded-lg border border-white/10 bg-black/40 p-2.5 text-[11px] leading-snug text-violet-100 select-text">
            {mcp}
          </pre>
          <div className="mt-2 flex items-center gap-3">
            <ActionButton
              onClick={() =>
                void navigator.clipboard.writeText(mcp).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1800)
                })
              }
            >
              {copied ? `✓ ${t.mcpCopied}` : t.mcpCopy}
            </ActionButton>
            <span className="text-[11px] text-zinc-500">{t.mcpTools}</span>
          </div>
        </Card>
      )}
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
            {LANG_IDS.map((id) => (
              <option key={id} value={id}>
                {LANG_INFO[id].name}
              </option>
            ))}
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
          <input type="checkbox" checked={settings.ambience} onChange={(e) => void api.setSettings({ ambience: e.target.checked }).then(onSettings)} className="mt-0.5 accent-violet-500" />
          <span>
            {t.ambienceToggle}
            <span className="block text-[11px] text-zinc-500">{t.ambienceHelp}</span>
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

      <Card title={t.updTitle}>
        {upd && <p className="text-[13px] text-zinc-300">{t.updVersion(upd.current)}</p>}
        <label className="mt-2 flex items-start gap-2 text-[13px] text-zinc-300">
          <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => void api.setSettings({ autoUpdate: e.target.checked }).then(onSettings)} className="mt-0.5 accent-violet-500" />
          <span>
            {t.updAuto}
            <span className="block text-[11px] text-zinc-500">{t.updAutoHelp}</span>
          </span>
        </label>
        <div className="mt-2.5 flex flex-wrap items-center gap-2" data-testid="update-settings">
          <ActionButton disabled={upd?.status === 'checking' || upd?.status === 'downloading'} onClick={() => void api.updateCheck().then(setUpd)}>
            {upd?.status === 'checking' ? t.updChecking : t.updCheck}
          </ActionButton>
          {upd?.status === 'none' && <span className="text-[12px] text-emerald-300">{t.updNone}</span>}
          {upd?.status === 'error' && (
            <span className="text-[12px] text-amber-200" title={upd.message}>
              {t.updError}
            </span>
          )}
          {upd?.status === 'available' && (
            <>
              <span className="text-[12px] text-violet-200">{t.updAvailable(upd.latest ?? '')}</span>
              <ActionButton primary onClick={() => void api.updateDownload().then(setUpd)}>
                {upd.canInstall ? t.updInstall : t.updDownload}
              </ActionButton>
            </>
          )}
          {upd?.status === 'downloading' && <span className="text-[12px] text-violet-200">{t.updDownloading(upd.percent ?? 0)}</span>}
          {upd?.status === 'ready' && (
            <ActionButton primary onClick={() => void api.updateInstall()}>
              {t.updRestart}
            </ActionButton>
          )}
        </div>
        {upd && !upd.canInstall && <p className="mt-2 text-[11px] text-zinc-500">{t.updManual}</p>}
      </Card>

      <Card title={t.howToOpenTitle}>
        <p className="text-[13px] leading-relaxed text-zinc-400">{t.howToOpen}</p>
        <div className="mt-2.5 flex gap-2">
          {onTour && <ActionButton onClick={onTour}>{t.tourAgain}</ActionButton>}
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
