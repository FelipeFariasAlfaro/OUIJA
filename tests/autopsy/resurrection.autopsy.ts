/**
 * Autopsia: un informe reproducible de lo que OUIJA logra sobre `fixtures/chaos/`.
 * - Resurrección: cuántos archivos en formatos muertos o dañados vuelven a leerse, frente a abrirlos como texto.
 * - Búsqueda: recall@1, recall@5 y MRR de 12 preguntas (español e inglés), solo con palabras y con significado.
 * Escribe `docs/AUTOPSY.md`. Uso: `npm run autopsy` (con Ollama y `bge-m3` para la columna semántica).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OllamaClient } from '@core/ai/ollama'
import { Orchestrator } from '@core/ai/orchestrator'
import { IndexPipeline, type Embedder } from '@core/indexing'
import { openContainer, parseVPath } from '@core/media'
import { SqliteStore } from '@core/memory'

const ROOT = resolve('fixtures/chaos')
const p = (rel: string) => join(ROOT, rel)

/** Archivos que ningún editor de texto lee bien hoy, y una frase que prueba que volvieron. */
const DEAD = [
  { file: 'Respaldos/escritorio-2008.zip::Tesis/tesis_borrador_v2.wpd', what: 'WordPerfect (1990s) inside a 2008 ZIP', phrase: 'Rosa Campos' },
  { file: 'Respaldos/escritorio-2008.zip::Poemas/rosa_v1.txt', what: 'DOS text (CP437) inside a ZIP', phrase: 'Concepción' },
  { file: 'Antiguos/diario_viaje_peru.txt', what: 'Mojibake (UTF-8 read as Latin-1)', phrase: 'negó' },
  { file: 'Messenger/historial_rosa.xml', what: 'MSN Messenger history (2006)', phrase: 'Felipe → Rosa' },
  { file: 'Outlook Express/Bandeja de entrada.dbx', what: 'Outlook Express folder (2004)', phrase: 'Correcciones de la tesis' },
  { file: 'Correo/familia.mbox', what: 'mbox mailbox (2009)', phrase: 'Subject: La receta de la abuela' },
  { file: 'Personal/borrador_final3.rtf', what: 'RTF', phrase: 'Tus manos guardan la luz de marzo' }
]

const QUESTIONS: { q: string; expect: string[] }[] = [
  { q: '¿dónde está el poema para Rosa?', expect: ['borrador_final3.rtf', 'rosa_v1.txt'] },
  { q: 'agradecimientos de la tesis', expect: ['tesis_borrador_v2.wpd'] },
  { q: 'lo que hablé con Rosa del disquete azul', expect: ['historial_rosa.xml'] },
  { q: 'la receta de la abuela que me mandó mi mamá', expect: ['familia.mbox'] },
  { q: 'correo del profesor con correcciones', expect: ['Bandeja de entrada.dbx'] },
  { q: 'contrato del departamento', expect: ['contrato_arriendo_2015.txt'] },
  { q: 'diario del viaje a Perú', expect: ['diario_viaje_peru.txt'] },
  { q: 'logo de haka lens', expect: ['Logo Haka Lens blanco (1).png'] },
  { q: 'audio de camila', expect: ['ElevenLabs_2026-11-13T22_56_23_Camila_pvc.mp3'] },
  { q: 'chocolate cake recipe', expect: ['receta_torta.txt'] },
  { q: 'the poem I wrote for Rosa', expect: ['borrador_final3.rtf', 'rosa_v1.txt'] },
  { q: 'flat lease agreement', expect: ['contrato_arriendo_2015.txt'] }
]

/** Sin modelo: vectores vacíos, para medir la búsqueda solo por palabras. */
const NO_MEANING: Embedder & { probeDimensions(): Promise<number> } = {
  embed: async (texts) => texts.map(() => new Float32Array(8)),
  probeDimensions: async () => 8
}

async function rawBytes(path: string): Promise<Buffer> {
  const { container, inner } = parseVPath(path)
  if (!inner) return readFileSync(container)
  // Lo que vería alguien que abre el ZIP con un editor: los bytes comprimidos.
  return readFileSync(container)
}

async function semanticEmbedder(): Promise<(Embedder & { probeDimensions(): Promise<number> }) | null> {
  try {
    const client = new OllamaClient({})
    const models = await client.listModels()
    return models.some((m) => m.startsWith('bge-m3')) ? client : null
  } catch {
    return null
  }
}

