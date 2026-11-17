import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { Person, PersonSummary } from '@shared/types'
import { api } from '../api'
import { ActionButton, FileIcon, MiddleEllipsis } from '../components/ui'
import { useI18n } from '../i18n'

/** Para buscar sin importar tildes ni mayúsculas. */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export default function PeopleView({ refreshKey }: { refreshKey?: string }) {
  const { t, fmtDate } = useI18n()
  const [people, setPeople] = useState<PersonSummary[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [person, setPerson] = useState<Person | null>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const visible = useMemo(() => {
    const q = fold(query.trim())
    if (!q || !people) return people ?? []
    return people.filter((p) => [p.name, ...p.aliases].some((n) => fold(n).includes(q)))
  }, [people, query])
  const act = (fn: () => Promise<unknown>) => {
    setNotice(null)
    void fn().catch((e: unknown) => setNotice(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)))
  }

  const reload = useCallback(async (keep?: string) => {
    const list = await api.people()
    setPeople(list)
    setSelectedId((cur) => (keep ?? cur) && list.some((p) => p.id === (keep ?? cur)) ? (keep ?? cur) : (list[0]?.id ?? null))
  }, [])

  useEffect(() => {
    void reload().catch(() => setPeople([]))
  }, [reload, refreshKey])

  useEffect(() => {
    if (!selectedId) {
      setPerson(null)
      return
    }
    let alive = true
    api
      .timeline(selectedId)
      .then((p) => alive && setPerson(p))
      .catch(() => alive && setPerson(null))
    return () => {
      alive = false
    }
  }, [selectedId, people])

  const decide = async (decision: 'merge' | 'split', a: string, b: string) => {
    await api.decideNames(decision, a, b)
    await reload()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-zinc-100">{t.peopleTitle}</h2>
        <p className="text-xs text-zinc-500">{t.peopleSub}</p>
      </div>
      {notice && (
        <p role="status" className="mb-2 truncate rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-zinc-300" title={notice}>
          {notice}
        </p>
      )}
      {people && people.length === 0 && <p className="pt-10 text-center text-sm text-zinc-500">{t.peopleEmpty}</p>}
      {people && people.length > 0 && (
        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] gap-3 pb-3">
          <div className="flex min-h-0 flex-col gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visible[0]) setSelectedId(visible[0].id)
            }}
            placeholder={t.peopleSearch}
            aria-label={t.peopleSearch}
            spellCheck={false}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-400/60"
          />
          <p className="px-1 text-[11px] text-zinc-500">{t.peopleTotal(visible.length)}</p>
          {visible.length === 0 && <p className="px-1 text-[13px] text-zinc-500">{t.peopleNoMatch}</p>}
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" data-testid="people-list">
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    p.id === selectedId ? 'border-violet-400/50 bg-violet-400/10' : 'border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="truncate text-sm text-zinc-200">{p.name}</div>
                  <div className="text-[11px] text-zinc-500">{t.filesCount(p.fileCount)}</div>
                </button>
              </li>
            ))}
          </ul>
          </div>

          {person && (
            <motion.div key={person.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-base font-semibold text-zinc-100">{person.name}</h3>
              {person.aliases.length > 0 && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                  {t.alsoKnown}:
                  {person.aliases.map((alias) => (
                    <span key={alias} className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-zinc-300">
                      {alias}
                      <button type="button" title={t.split} aria-label={`${t.split} ${alias}`} onClick={() => void decide('split', person.name, alias)} className="text-zinc-500 hover:text-rose-300">
                        ×
                      </button>
                    </span>
                  ))}
                </p>
              )}
              {people.length > 1 && (
                <select
                  aria-label={t.mergeWith}
                  value=""
                  onChange={(e) => e.target.value && void decide('merge', person.name, e.target.value)}
                  className="mt-2 rounded-md border border-white/10 bg-[#14141f] px-2 py-1 text-xs text-zinc-300"
                >
                  <option value="">{t.mergeWith}</option>
                  {people
                    .filter((p) => p.id !== person.id)
                    .map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                </select>
              )}

              <p className="mb-3 mt-4 text-xs uppercase tracking-wider text-zinc-500">
                {t.personFiles} · {t.timeline}
              </p>
              <ol className="relative ml-1.5 space-y-3 border-l border-violet-400/25 pl-5" data-testid="person-files">
                {person.files.map((f) => {
                  const container = f.path.includes('::') ? f.path.split('::')[0] : undefined
                  return (
                    <li key={f.path} className="group relative rounded-lg p-2 hover:bg-white/[0.03]">
                      <span className="absolute -left-[26px] top-4 h-2.5 w-2.5 rounded-full bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,.7)]" />
                      <div className="flex items-start gap-3">
                        <FileIcon ext={f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : ''} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => act(() => api.openFile(f.path))} className="truncate text-left text-sm font-medium text-zinc-100 hover:text-violet-200">
                              {f.name}
                            </button>
                            <span className="shrink-0 text-xs text-violet-300">{fmtDate(f.mtime)}</span>
                          </div>
                          <p className="truncate text-xs text-zinc-500" title={f.path}>
                            <MiddleEllipsis text={container ?? f.path} />
                          </p>
                          {f.snippet && <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-zinc-400">{f.snippet}</p>}
                          <div className="mt-1.5 flex gap-1.5">
                            <ActionButton primary onClick={() => act(() => api.openFile(f.path))}>
                              {t.open}
                            </ActionButton>
                            <ActionButton onClick={() => act(() => api.showInFolder(f.path))}>{container ? t.showContainer : t.showFolder}</ActionButton>
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </motion.div>
          )}
        </div>
      )}
    </div>
  )
}
