import { useEffect, useMemo, useState } from 'react'
import { AI_PROVIDER_IDS, AI_PROVIDERS, type AiConfig, type AiErrorCode, type AiModel, type AiProviderId } from '@shared/ai'
import { api } from '../api'
import { ActionButton } from '../components/ui'
import { useI18n, type Dict } from '../i18n'

type Stage = 'mode' | 'provider' | 'key' | 'model'
type Failure = { error: AiErrorCode | 'missing-key' | 'invalid-input'; message: string }

const ERROR_TEXT: Record<Failure['error'], keyof Dict> = {
  'invalid-key': 'aiErr_invalid_key',
  forbidden: 'aiErr_forbidden',
  quota: 'aiErr_quota',
  'rate-limit': 'aiErr_rate_limit',
  'model-unavailable': 'aiErr_model_unavailable',
  network: 'aiErr_network',
  'bad-response': 'aiErr_bad_response',
  blocked: 'aiErr_blocked',
  'missing-key': 'aiErr_missing_key',
  'invalid-input': 'aiErr_invalid_input'
}

function Card({ selected, title, text, badge, onClick }: { selected: boolean; title: string; text: string; badge: string; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onClick} className={`flex flex-col rounded-2xl border p-4 text-left transition-colors ${selected ? 'border-violet-400/60 bg-violet-400/10' : 'border-white/10 hover:bg-white/[0.04]'}`}>
      <span className="flex items-center gap-2">
        <span className="text-base font-semibold text-zinc-100">{title}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-zinc-300">{badge}</span>
      </span>
      <span className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">{text}</span>
    </button>
  )
}

/**
 * Elegir el modelo de lenguaje: local o de un servicio externo. Flujo externo: proveedor → clave →
 * validar → modelos de esa clave → probar y guardar. La clave solo se escribe una vez y no vuelve a verse.
 */
