import { useEffect, useMemo, useState } from 'react'
import { GHOST_BODY, GHOST_FACE } from '../components/ui'

/** Una descarga: el rayo principal y sus ramas, en coordenadas de 0 a 100. */
export interface Strike {
  id: number
  main: string
  branches: string[]
  /** Centro horizontal del destello (%). */
  x: number
}

/** Rayo quebrado entre dos puntos, por desplazamiento de puntos medios. */
function bolt(x1: number, y1: number, x2: number, y2: number, spread: number, depth: number): [number, number][] {
  if (depth === 0) return [[x1, y1], [x2, y2]]
  const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * spread
  const my = (y1 + y2) / 2 + (Math.random() - 0.5) * spread * 0.25
  const left = bolt(x1, y1, mx, my, spread / 2, depth - 1)
  return [...left.slice(0, -1), ...bolt(mx, my, x2, y2, spread / 2, depth - 1)]
}

const toPath = (pts: [number, number][]): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')

export function makeStrike(id: number): Strike {
  // A los lados, para no tapar el contenido del centro.
  const x = Math.random() < 0.5 ? 6 + Math.random() * 22 : 72 + Math.random() * 22
  const end = 45 + Math.random() * 35
  const pts = bolt(x, -2, x + (Math.random() - 0.5) * 18, end, 14, 5)
  const branches: string[] = []
  for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
    const [bx, by] = pts[2 + Math.floor(Math.random() * (pts.length - 4))]
    const dir = Math.random() < 0.5 ? -1 : 1
    branches.push(toPath(bolt(bx, by, bx + dir * (6 + Math.random() * 10), by + 8 + Math.random() * 14, 6, 3)))
  }
  return { id, main: toPath(pts), branches, x }
}

/** Fantasmas translúcidos que cruzan la ventana por detrás del contenido. */
const GHOSTS = [
  { top: 14, size: 70, duration: 26, delay: -4, dir: 1, opacity: 0.12 },
  { top: 58, size: 110, duration: 38, delay: -21, dir: -1, opacity: 0.08 },
  { top: 34, size: 46, duration: 21, delay: -13, dir: -1, opacity: 0.14 },
  { top: 72, size: 60, duration: 31, delay: -2, dir: 1, opacity: 0.1 },
  { top: 6, size: 90, duration: 44, delay: -30, dir: -1, opacity: 0.07 }
]

function Phantoms() {
  // Un poco de azar por sesión para que no se vea siempre igual.
  const ghosts = useMemo(() => GHOSTS.map((g) => ({ ...g, top: g.top + (Math.random() - 0.5) * 8 })), [])
  return (
    <>
      {ghosts.map((g, i) => (
        <div
          key={i}
          className={`storm-ghost absolute ${g.dir === 1 ? 'storm-ghost-right' : 'storm-ghost-left'}`}
          style={{ top: `${g.top}%`, width: g.size, height: g.size, opacity: g.opacity, animationDuration: `${g.duration}s`, animationDelay: `${g.delay}s` }}
        >
          <svg viewBox="0 0 100 100" className="storm-ghost-bob h-full w-full" style={{ transform: g.dir === -1 ? 'scaleX(-1)' : undefined, animationDelay: `${g.delay / 3}s` }}>
            <path d={GHOST_BODY} fill="#ddd6fe" />
            {GHOST_FACE.map((d) => (
              <path key={d} d={d} fill="#08070d" />
            ))}
          </svg>
        </div>
      ))}
    </>
  )
}

/**
 * Fondo de tormenta para la bienvenida: niebla que se mueve, rayos de vez en cuando y el destello que
 * ilumina la ventana, y fantasmas translúcidos que cruzan por detrás. Con `prefers-reduced-motion` todo queda quieto.
 */
export default function Storm() {
  const [strike, setStrike] = useState<Strike | null>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let n = 0
    let timer: ReturnType<typeof setTimeout>
    const next = (delay: number) => {
      timer = setTimeout(() => {
        setStrike(makeStrike(++n))
        timer = setTimeout(() => {
          setStrike(null)
          next(2500 + Math.random() * 5000)
        }, 900)
      }, delay)
    }
    next(900)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Nubes bajas que se arrastran por arriba */}
      <div className="storm-fog absolute -inset-x-1/4 -top-24 h-72" />
      <div className="storm-fog storm-fog-slow absolute -inset-x-1/4 -top-16 h-64 opacity-70" />
      <Phantoms />
      {/* Viñeta: los bordes más oscuros */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 55%, transparent 35%, rgba(0,0,0,.65) 100%)' }} />
      {strike && (
        <div key={strike.id}>
          <div className="storm-flash absolute inset-0" style={{ background: `radial-gradient(900px 600px at ${strike.x}% 0%, rgba(221,214,254,.7), rgba(139,92,246,.25) 45%, transparent 75%)` }} />
          <svg className="storm-bolt absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <filter id="storm-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="1.2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g filter="url(#storm-glow)" fill="none" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke">
              <path d={strike.main} stroke="#8b5cf6" strokeOpacity=".45" strokeWidth="12" vectorEffect="non-scaling-stroke" />
              <path d={strike.main} stroke="#ddd6fe" strokeWidth="4" vectorEffect="non-scaling-stroke" />
              <path d={strike.main} stroke="#ffffff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
              {strike.branches.map((d) => (
                <path key={d} d={d} stroke="#ddd6fe" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          </svg>
        </div>
      )}
    </div>
  )
}
