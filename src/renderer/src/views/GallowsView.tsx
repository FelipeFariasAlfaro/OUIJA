import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RestoreFailure, RestoreResponse, TrashItemDto, TrashOverview } from '@shared/ipc'
import type { FileKind } from '@shared/filetypes'
import { KIND_LABEL } from '@shared/filetypes'
import { api } from '../api'
import { ago } from '../ago'
import { ActionButton, FileIcon, formatSize, GhostIcon, MiddleEllipsis } from '../components/ui'
import { useI18n } from '../i18n'

type Section = 'condemned' | 'resurrection'
type Sort = 'recent' | 'old' | 'big'

const ERR_KEY: Record<RestoreFailure, 'errNotFound' | 'errNoOriginal' | 'errNoDestination' | 'errFailed'> = {
  'not-found': 'errNotFound',
  'no-original': 'errNoOriginal',
  'no-destination': 'errNoDestination',
  failed: 'errFailed'
}

const SORTS: { id: Sort; key: 'sortRecent' | 'sortOld' | 'sortBig' }[] = [
  { id: 'recent', key: 'sortRecent' },
  { id: 'old', key: 'sortOld' },
  { id: 'big', key: 'sortBig' }
]

function Row({ item, marked, onMark, onResurrect }: { item: TrashItemDto; marked: boolean; onMark: () => void; onResurrect: () => void }) {
  const { t } = useI18n()
  return (
    <li className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${marked ? 'border-violet-400/40 bg-violet-400/[0.07]' : 'border-transparent hover:bg-white/[0.03]'}`}>
      <input type="checkbox" checked={marked} onChange={onMark} aria-label={`${t.mark}: ${item.name}`} className="mt-3 accent-violet-500" />
      <FileIcon ext={item.isDir ? '' : item.ext} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">{item.name}</span>
          <span className="shrink-0 text-xs text-zinc-500">
            {item.sizeApprox ? `${t.sizeApprox} ` : ''}
            {formatSize(item.size)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-500" title={item.originalFolder}>
          {item.originalFolder ? (
            <>
              {t.wasIn} <MiddleEllipsis text={item.originalFolder} />
            </>
          ) : (
            t.unknownOrigin
          )}
          {item.trashedAt ? ` · ${t.deletedOn} ${ago(t, item.trashedAt)}` : ''}
        </p>
        {item.summary && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-zinc-400">
            <span className="mr-1.5 rounded-full border border-violet-400/25 bg-violet-400/10 px-1.5 py-px text-[10px] text-violet-200">{t.knewIt}</span>
            {item.summary}
          </p>
        )}
      </div>
      <ActionButton primary onClick={onResurrect}>
        {t.resurrect}
      </ActionButton>
    </li>
  )
}

export default function GallowsView() {
  const { lang, t } = useI18n()
  const [section, setSection] = useState<Section>('condemned')
  const [overview, setOverview] = useState<TrashOverview | null>(null)
  const [filter, setFilter] = useState('')
  const [kind, setKind] = useState<FileKind | 'all'>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [where, setWhere] = useState<'original' | 'choose'>('original')
  const [busy, setBusy] = useState(false)
  const [response, setResponse] = useState<(RestoreResponse & { names: Record<string, string> }) | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void api
      .trashList()
      .then((o) => {
        setOverview(o)
        // Lo que ya no está en la papelera deja de estar marcado.
        setMarked((prev) => {
          const ids = new Set(o.items.map((i) => i.id))
          const next = new Set([...prev].filter((id) => ids.has(id)))
          return next.size === prev.size ? prev : next
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    load()
    return api.onShown(load)
  }, [load])

  const items = overview?.items ?? []
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const markedItems = useMemo(() => [...marked].map((id) => byId.get(id)).filter((i): i is TrashItemDto => !!i), [marked, byId])
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = items.filter((i) => (kind === 'all' || i.kind === kind) && (!q || i.name.toLowerCase().includes(q) || (i.originalFolder ?? '').toLowerCase().includes(q) || (i.summary ?? '').toLowerCase().includes(q)))
    const cmp: Record<Sort, (a: TrashItemDto, b: TrashItemDto) => number> = {
      recent: (a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0),
      old: (a, b) => (a.trashedAt ?? Infinity) - (b.trashedAt ?? Infinity),
      big: (a, b) => b.size - a.size
    }
    return [...list].sort(cmp[sort])
  }, [items, filter, kind, sort])

  const toggle = (id: string) =>
    setMarked((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const needsFolder = markedItems.some((i) => !i.originalPath)

  const restore = async () => {
    if (markedItems.length === 0 || busy) return
    setBusy(true)
    setError(null)
    setResponse(null)
    try {
      const names = Object.fromEntries(markedItems.map((i) => [i.id, i.name]))
      const res = await api.trashRestore(
        markedItems.map((i) => i.id),
        where
      )
      setResponse({ ...res, names })
      const done = new Set(res.results.filter((r) => r.ok).map((r) => r.id))
      setMarked((prev) => new Set([...prev].filter((id) => !done.has(id))))
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  const tabBtn = (id: Section, label: string, badge?: number) => (
    <button
      type="button"
      onClick={() => setSection(id)}
      aria-pressed={section === id}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${section === id ? 'bg-violet-400/15 text-violet-200' : 'text-zinc-400 hover:text-zinc-200'}`}
    >
      {label}
      {badge ? <span className="ml-1.5 rounded-full bg-violet-400/20 px-1.5 text-[10px]">{badge}</span> : null}
    </button>
  )

  const header = (
    <div className="mx-4 flex items-center gap-2">
      <h2 className="text-sm font-semibold text-zinc-100">{t.gallowsTitle}</h2>
      <div className="ml-2 flex gap-1">
        {tabBtn('condemned', t.gallowsCondemned)}
        {tabBtn('resurrection', t.gallowsResurrection, marked.size)}
      </div>
    </div>
  )

  if (!overview && !error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {header}
        <p className="pt-10 text-center text-sm text-zinc-500">{t.gallowsLoading}</p>
      </div>
    )
  }

  if (overview && !overview.supported) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {header}
        <p className="pt-10 text-center text-sm text-zinc-500">{t.gallowsUnsupported}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {header}
      {error && (
        <p role="alert" className="mx-4 truncate rounded-lg bg-rose-400/10 px-3 py-1.5 text-xs text-rose-200" title={error}>
          {error}
        </p>
      )}

      {section === 'condemned' && overview && (
        <div className="flex min-h-0 flex-1 flex-col px-4">
          <p className="text-xs text-zinc-500">{t.gallowsSub}</p>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 pt-12 text-center">
              <GhostIcon className="h-12 w-12 text-violet-300/60" />
              <p className="text-sm text-zinc-400">{t.gallowsEmpty}</p>
            </div>
          ) : (
            <>
              <p className="mt-2 text-[12px] text-zinc-400" data-testid="gallows-summary">
                {t.gallowsCount(overview.totalCount)} · {formatSize(overview.totalSize)}
                {overview.oldest ? ` · ${t.gallowsOldest}: ${ago(t, overview.oldest)}` : ''} · {t.gallowsLocations(overview.locations)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t.gallowsFilter}
                  spellCheck={false}
                  className="min-w-[10rem] flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-400/60"
                />
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Orden" className="rounded-lg border border-white/10 bg-[#13131f] px-2 py-1.5 text-xs text-zinc-300">
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {t[s.key]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setKind('all')} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${kind === 'all' ? 'border-violet-400/50 text-violet-200' : 'border-white/10 text-zinc-400'}`}>
                  {t.gallowsAllKinds}
                </button>
                {(Object.entries(overview.byKind) as [FileKind, number][]).map(([k, n]) => (
                  <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${kind === k ? 'border-violet-400/50 text-violet-200' : 'border-white/10 text-zinc-400'}`}>
                    {KIND_LABEL[lang][k]} · {n}
                  </button>
                ))}
              </div>
              <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pb-3" data-testid="gallows-list">
                {visible.map((i) => (
                  <Row
                    key={i.id}
                    item={i}
                    marked={marked.has(i.id)}
                    onMark={() => toggle(i.id)}
                    onResurrect={() => {
                      setMarked((prev) => new Set(prev).add(i.id))
                      setResponse(null)
                      setSection('resurrection')
                    }}
                  />
                ))}
              </ul>
              {marked.size > 0 && (
                <div className="flex items-center gap-3 border-t border-white/5 py-2 text-xs text-zinc-300">
                  {t.marked(marked.size)}
                  <ActionButton primary onClick={() => setSection('resurrection')}>
                    {t.goResurrection}
                  </ActionButton>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {section === 'resurrection' && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
          {markedItems.length === 0 && !response && <p className="pt-10 text-center text-sm text-zinc-500">{t.resurrectionEmpty}</p>}

          {markedItems.length > 0 && (
            <>
              <ul className="space-y-1" data-testid="resurrection-basket">
                {markedItems.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
                    <FileIcon ext={i.isDir ? '' : i.ext} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-100">{i.name}</p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {where === 'original' ? (i.originalFolder ? `${t.willReturnTo} ${i.originalFolder}` : t.needsFolder) : t.whereChooseHelp}
                      </p>
                    </div>
                    <ActionButton onClick={() => toggle(i.id)}>{t.unmark}</ActionButton>
                  </li>
                ))}
              </ul>

              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs uppercase tracking-wider text-zinc-500">{t.resurrectionWhere}</legend>
                {(['original', 'choose'] as const).map((w) => (
                  <label key={w} className="flex items-start gap-2 text-[13px] text-zinc-300">
                    <input type="radio" name="where" checked={where === w} onChange={() => setWhere(w)} className="mt-0.5 accent-violet-500" />
                    <span>
                      {w === 'original' ? t.whereOriginal : t.whereChoose}
                      <span className="block text-[11px] text-zinc-500">{w === 'original' ? t.whereOriginalHelp : t.whereChooseHelp}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {where === 'original' && needsFolder && <p className="text-[12px] text-amber-200">{t.needsFolder}</p>}
              <p className="text-[11px] text-zinc-500">{t.safeNote}</p>
              <div className="flex items-center gap-2">
                <ActionButton primary disabled={busy || (where === 'original' && needsFolder)} onClick={() => void restore()}>
                  {busy ? t.resurrecting : t.resurrectN(markedItems.length)}
                </ActionButton>
                <ActionButton onClick={() => setMarked(new Set())}>{t.clearMarks}</ActionButton>
              </div>
            </>
          )}

          {response && (
            <div data-testid="resurrection-result" className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">{t.resultTitle}</p>
              {response.canceled ? (
                <p className="text-sm text-zinc-400">{t.resultCanceled}</p>
              ) : (
                <ul className="space-y-1.5">
                  {response.results.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-[13px]">
                      {r.ok ? (
                        <>
                          <span className="text-emerald-300">✦</span>
                          <span className="min-w-0 flex-1 truncate text-zinc-200" title={r.restoredTo}>
                            {r.renamed ? t.resultRenamed : t.resultOk}: {r.restoredTo}
                          </span>
                          <ActionButton onClick={() => void api.trashReveal(r.restoredTo).catch(() => undefined)}>{t.showIt}</ActionButton>
                        </>
                      ) : (
                        <span className="text-rose-200">
                          {t.resultFail}: {response.names[r.id] ?? r.id} ({t[ERR_KEY[r.error]]})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
