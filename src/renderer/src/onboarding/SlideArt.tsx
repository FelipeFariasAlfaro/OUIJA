import { motion } from 'framer-motion'
import { GhostIcon } from '../components/ui'

/** Ilustraciones de las diapositivas. Son decorativas: los textos de ejemplo no salen de tus archivos. */

const card = 'rounded-lg border border-white/10 bg-white/[0.04]'

export function SearchArt() {
  return (
    <div className="flex w-[360px] flex-col gap-2.5" aria-hidden="true">
      <div className={`${card} flex items-center gap-2 border-violet-400/40 px-3 py-2`}>
        <GhostIcon className="h-4 w-4 text-violet-300" />
        <motion.span
          className="overflow-hidden whitespace-nowrap text-[12px] text-zinc-200"
          initial={{ width: 0 }}
          animate={{ width: '15.5em' }}
          transition={{ duration: 2, ease: 'linear', delay: 0.4 }}
        >
          ¿dónde dejé el contrato de arriendo?
        </motion.span>
      </div>
      {[
        { n: 'contrato_arriendo_2015.doc', t: 'Contrato de arriendo por doce meses…', d: 2.6 },
        { n: 'carta_propietario.txt', t: 'No renovaré el arriendo del departamento…', d: 3 }
      ].map((r) => (
        <motion.div key={r.n} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: r.d, duration: 0.35 }} className={`${card} px-3 py-2`}>
          <div className="text-[12px] font-medium text-zinc-100">{r.n}</div>
          <div className="text-[11px] text-zinc-500">{r.t}</div>
        </motion.div>
      ))}
    </div>
  )
}

export function ResurrectArt() {
  const chips = [
    { label: '.wpd', x: -120, y: -42, color: 'text-amber-300 bg-amber-500/15' },
    { label: '.zip', x: -140, y: 6, color: 'text-yellow-300 bg-yellow-500/15' },
    { label: '.doc', x: -110, y: 52, color: 'text-sky-300 bg-sky-500/15' }
  ]
  return (
    <div className="relative flex h-40 w-[380px] items-center justify-center" aria-hidden="true">
      {chips.map((c, i) => (
        <motion.div
          key={c.label}
          className={`absolute rounded-md px-2 py-1 text-[11px] font-semibold ${c.color}`}
          style={{ left: `calc(50% + ${c.x}px - 18px)`, top: `calc(50% + ${c.y}px - 12px)` }}
          initial={{ opacity: 0.3, x: 0 }}
          animate={{ opacity: [0.3, 1, 0], x: [0, 40, 78] }}
          transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.5, repeatDelay: 0.6 }}
        >
          {c.label}
        </motion.div>
      ))}
      <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 2.4 }} className="relative z-10">
        <GhostIcon className="h-16 w-16 text-violet-300 drop-shadow-[0_0_22px_rgba(167,139,250,.6)]" />
      </motion.div>
      <motion.div
        className="absolute right-0 top-1/2 w-[130px] -translate-y-1/2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ repeat: Infinity, duration: 2.4 }}
      >
        <div className="text-[11px] font-medium text-zinc-100">poema.txt</div>
        <div className="text-[10px] text-emerald-300">✦ Resucitado</div>
      </motion.div>
    </div>
  )
}

export function GhostsArt() {
  const dots = [
    { y: 0, label: '2008', text: 'tesis_borrador.wpd' },
    { y: 1, label: '2011', text: 'diario_viaje.txt' },
    { y: 2, label: '2019', text: 'poema.docx' }
  ]
  return (
    <div className="flex w-[360px] items-center gap-6" aria-hidden="true">
      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className={`${card} flex w-[140px] flex-col items-center gap-1 p-4`}>
        <GhostIcon className="h-10 w-10 text-violet-300" />
        <div className="text-[11px] font-medium text-zinc-100">carta_vieja.doc</div>
        <div className="text-[10px] text-zinc-500">hace 11 años sin abrir</div>
      </motion.div>
      <ol className="relative space-y-3 border-l border-violet-400/30 pl-4">
        {dots.map((d, i) => (
          <motion.li key={d.label} className="relative" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.5 }}>
            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,.8)]" />
            <div className="text-[10px] text-violet-300">{d.label}</div>
            <div className="text-[12px] text-zinc-200">{d.text}</div>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

export function PrivacyArt() {
  return (
    <div className="relative flex h-40 w-[360px] items-center justify-center" aria-hidden="true">
      <motion.svg viewBox="0 0 64 64" className="absolute left-[18%] top-3 h-12 w-12 text-zinc-600" animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ repeat: Infinity, duration: 3 }}>
        <path d="M20 44h26a10 10 0 0 0 1-20 14 14 0 0 0-27-3 11 11 0 0 0 0 23Z" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path d="M14 10l36 44" stroke="#f87171" strokeWidth="3" strokeLinecap="round" />
      </motion.svg>
      <motion.div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-emerald-400/30 bg-emerald-400/10" animate={{ boxShadow: ['0 0 0 rgba(52,211,153,0)', '0 0 32px rgba(52,211,153,.35)', '0 0 0 rgba(52,211,153,0)'] }} transition={{ repeat: Infinity, duration: 2.8 }}>
        <svg viewBox="0 0 24 24" className="h-12 w-12 text-emerald-300" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          <circle cx="12" cy="15.5" r="1.2" fill="currentColor" />
        </svg>
      </motion.div>
      <div className="absolute bottom-0 flex items-center gap-1.5 text-[11px] text-zinc-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        localhost
      </div>
    </div>
  )
}
