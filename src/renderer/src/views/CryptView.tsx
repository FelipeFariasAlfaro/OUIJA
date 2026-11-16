import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { CryptFile, CryptReport } from '@shared/ipc'
import { LANG_INFO } from '@shared/langs'
import { api } from '../api'
import { grimoireHtml } from '../crypt/grimoire'
import CryptHelp from '../crypt/CryptHelp'
import { AnimatePresence } from 'framer-motion'
import { ActionButton, FileIcon, GhostIcon, MiddleEllipsis, ResurrectedBadge } from '../components/ui'
import { useI18n } from '../i18n'

const messageOf = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
const year = (ms?: number) => (ms ? new Date(ms).getUTCFullYear() : undefined)

/** Pequeña lápida para la lista de criptas. */
function Headstone({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 28" className={`h-8 w-7 shrink-0 ${active ? 'text-violet-300' : 'text-zinc-600'}`} aria-hidden="true">
      <path d="M3 26V11C3 5.5 7 2 12 2s9 3.5 9 9v15Z" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 7v8M9 10h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M1 26h22" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function FileRow({ f, extra }: { f: CryptFile; extra?: string }) {
  const { t, fmtDate } = useI18n()
  return (
    <li className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
      <FileIcon ext={f.ext} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <button type="button" onClick={() => void api.openFile(f.path).catch(() => undefined)} className="truncate text-left text-[13px] font-medium text-zinc-100 hover:text-violet-200">
            {f.name}
          </button>
          <span className="text-[11px] text-violet-300/80">{fmtDate(f.date)}</span>
          {extra && <span className="text-[11px] text-zinc-500">· {extra}</span>}
          {f.resurrected && <ResurrectedBadge />}
        </div>
        {f.summary && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-zinc-400">{f.summary}</p>}
        {f.container && (
          <p className="truncate text-[11px] text-zinc-600">
            {t.insideOf} {f.container.split(/[\\/]/).pop()}
          </p>
        )}
      </div>
      <button type="button" onClick={() => void api.showInFolder(f.path).catch(() => undefined)} className="shrink-0 text-[11px] text-zinc-500 opacity-0 transition-opacity hover:text-zinc-200 group-hover:opacity-100">
        {f.container ? t.showContainer : t.showFolder}
      </button>
    </li>
  )
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.025] p-3.5" data-testid={testId}>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-violet-300/80">✝ {title}</h3>
      {children}
    </section>
  )
}

/**
 * La Cripta: la herencia digital de una carpeta (el PC de alguien, un disco viejo, los respaldos de la
 * familia), ordenada como un grimorio de memorias que se puede exportar.
 */
