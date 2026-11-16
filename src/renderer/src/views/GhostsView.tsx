import { useEffect, useMemo, useState } from 'react'
import { kindOf, type FileKind } from '@shared/filetypes'
import KindChips from '../components/KindChips'
import { motion } from 'framer-motion'
import type { Ghost, GhostKind } from '@shared/types'
import { api } from '../api'
import { ActionButton, FileIcon, ResurrectedBadge } from '../components/ui'
import { useI18n } from '../i18n'

const KIND_KEY: Record<GhostKind, 'kindStale' | 'kindDuplicate' | 'kindVersion'> = {
  stale: 'kindStale',
  duplicate: 'kindDuplicate',
  version: 'kindVersion'
}

/** Para buscar sin importar tildes ni mayúsculas. */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const YEAR_MS = 365.25 * 24 * 3600 * 1000

function Obituary({ ghost }: { ghost: Ghost }) {
  const { t, fmtDate } = useI18n()
  const ext = ghost.name.split('.').pop() ?? ''
  const years = Math.floor((Date.now() - ghost.lastUsed) / YEAR_MS)
  const act = (fn: () => Promise<unknown>) => void fn().catch(() => undefined)
  return (
    <motion.div
      key={ghost.id}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <p className="text-[11px] uppercase tracking-[0.2em] text-violet-300/80">✝ {t.obituary}</p>
      <div className="mt-2 flex items-center gap-3">
        <FileIcon ext={ext} />
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-zinc-100">{ghost.name}</h3>
          <p className="text-xs text-zinc-500">{t.ago(years)}</p>
        </div>
      </div>

      <dl className="mt-4 space-y-2 text-[13px] leading-relaxed text-zinc-300">
        <div>
          {ghost.born !== undefined && (
            <>
              <dt className="inline text-zinc-500">{t.born} </dt>
              <dd className="inline">{fmtDate(ghost.born)}.</dd>{' '}
            </>
          )}
          <dt className="inline text-zinc-500">{t.lastUsed} </dt>
          <dd className="inline">{fmtDate(ghost.lastUsed)}.</dd>
        </div>
        {ghost.summary && <p className="text-zinc-300">{ghost.summary}</p>}
        {ghost.topics.length > 0 && (
          <p>
            <span className="text-zinc-500">{t.spoke} </span>
            {ghost.topics.join(', ')}.
          </p>
        )}
        {ghost.people.length > 0 && (
          <p>
            <span className="text-zinc-500">{t.mentions} </span>
            {ghost.people.join(', ')}.
          </p>
        )}
        {ghost.group && <p className="text-amber-200/90">{ghost.group.kind === 'duplicate' ? t.groupDuplicate(ghost.group.count) : t.groupVersion(ghost.group.count)}</p>}
      </dl>

      {ghost.related.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs uppercase tracking-wider text-zinc-500">{t.related}</p>
          <ul className="space-y-1 text-[13px] text-zinc-400">
            {ghost.related.map((r) => (
              <li key={r.path} className="truncate" title={r.path}>
                · {r.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-4">
        {ghost.resurrected && <ResurrectedBadge confidence={ghost.confidence} />}
        <div className="ml-auto flex gap-1.5">
          <ActionButton onClick={() => act(() => api.showInFolder(ghost.path))}>{ghost.container ? t.showContainer : t.showFolder}</ActionButton>
          <ActionButton primary onClick={() => act(() => api.openFile(ghost.path))}>
            {t.open}
          </ActionButton>
        </div>
      </div>
    </motion.div>
  )
}

export default function GhostsView() {
  const { t } = useI18n()
  const [ghosts, setGhosts] = useState<Ghost[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .ghosts()
      .then((list) => {
        if (!alive) return
        setGhosts(list)
        setSelectedId(list[0]?.id ?? null)
      })
      .catch(() => alive && setGhosts([]))
    return () => {
      alive = false
    }
  }, [])

  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<FileKind[]>([])
  const [category, setCategory] = useState<GhostKind | 'all'>('all')
  const kindOfGhost = (g: Ghost): FileKind => kindOf(g.name.includes('.') ? g.name.split('.').pop()!.toLowerCase() : '')
  const counts = useMemo(() => {
    const m = new Map<FileKind, number>()
    for (const g of ghosts ?? []) m.set(kindOfGhost(g), (m.get(kindOfGhost(g)) ?? 0) + 1)
    return [...m].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count)
  }, [ghosts])
  const categories = useMemo(() => (['stale', 'duplicate', 'version'] as GhostKind[]).filter((c) => ghosts?.some((g) => g.kind === c)), [ghosts])
  const visible = useMemo(() => {
    const q = fold(query.trim())
    return (ghosts ?? []).filter(
      (g) =>
        (kinds.length === 0 || kinds.includes(kindOfGhost(g))) &&
        (category === 'all' || g.kind === category) &&
        (!q || [g.name, g.path, g.summary ?? '', ...g.people, ...g.topics].some((x) => fold(x).includes(q)))
    )
  }, [ghosts, query, kinds, category])
  const selected = visible.find((g) => g.id === selectedId) ?? visible[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-zinc-100">{t.ghostsTitle}</h2>
        <p className="text-xs text-zinc-500">{t.ghostsSub}</p>
      </div>
      {ghosts && ghosts.length === 0 && <p className="pt-10 text-center text-sm text-zinc-500">{t.ghostsEmpty}</p>}
      {ghosts && ghosts.length > 0 && (
        <div className="mb-3 space-y-2" data-testid="ghost-filters">
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.ghostsSearch}
              aria-label={t.ghostsSearch}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-400/60"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as GhostKind | 'all')}
              aria-label={t.ghostsTitle}
              className="rounded-lg border border-white/10 bg-[#13131f] px-2 py-1.5 text-xs text-zinc-300"
            >
              <option value="all">{t.ghostsAll}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {t[KIND_KEY[c]]}
                </option>
              ))}
            </select>
            <span className="shrink-0 text-[11px] text-zinc-500">{t.ghostsShown(visible.length, ghosts.length)}</span>
          </div>
          {counts.length > 1 && <KindChips counts={counts} selected={kinds} onChange={setKinds} testId="ghost-kinds" />}
        </div>
      )}
      {ghosts && ghosts.length > 0 && visible.length === 0 && <p className="pt-10 text-center text-sm text-zinc-500">{t.ghostsNoMatch}</p>}
      {selected && ghosts && (
        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr] gap-3 pb-3">
          <ul className="space-y-1 overflow-y-auto pr-1" data-testid="ghost-list">
            {visible.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(g.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    g.id === selected.id ? 'border-violet-400/50 bg-violet-400/10' : 'border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="truncate text-sm text-zinc-200">{g.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span>{t[KIND_KEY[g.kind]]}</span>
                    {g.group && <span className="truncate text-zinc-600">· {g.group.kind === 'duplicate' ? t.groupDuplicate(g.group.count) : t.groupVersion(g.group.count)}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <Obituary ghost={selected} />
        </div>
      )}
    </div>
  )
}
