import { basename } from 'node:path'
import type { ResolvedEntity } from '@core/entities'
import type { IndexedDoc } from '@core/memory'
import { parseVPath } from '@core/media'
import { kindOf, type FileKind } from '@shared/filetypes'
import type { CryptFile, CryptReport } from '@shared/ipc'

const MAX_HIGHLIGHTS_PER_YEAR = 5
const MAX_PORTRAITS = 24
const MAX_VOICES = 30
const MAX_RESURRECTED = 30
const MAX_SOULS = 16
const MAX_PLACES = 12

/** Qué tan "memorable" es un archivo para el grimorio: lo rescatado y lo que tiene resumen, primero. */
const KIND_WEIGHT: Partial<Record<FileKind, number>> = { document: 5, email: 5, text: 4, image: 3, presentation: 3, spreadsheet: 2, audio: 2, video: 2, ebook: 2 }

export function cryptFile(doc: IndexedDoc): CryptFile {
  const { container, inner } = parseVPath(doc.path)
  return {
    name: basename(inner ?? container),
    path: doc.path,
    container: inner ? container : undefined,
    ext: doc.ext,
    kind: kindOf(doc.ext),
    date: doc.born ?? doc.mtime,
    summary: doc.summary,
    resurrected: doc.resurrected || undefined,
    origin: doc.origin
  }
}

const score = (f: CryptFile): number => (f.resurrected ? 4 : 0) + (f.origin ? 3 : 0) + (f.summary ? 2 : 0) + (KIND_WEIGHT[f.kind] ?? 0)

export interface CryptInput {
  folder: string
  docs: IndexedDoc[]
  people: ResolvedEntity[]
  places: ResolvedEntity[]
  ghosts: number
}

/**
 * Arma el contenido de una cripta (la "herencia digital" de una carpeta): años, almas que la habitan,
 * retratos, voces, lo resucitado y los fantasmas. Solo usa datos del índice; no inventa nada.
 */
export function buildCrypt({ folder, docs, people, places, ghosts }: CryptInput): CryptReport {
  const files = docs.filter((d) => !d.error || d.summary).map(cryptFile)
  const inside = new Set(files.map((f) => f.path))
  const peopleByFile = new Map<string, string[]>()
  const souls: CryptReport['souls'] = []
  for (const p of people) {
    const here = p.paths.filter((path) => inside.has(path))
    if (here.length === 0) continue
    souls.push({ name: p.name, files: here.length })
    for (const path of here) peopleByFile.set(path, [...(peopleByFile.get(path) ?? []), p.name])
  }
  souls.sort((a, b) => b.files - a.files || a.name.localeCompare(b.name))

  const byYear = new Map<number, CryptFile[]>()
  for (const f of files) {
    const y = new Date(f.date).getUTCFullYear()
    byYear.set(y, [...(byYear.get(y) ?? []), f])
  }
  const years = [...byYear]
    .sort((a, b) => a[0] - b[0])
    .map(([year, list]) => {
      const people = new Map<string, number>()
      for (const f of list) for (const n of peopleByFile.get(f.path) ?? []) people.set(n, (people.get(n) ?? 0) + 1)
      return {
        year,
        count: list.length,
        highlights: [...list].sort((a, b) => score(b) - score(a) || a.date - b.date).slice(0, MAX_HIGHLIGHTS_PER_YEAR),
        people: [...people].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n)
      }
    })

  const kinds = new Map<FileKind, number>()
  for (const f of files) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1)
  const dates = files.map((f) => f.date)
  const byDate = (a: CryptFile, b: CryptFile) => a.date - b.date

  return {
    folder,
    name: basename(folder) || folder,
    files: files.length,
    from: dates.length ? Math.min(...dates) : undefined,
    to: dates.length ? Math.max(...dates) : undefined,
    years,
    souls: souls.slice(0, MAX_SOULS),
    places: places
      .map((p) => ({ name: p.name, n: p.paths.filter((path) => inside.has(path)).length }))
      .filter((p) => p.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, MAX_PLACES)
      .map((p) => p.name),
    portraits: files.filter((f) => f.kind === 'image').sort(byDate).slice(0, MAX_PORTRAITS),
    voices: files.filter((f) => f.origin || f.kind === 'email').sort(byDate).slice(0, MAX_VOICES),
    resurrected: files.filter((f) => f.resurrected).sort(byDate).slice(0, MAX_RESURRECTED),
    resurrectedCount: files.filter((f) => f.resurrected).length,
    ghosts,
    kinds: [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count)
  }
}

/** Instrucciones para que un modelo escriba el epitafio usando solo los datos de la cripta. */
export function epitaphPrompt(report: CryptReport, language: string): string {
  const facts = [
    `Carpeta: ${report.name}`,
    `Archivos: ${report.files}`,
    report.from && report.to ? `Desde ${new Date(report.from).getUTCFullYear()} hasta ${new Date(report.to).getUTCFullYear()}` : '',
    `Archivos por año: ${report.years.map((y) => `${y.year}: ${y.count}`).join(', ')}`,
    report.souls.length ? `Personas que más aparecen: ${report.souls.slice(0, 8).map((s) => s.name).join(', ')}` : '',
    report.places.length ? `Lugares y proyectos: ${report.places.slice(0, 8).join(', ')}` : '',
    `Archivos resucitados de formatos muertos: ${report.resurrectedCount}`,
    'Algunos archivos:',
    ...report.years.flatMap((y) => y.highlights.filter((h) => h.summary).slice(0, 2).map((h) => `- ${y.year}, ${h.name}: ${h.summary}`)).slice(0, 14)
  ].filter(Boolean)
  return [
    `Escribe en ${language} el epitafio de un "grimorio de memorias": dos o tres frases cortas (máximo 60 palabras), solemnes y cálidas, con un leve tono de cuento de fantasmas.`,
    'Usa SOLO los datos de abajo. No inventes personas, lugares, fechas, climas ni hechos que no estén escritos aquí. No uses listas ni comillas. Responde solo con el texto.',
    '',
    ...facts
  ].join('\n')
}
