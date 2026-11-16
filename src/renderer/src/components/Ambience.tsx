import { useEffect, useState } from 'react'
import { makeStrike, type Strike } from '../onboarding/Storm'
import { GHOST_BODY, GHOST_FACE } from './ui'

const rand = (min: number, max: number): number => min + Math.random() * (max - min)

/** Un fantasma que cruza la ventana una vez, de un lado a otro. */
interface Crossing {
  id: number
  top: number
  size: number
  dir: 1 | -1
  duration: number
  opacity: number
}

/**
 * Fondo de la aplicación, siempre detrás del contenido y sin recibir clics: niebla baja que se
 * arrastra, un relámpago lejano cada medio minuto o más y, cada tanto, un fantasma tenue que
 * cruza, a veces lejos y a veces cerca. Con `prefers-reduced-motion` solo queda la niebla quieta.
 */
export default function Ambience() {
  const [flash, setFlash] = useState<Strike | null>(null)
  const [ghost, setGhost] = useState<Crossing | null>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timers: ReturnType<typeof setTimeout>[] = []
    let n = 0
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms))

    const lightning = (delay: number) =>
      later(() => {
        setFlash(makeStrike(++n))
        later(() => setFlash(null), 1400)
        lightning(rand(25_000, 50_000))
      }, delay)

    const haunt = (delay: number) =>
      later(() => {
        // A veces lejos (chico y tenue), a veces cerca (grande y algo más visible).
        const near = Math.random() < 0.45
        const g: Crossing = { id: ++n, top: rand(15, 68), size: near ? rand(120, 170) : rand(60, 95), dir: Math.random() < 0.5 ? 1 : -1, duration: near ? rand(14, 20) : rand(20, 28), opacity: near ? 0.13 : 0.09 }
        setGhost(g)
        later(() => setGhost(null), g.duration * 1000)
        haunt(g.duration * 1000 + rand(25_000, 60_000))
      }, delay)

    lightning(rand(6_000, 12_000))
    haunt(rand(8_000, 15_000))
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" data-testid="ambience">
      <div className="ambience-fog absolute -inset-x-1/4 -bottom-16 h-56" />
      <div className="ambience-fog ambience-fog-slow absolute -inset-x-1/4 -bottom-24 h-48 opacity-60" />
      {flash && (
        <div key={flash.id} className="ambience-flash absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-3/4" style={{ background: `radial-gradient(70% 90% at ${flash.x}% -10%, rgba(196,181,253,.4), rgba(139,92,246,.14) 45%, transparent 75%)` }} />
          {/* Rayo lejano: fino, borroso y tenue, detrás de todo. */}
          <svg className="absolute inset-0 h-full w-full opacity-40 [filter:blur(1px)]" viewBox="0 0 100 100" preserveAspectRatio="none">
            <g fill="none" strokeLinejoin="round" strokeLinecap="round">
              <path d={flash.main} stroke="#8b5cf6" strokeOpacity=".5" strokeWidth="8" vectorEffect="non-scaling-stroke" />
              <path d={flash.main} stroke="#ede9fe" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
              {flash.branches.map((d) => (
                <path key={d} d={d} stroke="#c4b5fd" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          </svg>
        </div>
      )}
      {ghost && (
        <div
          key={ghost.id}
          className={`ambience-ghost absolute ${ghost.dir === 1 ? 'storm-ghost-right' : 'storm-ghost-left'}`}
          style={{ top: `${ghost.top}%`, width: ghost.size, height: ghost.size, opacity: ghost.opacity, animationDuration: `${ghost.duration}s` }}
        >
          <svg viewBox="0 0 100 100" className="storm-ghost-bob h-full w-full" style={{ transform: ghost.dir === -1 ? 'scaleX(-1)' : undefined }}>
            <path d={GHOST_BODY} fill="#ddd6fe" />
            {GHOST_FACE.map((d) => (
              <path key={d} d={d} fill="#08070d" />
            ))}
          </svg>
        </div>
      )}
    </div>
  )
}