export default function AiWizard({ config, onSaved, onCancel, onLater }: { config: AiConfig; onSaved: (c: AiConfig) => void; onCancel?: () => void; onLater?: () => void }) {
  const { t } = useI18n()
  const [stage, setStage] = useState<Stage>('mode')
  const [mode, setMode] = useState<'local' | 'remote'>(config.mode)
  const [provider, setProvider] = useState<AiProviderId>(config.provider ?? 'anthropic')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<AiModel[]>([])
  const [model, setModel] = useState<string>('')
  const [filter, setFilter] = useState('')
  const [remoteDocuments, setRemoteDocuments] = useState(config.remoteDocuments)
  const [busy, setBusy] = useState<'validating' | 'testing' | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [keyed, setKeyed] = useState<AiProviderId[]>(config.keyedProviders)

  useEffect(() => setKeyed(config.keyedProviders), [config.keyedProviders])

  const info = AI_PROVIDERS[provider]
  const visible = useMemo(() => models.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(filter.toLowerCase())), [models, filter])
  const showError = (f: Failure | null) => setFailure(f)
  const fail = failure && (t[ERROR_TEXT[failure.error]] as string)

  const openModels = (list: AiModel[]) => {
    setModels(list)
    setFilter('')
    setModel(list.find((m) => m.id === config.model && provider === config.provider)?.id ?? list[0]?.id ?? '')
    setStage('model')
  }

  const saveLocal = async () => {
    setBusy('testing')
    const r = await api.aiSave({ mode: 'local' })
    setBusy(null)
    if (r.ok) onSaved(r.config)
    else showError(r)
  }

  const validate = async () => {
    setBusy('validating')
    showError(null)
    const r = await api.aiValidate(provider, key)
    setBusy(null)
    setKey('') // la clave ya está en el proceso principal; aquí no se conserva
    setShowKey(false)
    if (r.ok) openModels(r.models)
    else showError(r)
  }

  const useStored = async () => {
    setBusy('validating')
    showError(null)
    const r = await api.aiListModels(provider)
    setBusy(null)
    if (r.ok) openModels(r.models)
    else {
      showError(r)
      setStage('key')
    }
  }

  const saveRemote = async () => {
    setBusy('testing')
    showError(null)
    const r = await api.aiSave({ mode: 'remote', provider, model, remoteDocuments })
    setBusy(null)
    if (r.ok) onSaved(r.config)
    else showError(r)
  }

  const back = () => {
    showError(null)
    if (stage === 'model') setStage('provider')
    else if (stage === 'key') setStage('provider')
    else if (stage === 'provider') setStage('mode')
    else onCancel?.()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {stage === 'mode' && (
        <>
          <p className="text-[12px] leading-relaxed text-zinc-500">{t.aiSub}</p>
          <div className="mt-3 grid grid-cols-2 gap-3" role="radiogroup" aria-label={t.aiTitle}>
            <Card selected={mode === 'local'} title={t.aiLocalTitle} text={t.aiLocalText} badge={t.aiLocalBadge} onClick={() => setMode('local')} />
            <Card selected={mode === 'remote'} title={t.aiRemoteTitle} text={t.aiRemoteText} badge={t.aiRemoteBadge} onClick={() => setMode('remote')} />
          </div>
        </>
      )}

      {stage === 'provider' && (
        <>
          <h3 className="text-sm font-semibold text-zinc-100">{t.aiProviderTitle}</h3>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5" role="radiogroup" aria-label={t.aiProviderTitle}>
            {AI_PROVIDER_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={provider === id}
                onClick={() => setProvider(id)}
                className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${provider === id ? 'border-violet-400/60 bg-violet-400/10' : 'border-white/10 hover:bg-white/[0.04]'}`}
              >
                <span className="block text-sm font-medium text-zinc-100">{AI_PROVIDERS[id].name}</span>
                <span className="block text-[11px] text-zinc-500">{keyed.includes(id) ? `✓ ${t.aiKeyStored}` : AI_PROVIDERS[id].keyHint}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {stage === 'key' && (
        <>
          <h3 className="text-sm font-semibold text-zinc-100">
            {info.name} · {t.aiKeyTitle}
          </h3>
          <p className="mt-1 text-[11px] text-zinc-500">
            {t.aiKeyWhere}: {info.keyWhere}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && key.trim() && !busy && void validate()}
              placeholder={`${t.aiKeyPlaceholder} (${info.keyHint})`}
              aria-label={t.aiKeyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-400/60"
            />
            <button type="button" onClick={() => setShowKey(!showKey)} className="rounded-lg border border-white/10 px-2.5 py-2 text-[12px] text-zinc-400 hover:text-zinc-200">
              {showKey ? t.aiHideKey : t.aiShowKey}
            </button>
          </div>
          {keyed.includes(provider) && (
            <button type="button" onClick={() => void useStored()} className="mt-2 self-start text-[12px] text-violet-300 hover:text-violet-200">
              {t.aiUseStored}
            </button>
          )}
          <p className="mt-2.5 text-[11px] text-zinc-500">{config.secureStorage ? t.aiSecure : t.aiNoSecure}</p>
        </>
      )}

      {stage === 'model' && (
        <>
          <h3 className="text-sm font-semibold text-zinc-100">
            {info.name} · {t.aiModelTitle}
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">{t.aiModelsFound(models.length)}</p>
          {models.length > 8 && (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.aiModelFilter} aria-label={t.aiModelFilter} className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-violet-400/60" />
          )}
          <ul className="mt-2 max-h-[132px] space-y-1 overflow-y-auto pr-1" role="radiogroup" aria-label={t.aiModelTitle}>
            {visible.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={model === m.id}
                  onClick={() => setModel(m.id)}
                  className={`flex w-full items-baseline gap-2 rounded-lg border px-3 py-1.5 text-left transition-colors ${model === m.id ? 'border-violet-400/60 bg-violet-400/10' : 'border-transparent hover:bg-white/[0.04]'}`}
                >
                  <span className="text-[13px] text-zinc-100">{m.name}</span>
                  {m.name !== m.id && <span className="truncate text-[11px] text-zinc-600">{m.id}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2.5 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
            <p className="text-[11px] font-medium text-zinc-300">{t.aiSentTitle}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{t.aiSentText}</p>
            <label className="mt-2 flex items-start gap-2 text-[11px] text-zinc-300">
              <input type="checkbox" checked={remoteDocuments} onChange={(e) => setRemoteDocuments(e.target.checked)} className="mt-0.5 accent-violet-500" />
              <span>
                {t.aiDocsToggle}
                <span className="block text-zinc-500">{t.aiDocsHelp}</span>
              </span>
            </label>
          </div>
        </>
      )}

      {fail && (
        <p role="alert" className="mt-2.5 rounded-lg bg-rose-500/10 px-3 py-1.5 text-[12px] text-rose-200">
          {fail}
          {failure?.message && failure.error !== 'invalid-input' && failure.error !== 'missing-key' && <span className="mt-0.5 block truncate text-[10px] text-rose-300/60" title={failure.message}>{failure.message}</span>}
        </p>
      )}

      <div className="mt-auto flex items-center gap-2 pt-3">
        {(stage !== 'mode' || onCancel) && (
          <ActionButton onClick={back}>{t.aiBack}</ActionButton>
        )}
        {onLater && stage === 'mode' && (
          <button type="button" onClick={onLater} className="text-[12px] text-zinc-500 hover:text-zinc-300">
            {t.aiLater}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {stage === 'mode' && (
            <ActionButton primary disabled={busy !== null} onClick={() => (mode === 'local' ? void saveLocal() : setStage('provider'))}>
              {busy ? t.aiTesting : mode === 'local' ? t.aiUseLocal : t.continue}
            </ActionButton>
          )}
          {stage === 'provider' && (
            <ActionButton primary disabled={busy !== null} onClick={() => (keyed.includes(provider) ? void useStored() : setStage('key'))}>
              {busy ? t.aiValidating : t.continue}
            </ActionButton>
          )}
          {stage === 'key' && (
            <ActionButton primary disabled={busy !== null || key.trim().length < 8} onClick={() => void validate()}>
              {busy === 'validating' ? t.aiValidating : t.aiValidate}
            </ActionButton>
          )}
          {stage === 'model' && (
            <ActionButton primary disabled={busy !== null || !model} onClick={() => void saveRemote()}>
              {busy === 'testing' ? t.aiTesting : t.aiSave}
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  )
}
