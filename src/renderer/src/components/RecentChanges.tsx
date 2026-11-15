import { useCallback, useEffect, useState } from 'react'
import type { ChangeDto } from '@shared/ipc'
import { api } from '../api'
import { ago } from '../ago'
import { useI18n } from '../i18n'
import { FileIcon } from './ui'

const STYLE = {
  added: { key: 'changeAdded', cls: 'bg-emerald-400/10 text-emerald-200 border-emerald-400/25' },
  modified: { key: 'changeModified', cls: 'bg-sky-400/10 text-sky-200 border-sky-400/25' },
  removed: { key: 'changeRemoved', cls: 'bg-rose-400/10 text-rose-200 border-rose-400/25' }
} as const

/** Lo último que OUIJA detectó. Se refresca solo cuando llegan cambios. */
export default function RecentChanges({ refreshKey, onGallows }: { refreshKey: string | number; onGallows: () => void }) {
  const { t } = useI18n()
  const [items, setItems] = useState<ChangeDto[] | null>(null)

  const load = useCallback(() => {
    void api.recentChanges(8).then(setItems).catch(() => setItems([]))
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])
  useEffect(() => {
    const offChanges = api.onChanges(load)
    const offShown = api.onShown(load)
    return () => {
      offChanges()
      offShown()
    }
  }, [load])

  if (items === null) return null
  return (
    <section className="mt-6" aria-label={t.changesTitle}>
      <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">{t.changesTitle}</p>
      {items.length === 0 ? (
        <p className="text-[13px] text-zinc-500">{t.changesEmpty}</p>
      ) : (
        <ul className="space-y-1" data-testid="recent-changes">
          {items.map((c) => {
            const st = STYLE[c.kind]
            const open = c.exists && c.kind !== 'removed'
            return (
              <li key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                <FileIcon ext={c.ext} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {open ? (
                      <button type="button" onClick={() => void api.openFile(c.path).catch(() => undefined)} className="truncate text-sm text-zinc-100 hover:text-violet-200">
                        {c.name}
                      </button>
                    ) : (
                      <span className="truncate text-sm text-zinc-300">{c.name}</span>
                    )}
                    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] ${st.cls}`}>{t[st.key]}</span>
                    <span className="shrink-0 text-[11px] text-zinc-500">{ago(t, c.ts)}</span>
                  </div>
                  {c.summary && <p className="truncate text-xs text-zinc-500">{c.summary}</p>}
                </div>
                {c.kind === 'removed' && (
                  <button type="button" onClick={onGallows} className="shrink-0 text-[11px] text-violet-300 hover:text-violet-200">
                    {t.changeViewGallows}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
