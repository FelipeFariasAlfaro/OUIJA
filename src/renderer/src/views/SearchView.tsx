import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Match, SearchAnswer } from '@shared/types'
import { api } from '../api'
import { KIND_LABEL, kindOf } from '@shared/filetypes'
import { ActionButton, FileIcon, formatSize, GhostIcon, Highlight, MiddleEllipsis, ResurrectedBadge } from '../components/ui'
import RecentChanges from '../components/RecentChanges'
import { useI18n } from '../i18n'
import { suggestionsFor } from '../suggestions'

const AI_PROBLEM = {
  'invalid-key': 'aiErr_invalid_key',
  forbidden: 'aiErr_forbidden',
  quota: 'aiErr_quota',
  'rate-limit': 'aiErr_rate_limit',
  'model-unavailable': 'aiErr_model_unavailable',
  network: 'aiErr_network',
  'bad-response': 'aiErr_bad_response',
  blocked: 'aiErr_blocked'
} as const

const messageOf = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

function MatchCard({
  match,
  query,
  selected,
  onHover,
  onAction
}: {
  match: Match
  query: string
  selected: boolean
  onHover: () => void
  onAction: (action: 'open' | 'show' | 'export' | 'present', match: Match) => void
}) {
  const { lang, t, fmtDate } = useI18n()
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      onMouseEnter={onHover}
      onDoubleClick={() => onAction('open', match)}
      aria-selected={selected}
      className={`group flex cursor-default gap-3 rounded-xl border p-3 transition-colors ${
        selected ? 'border-violet-400/50 bg-violet-400/10' : 'border-transparent hover:bg-white/[0.03]'
      }`}
    >
      <FileIcon ext={match.ext} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">{match.name}</span>
          <span className="shrink-0 text-xs text-zinc-500">{fmtDate(match.mtime)}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500" title={match.path}>
          {match.container ? (
            <>
              {t.insideOf} <span className="text-zinc-400">{match.container.split(/[\\/]/).pop()}</span>
            </>
          ) : (
            <MiddleEllipsis text={match.path} />
          )}
        </div>
        <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-zinc-400">
          {match.snippet ? <Highlight text={match.snippet} query={query} /> : `${KIND_LABEL[lang][kindOf(match.ext)]} ${match.ext.toUpperCase()} · ${formatSize(match.size)}`}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {match.resurrected && <ResurrectedBadge confidence={match.confidence} />}
          {match.viaEntity && (
            <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-200">
              {t.viaEntity} {match.viaEntity}
            </span>
          )}
          <div className={`ml-auto flex gap-1.5 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            {match.resurrected && (
              <span title={t.presentHelp}>
                <ActionButton onClick={() => onAction('present', match)}>✦ {t.present}</ActionButton>
              </span>
            )}
            {match.container && <ActionButton onClick={() => onAction('export', match)}>{t.export}</ActionButton>}
            <ActionButton onClick={() => onAction('show', match)}>{match.container ? t.showContainer : t.showFolder}</ActionButton>
            <ActionButton primary onClick={() => onAction('open', match)}>
              {t.open}
            </ActionButton>
          </div>
        </div>
      </div>
    </motion.li>
  )
}

export default function SearchView({ hasFolders, onAddFolder, changesKey, onGallows }: { hasFolders: boolean; onAddFolder: () => void; changesKey: string | number; onGallows: () => void }) {
  const { lang, t } = useI18n()
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SearchAnswer | null>(null)
  const [selected, setSelected] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [topPerson, setTopPerson] = useState<string | undefined>()
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    void api.people().then((p) => setTopPerson(p[0]?.name)).catch(() => undefined)
  }, [])

  useEffect(() => {
    input.current?.focus()
    return api.onShown(() => {
      input.current?.focus()
      input.current?.select()
    })
  }, [])

  const ask = useCallback(
    async (text: string) => {
      const q = text.trim()
      if (!q) return
      const mine = ++seq.current
      setAsked(q)
      setLoading(true)
      setResult(null)
      setSelected(0)
      setNotice(null)
      try {
        const res = await api.ask(q)
        if (mine !== seq.current) return // llegó una respuesta vieja
        setResult(res)
      } catch (error) {
        if (mine === seq.current) setNotice(`${t.askFailed}: ${messageOf(error)}`)
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    },
    [t]
  )

  const matches = useMemo(() => result?.matches ?? [], [result])

  const act = useCallback(
    async (action: 'open' | 'show' | 'export' | 'present', match: Match) => {
      try {
        if (action === 'open') await api.openFile(match.path)
        else if (action === 'show') await api.showInFolder(match.path)
        else if (action === 'present') {
          const r = await api.bringToPresent(match.path)
          if (r.savedTo) setNotice(`${t.presented((r.format ?? 'md').toUpperCase())} ${r.savedTo}`)
        } else {
          const r = await api.exportFile(match.path)
          if (r.savedTo) setNotice(`${t.exported} ${r.savedTo}`)
        }
      } catch (error) {
        setNotice(`${t.actionFailed}: ${messageOf(error)}`)
      }
    },
    [t]
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && matches.length > 0) {
      e.preventDefault()
      setSelected((s) => (s + 1) % matches.length)
    } else if (e.key === 'ArrowUp' && matches.length > 0) {
      e.preventDefault()
      setSelected((s) => (s - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter') {
      if (query.trim() !== asked && query.trim()) void ask(query)
      else if (matches[selected]) void act('open', matches[selected])
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-tour="search" className="mx-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 focus-within:border-violet-400/60">
        <GhostIcon className="h-6 w-6 shrink-0 text-violet-300" />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t.placeholder}
          spellCheck={false}
          className="w-full bg-transparent text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500"
        />
        {(query || result) && (
          <button
            type="button"
            title={t.clearSearch}
            aria-label={t.clearSearch}
            onClick={() => {
              seq.current++ // descarta una respuesta que aún no llega
              setQuery('')
              setAsked('')
              setResult(null)
              setLoading(false)
              setNotice(null)
              setSelected(0)
              input.current?.focus()
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
          >
            <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {notice && (
        <p role="status" className="mx-4 mt-2 truncate rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-zinc-300" title={notice}>
          {notice}
        </p>
      )}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        <AnimatePresence mode="wait">
          {!loading && !result && !hasFolders && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3 pt-12 text-center">
              <GhostIcon className="h-14 w-14 text-violet-300/70" />
              <h2 className="text-base font-semibold text-zinc-100">{t.emptyIndexTitle}</h2>
              <p className="max-w-sm text-sm text-zinc-400">{t.emptyIndexText}</p>
              <ActionButton primary onClick={onAddFolder}>
                {t.addFolderCta}
              </ActionButton>
            </motion.div>
          )}

          {!loading && !result && hasFolders && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-6">
              <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">{t.suggestions}</p>
              <div className="flex flex-wrap gap-2">
                {suggestionsFor(lang, topPerson).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setQuery(s)
                      void ask(s)
                    }}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-violet-400/40 hover:text-violet-200"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <RecentChanges refreshKey={changesKey} onGallows={onGallows} />
            </motion.div>
          )}

          {loading && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3 pt-14 text-sm text-zinc-400">
              <motion.div animate={{ y: [0, -6, 0], opacity: [0.7, 1, 0.7] }} transition={{ repeat: Infinity, duration: 1.6 }}>
                <GhostIcon className="h-12 w-12 text-violet-300 drop-shadow-[0_0_18px_rgba(167,139,250,.55)]" />
              </motion.div>
              {t.thinking}
            </motion.div>
          )}

          {result && (
            <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {result.answer ? (
                <p className="mb-3 rounded-xl border border-violet-400/20 bg-violet-400/[0.07] p-3 text-sm leading-relaxed text-zinc-200">{result.answer}</p>
              ) : (
                <p className="pt-8 text-center text-sm text-zinc-500">{t.noResults}</p>
              )}
              {result.aiProblem && (
                <p role="status" className="mb-2 rounded-lg bg-amber-400/10 px-3 py-1.5 text-[12px] text-amber-200">
                  {t.aiProblemNotice} {t[AI_PROBLEM[result.aiProblem]] as string}
                </p>
              )}
              {result.mode === 'light' && result.found && !result.aiProblem && <p className="mb-2 text-[11px] text-zinc-500">{t.lightMode}</p>}
              <ul className="space-y-1">
                {matches.map((m, i) => (
                  <MatchCard key={m.id} match={m} query={asked} selected={i === selected} onHover={() => setSelected(i)} onAction={(a, mm) => void act(a, mm)} />
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