async function run(embedder: Embedder & { probeDimensions(): Promise<number> }) {
  const store = new SqliteStore(':memory:', { dimensions: await embedder.probeDimensions() })
  const started = Date.now()
  const report = await new IndexPipeline({ store, embedder }).indexFolder(ROOT)
  const indexMs = Date.now() - started
  const orchestrator = new Orchestrator({ store, embedder })
  let hit1 = 0
  let hit5 = 0
  let rr = 0
  const rows: string[] = []
  for (const { q, expect: wanted } of QUESTIONS) {
    const r = await orchestrator.ask(q, { lang: 'es', now: new Date('2026-11-16') })
    const names = r.matches.map((m) => {
      const { container, inner } = parseVPath(m.doc.path)
      return (inner ?? container).split('/').pop() as string
    })
    const rank = names.findIndex((n) => wanted.includes(n))
    if (rank === 0) hit1++
    if (rank >= 0 && rank < 5) hit5++
    if (rank >= 0) rr += 1 / (rank + 1)
    rows.push(`${q} → ${rank >= 0 ? `#${rank + 1} ${names[rank]}` : 'miss'}`)
  }
  const n = QUESTIONS.length
  return { store, indexMs, files: report.indexed, recall1: hit1 / n, recall5: hit5 / n, mrr: rr / n, rows }
}

const pct = (x: number) => `${Math.round(x * 100)}%`

describe('autopsia de OUIJA sobre fixtures/chaos', () => {
  it('resurrección, búsqueda y velocidad; escribe docs/AUTOPSY.md', async () => {
    execFileSync('node', ['scripts/make-fixtures.mjs'])
    const lexical = await run(NO_MEANING)
    const semanticClient = await semanticEmbedder()
    const semantic = semanticClient ? await run(semanticClient) : null

    // Resurrección: el texto que OUIJA recupera frente al que se ve abriendo los bytes como texto.
    const dead: { what: string; plain: boolean; ouija: boolean }[] = []
    for (const d of DEAD) {
      const text = (await lexical.store.getText(p(d.file))) ?? ''
      const plain = (await rawBytes(p(d.file))).toString('utf8').includes(d.phrase)
      dead.push({ what: d.what, plain, ouija: text.includes(d.phrase) })
    }
    // Fecha real de la foto (EXIF) frente a la del archivo copiado.
    const photo = await lexical.store.getDoc(p('Fotos/cusco_valle.jpg'))
    const exifOk = photo?.born !== undefined && new Date(photo.born).getUTCFullYear() === 2011
    const zipEntries = (await openContainer(p('Respaldos/escritorio-2008.zip'))).entries.length

    const recovered = dead.filter((d) => d.ouija).length
    const plainRecovered = dead.filter((d) => d.plain).length
    const date = new Date().toISOString().slice(0, 10)
    const md = `# Autopsy report

Reproducible measurements of what OUIJA recovers and finds in \`fixtures/chaos/\` (${lexical.files} files, including a 2008 ZIP backup with ${zipEntries} entries). Run it yourself with \`npm run autopsy\`. Generated on ${date} on a machine with ${cpus().length} CPU threads and ${Math.round(totalmem() / 1024 ** 3)} GB of RAM.

## Resurrection of dead formats

Each file holds a known phrase. "Opened as text" is what you see opening the bytes in a text editor today.

| File | Opened as text | OUIJA |
|---|---|---|
${dead.map((d) => `| ${d.what} | ${d.plain ? 'readable' : '✗ unreadable'} | ${d.ouija ? '✦ resurrected' : '✗'} |`).join('\n')}
| Photo copied in 2020, taken in 2011 (EXIF date) | 2020 | ${exifOk ? '✦ 2011' : '✗'} |

**${recovered} of ${dead.length}** dead or damaged files come back with their text (opening them as text: ${plainRecovered} of ${dead.length}).

## Finding files by what you remember

${QUESTIONS.length} questions in Spanish and English, without file names. Recall@k is the share of questions whose file appears in the first k results; MRR is the mean reciprocal rank.

| | Recall@1 | Recall@5 | MRR | Indexing time |
|---|---|---|---|---|
| Keywords only | ${pct(lexical.recall1)} | ${pct(lexical.recall5)} | ${lexical.mrr.toFixed(2)} | ${(lexical.indexMs / 1000).toFixed(1)} s |
| OUIJA (meaning + keywords, \`bge-m3\`) | ${semantic ? pct(semantic.recall1) : 'n/a'} | ${semantic ? pct(semantic.recall5) : 'n/a'} | ${semantic ? semantic.mrr.toFixed(2) : 'n/a'} | ${semantic ? `${(semantic.indexMs / 1000).toFixed(1)} s` : 'n/a'} |

${semantic ? '' : '_The semantic row needs Ollama with `bge-m3` running locally._\n'}
<details><summary>Per-question results</summary>

| Question | Keywords only | OUIJA |
|---|---|---|
${QUESTIONS.map((q, i) => `| ${q.q} | ${lexical.rows[i].split(' → ')[1]} | ${semantic ? semantic.rows[i].split(' → ')[1] : 'n/a'} |`).join('\n')}

</details>
`
    writeFileSync('docs/AUTOPSY.md', md)
    console.info(md)

    expect(recovered).toBe(dead.length)
    expect(plainRecovered).toBeLessThan(dead.length)
    expect(exifOk).toBe(true)
    if (semantic) {
      expect(semantic.recall5).toBeGreaterThanOrEqual(lexical.recall5)
      expect(semantic.recall5).toBeGreaterThanOrEqual(0.8)
    }
    await lexical.store.close()
    await semantic?.store.close()
  })
})
