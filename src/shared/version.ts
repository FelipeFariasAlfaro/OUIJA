/** `1.10.0` > `1.9.3`. Ignora la `v` inicial y lo que venga tras un guion (prerelease). */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0)
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}
