import type { Dict } from './i18n'

/** "hace 5 minutos", según el idioma. */
export function ago(t: Dict, ts: number, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - ts) / 60_000))
  if (min < 1) return t.ago_now
  if (min < 60) return t.ago_minutes(min)
  const h = Math.floor(min / 60)
  if (h < 24) return t.ago_hours(h)
  const d = Math.floor(h / 24)
  if (d < 30) return t.ago_days(d)
  return t.ago_months(Math.floor(d / 30))
}