export default function CryptView({ refreshKey, indexing, onSettings }: { refreshKey: string | number; indexing: boolean; onSettings: () => void }) {
  const { lang, t, fmtDate } = useI18n()
  const [folders, setFolders] = useState<string[]>([])
  const [folder, setFolder] = useState<string | null>(null)
  const [report, setReport] = useState<CryptReport | null>(null)
  const [portraits, setPortraits] = useState<(string | null)[]>([])
  const [epitaph, setEpitaph] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const [model, setModel] = useState(false)
  useEffect(() => {
    // ¿Hay un modelo que pueda reconocer personas y escribir el epitafio?
    void Promise.all([api.aiConfig(), api.ollamaStatus()])
      .then(([ai, o]) => setModel((ai.mode === 'remote' && ai.hasKey && ai.remoteDocuments) || Boolean(o.available && o.chatModel)))
      .catch(() => setModel(false))
  }, [refreshKey])

  const loadFolders = useCallback(async (select?: string) => {
    const list = await api.cryptFolders()
    setFolders(list)
    setFolder((cur) => select ?? (cur && list.includes(cur) ? cur : (list[0] ?? null)))
  }, [])
  useEffect(() => {
    void loadFolders().catch(() => setFolders([]))
  }, [loadFolders])

  // Al elegir otra cripta (o cuando avanza la indexación), se vuelve a leer.
  useEffect(() => {
    if (!folder) {
      setReport(null)
      return
    }
    let alive = true
    void api
      .cryptReport(folder)
      .then((r) => {
        if (!alive) return
        setReport(r)
        void api.cryptPortraits(folder).then((p) => alive && setPortraits(p)).catch(() => undefined)
      })
      .catch((e) => alive && setNotice(messageOf(e)))
    return () => {
      alive = false
    }
  }, [folder, refreshKey])

  // El epitafio lo escribe el modelo (si hay uno); mientras tanto, o sin modelo, uno hecho con los datos.
  useEffect(() => {
    setEpitaph(null)
    if (!folder) return
    let alive = true
    setWriting(true)
    void api
      .cryptEpitaph(folder)
      .then((text) => alive && setEpitaph(text))
      .catch(() => undefined)
      .finally(() => alive && setWriting(false))
    return () => {
      alive = false
    }
  }, [folder, lang])

  const fallbackEpitaph = report
    ? t.cryptEpitaphTemplate(report.files, String(year(report.from) ?? ''), String(year(report.to) ?? ''), report.souls.slice(0, 3).map((s) => s.name).join(', '), report.resurrectedCount)
    : ''
  const shownEpitaph = epitaph ?? fallbackEpitaph

  const openOther = async () => {
    try {
      const chosen = await api.cryptOpenOther()
      if (chosen) await loadFolders(chosen)
    } catch (e) {
      setNotice(messageOf(e))
    }
  }

  const exportGrimoire = async () => {
    if (!report) return
    setBusy(true)
    setNotice(null)
    try {
      const html = grimoireHtml(report, { t, locale: LANG_INFO[lang].locale, epitaph: shownEpitaph, portraits, fmtDate })
      const saved = await api.cryptExport(html, t.cryptGrimoire(report.name))
      if (saved) setNotice(`${t.cryptExported} ${saved}`)
    } catch (e) {
      setNotice(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const voiceLabel = (f: CryptFile) => (f.origin === 'msn' ? t.cryptVoiceMsn : f.origin === 'mbox' ? t.cryptVoiceMbox : f.origin === 'outlook-express' ? t.cryptVoiceOE : t.cryptVoiceMail)

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-zinc-100">{t.cryptTitle}</h2>
          <p className="text-xs text-zinc-500">{t.cryptSub}</p>
        </div>
        <button
          type="button"
          onClick={() => setHelp(true)}
          title={t.cryptHelpOpen}
          aria-label={t.cryptHelpOpen}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-violet-400/40 text-[12px] font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 hover:shadow-[0_0_12px_rgba(167,139,250,.45)]"
        >
          ?
        </button>
      </div>
      <AnimatePresence>
        {help && (
          <CryptHelp
            status={{ hasFolder: folders.length > 0, files: report?.files ?? 0, indexing, souls: report?.souls.length ?? 0, portraits: report?.portraits.length ?? 0, voices: report?.voices.length ?? 0, model }}
            onClose={() => setHelp(false)}
            onOpenOther={() => {
              setHelp(false)
              void openOther()
            }}
            onIndex={() => void api.indexNow()}
            onSettings={() => {
              setHelp(false)
              onSettings()
            }}
            onExport={
              report && report.files > 0
                ? () => {
                    setHelp(false)
                    void exportGrimoire()
                  }
                : undefined
            }
          />
        )}
      </AnimatePresence>
      {notice && (
        <p role="status" className="mb-2 truncate rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-zinc-300" title={notice}>
          {notice}
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[230px_1fr] gap-3 pb-3">
        <div className="flex min-h-0 flex-col gap-2">
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" data-testid="crypt-list">
            {folders.length === 0 && <li className="px-1 text-[13px] text-zinc-500">{t.cryptNone}</li>}
            {folders.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => setFolder(f)}
                  className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${f === folder ? 'border-violet-400/50 bg-violet-400/10' : 'border-transparent hover:bg-white/[0.04]'}`}
                >
                  <Headstone active={f === folder} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-zinc-200">{f.split(/[\\/]/).filter(Boolean).pop() ?? f}</span>
                    <span className="block truncate text-[10px] text-zinc-600" title={f}>
                      <MiddleEllipsis text={f} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <ActionButton onClick={() => void openOther()}>{t.cryptOther}</ActionButton>
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto pr-1" data-testid="crypt-report">
          {!report && folder && <p className="pt-10 text-center text-sm text-zinc-500">{t.cryptLoading}</p>}
          {report && report.files === 0 && (
            <div className="flex flex-col items-center gap-3 pt-12 text-center">
              <GhostIcon className="h-12 w-12 text-violet-300/60" />
              <p className="max-w-sm text-sm text-zinc-400">{t.cryptEmpty}</p>
            </div>
          )}
          {report && report.files > 0 && (
            <motion.div key={report.folder} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className="crypt-hero relative overflow-hidden rounded-2xl border border-violet-400/25 p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-[0.25em] text-violet-300/80">{t.cryptGrimoire(report.name)}</p>
                    <p className="mt-1 text-sm text-zinc-300">{t.cryptSpan(report.files, String(year(report.from) ?? ''), String(year(report.to) ?? ''))}</p>
                    {report.ghosts > 0 && <p className="mt-0.5 text-[12px] text-amber-200/80">{t.cryptGhosts(report.ghosts)}</p>}
                  </div>
                  <ActionButton primary disabled={busy} onClick={() => void exportGrimoire()}>
                    {busy ? t.cryptExporting : t.cryptExport}
                  </ActionButton>
                </div>
                <p className="mt-3 border-t border-white/10 pt-3 font-serif text-[15px] italic leading-relaxed text-zinc-200" data-testid="crypt-epitaph">
                  <span className="mr-2 text-[10px] not-italic uppercase tracking-[0.25em] text-violet-300/70">{t.cryptEpitaph}</span>
                  {shownEpitaph}
                  {writing && !epitaph && <span className="ml-2 animate-pulse text-[11px] not-italic text-zinc-500">{t.cryptEpitaphWriting}</span>}
                </p>
              </div>

              {report.souls.length > 0 && (
                <Section title={t.cryptSouls} testId="crypt-souls">
                  <div className="flex flex-wrap gap-1.5">
                    {report.souls.map((s) => (
                      <span key={s.name} className="rounded-full border border-violet-400/25 bg-violet-400/10 px-2.5 py-0.5 text-[12px] text-violet-100">
                        {s.name} <span className="text-violet-300/60">· {s.files}</span>
                      </span>
                    ))}
                  </div>
                  {report.places.length > 0 && <p className="mt-2 text-[12px] text-zinc-500">{report.places.join(' · ')}</p>}
                </Section>
              )}

              <Section title={t.cryptYears} testId="crypt-years">
                <ol className="relative ml-1 space-y-3 border-l border-violet-400/25 pl-4">
                  {report.years.map((y) => (
                    <li key={y.year} className="relative">
                      <span className="absolute -left-[22px] top-1 h-2.5 w-2.5 rounded-full bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,.7)]" />
                      <p className="text-sm font-semibold text-zinc-100">
                        {y.year} <span className="text-[11px] font-normal text-zinc-500">· {t.cryptFiles(y.count)}</span>
                        {y.people.length > 0 && <span className="text-[11px] font-normal text-violet-300/80"> · {y.people.join(', ')}</span>}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {y.highlights.map((f) => (
                          <FileRow key={f.path} f={f} />
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </Section>

              {report.portraits.length > 0 && (
                <Section title={t.cryptPortraits} testId="crypt-portraits">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
                    {report.portraits.map((p, i) => (
                      <button key={p.path} type="button" onClick={() => void api.openFile(p.path).catch(() => undefined)} className="group text-left">
                        <div className="crypt-portrait flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
                          {portraits[i] ? (
                            <img src={portraits[i]!} alt="" className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" onError={(e) => (e.currentTarget.style.display = 'none')} />
                          ) : (
                            <FileIcon ext={p.ext} />
                          )}
                        </div>
                        <p className="mt-1 truncate text-[11px] text-zinc-400">{p.name}</p>
                        <p className="text-[10px] text-violet-300/70">{fmtDate(p.date)}</p>
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {report.voices.length > 0 && (
                <Section title={t.cryptVoices} testId="crypt-voices">
                  <ul className="space-y-0.5">
                    {report.voices.map((f) => (
                      <FileRow key={f.path} f={f} extra={voiceLabel(f)} />
                    ))}
                  </ul>
                </Section>
              )}

              {report.resurrected.length > 0 && (
                <Section title={t.cryptResurrected(report.resurrectedCount)} testId="crypt-resurrected">
                  <ul className="space-y-0.5">
                    {report.resurrected.map((f) => (
                      <FileRow key={f.path} f={f} />
                    ))}
                  </ul>
                </Section>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
