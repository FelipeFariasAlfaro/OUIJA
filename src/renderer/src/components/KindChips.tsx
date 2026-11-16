import { KIND_LABEL, type FileKind } from '@shared/filetypes'
import { useI18n } from '../i18n'

/**
 * Chips para elegir tipos de archivo. Sin ninguno marcado se entiende "todos". Solo se muestran los
 * tipos que existen, con su cantidad.
 */
export default function KindChips({
  counts,
  selected,
  onChange,
  testId
}: {
  counts: { kind: FileKind; count: number }[]
  selected: FileKind[]
  onChange: (next: FileKind[]) => void
  testId?: string
}) {
  const { lang, t } = useI18n()
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${active ? 'border-violet-400/60 bg-violet-400/15 text-violet-100' : 'border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200'}`
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId} role="group">
      <button type="button" aria-pressed={selected.length === 0} onClick={() => onChange([])} className={chip(selected.length === 0)}>
        {t.ghostsAll}
      </button>
      {counts.map(({ kind, count }) => {
        const on = selected.includes(kind)
        return (
          <button key={kind} type="button" aria-pressed={on} onClick={() => onChange(on ? selected.filter((k) => k !== kind) : [...selected, kind])} className={chip(on)}>
            {KIND_LABEL[lang][kind]} <span className="text-zinc-500">· {count}</span>
          </button>
        )
      })}
    </div>
  )
}
