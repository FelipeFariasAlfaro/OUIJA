import type { CryptFile, CryptReport } from '@shared/ipc'
import type { Dict } from '../i18n'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * El grimorio de memorias como HTML autónomo para imprimir a PDF: pergamino envejecido, tinta oscura,
 * títulos en violeta sangre y una lápida en la portada. Sin scripts ni recursos externos (las fotos van
 * como data URL). Todo el texto se escapa.
 */
export function grimoireHtml(r: CryptReport, opts: { t: Dict; locale: string; epitaph: string; portraits: (string | null)[]; fmtDate: (ms: number) => string }): string {
  const { t, epitaph, portraits, fmtDate } = opts
  const year = (ms?: number) => (ms ? String(new Date(ms).getUTCFullYear()) : '')
  const file = (f: CryptFile) =>
    `<li><span class="n">${esc(f.name)}</span>${f.resurrected ? ` <span class="res">✦ ${esc(t.resurrected)}</span>` : ''}<span class="d"> · ${esc(fmtDate(f.date))}</span>${f.summary ? `<div class="s">${esc(f.summary)}</div>` : ''}</li>`
  const voiceLabel = (f: CryptFile) => (f.origin === 'msn' ? t.cryptVoiceMsn : f.origin === 'mbox' ? t.cryptVoiceMbox : f.origin === 'outlook-express' ? t.cryptVoiceOE : t.cryptVoiceMail)
  const pics = r.portraits
    .map((p, i) => ({ p, src: portraits[i] }))
    .filter((x) => x.src)
    .slice(0, 12)
    .map((x) => `<figure><img src="${x.src}" alt=""/><figcaption>${esc(x.p.name)}<br/>${esc(fmtDate(x.p.date))}</figcaption></figure>`)
    .join('')
  return `<!doctype html><html lang="${esc(opts.locale)}"><head><meta charset="utf-8"/><title>${esc(t.cryptGrimoire(r.name))}</title><style>
@page { size: A4; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #2a1d18; background: #efe3c8 }
.page { padding: 22mm 20mm; min-height: 297mm; background: radial-gradient(ellipse at 50% 40%, #f4ead2 0%, #e9d9b6 60%, #d9c39a 100%); position: relative; page-break-after: always }
.page:last-child { page-break-after: auto }
.cover { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center }
.cover h1 { font-size: 40px; letter-spacing: 6px; color: #4a1530; margin: 18px 0 4px }
.cover .sub { font-style: italic; color: #6b4a3a }
.tomb { width: 120px; height: 150px; border-radius: 60px 60px 6px 6px; background: linear-gradient(160deg, #6e6680, #2f2a3a); margin: 0 auto; color: #d8d0ea; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 8px 0 #3a2f22 }
.tomb b { font-size: 22px; letter-spacing: 4px }
.epitaph { margin: 28px auto 0; max-width: 130mm; font-size: 16px; line-height: 1.6; font-style: italic; border-top: 1px solid #a88f6a; border-bottom: 1px solid #a88f6a; padding: 14px 0 }
h2 { color: #4a1530; font-size: 20px; letter-spacing: 2px; border-bottom: 1px solid #b59a72; padding-bottom: 4px; margin: 22px 0 10px }
h2::before { content: '✝ '; color: #7a2a3a }
.year { margin: 0 0 14px; break-inside: avoid }
.year h3 { margin: 0 0 4px; font-size: 18px; color: #3d2a20 }
.year h3 small { font-weight: normal; color: #7b5f49; font-size: 12px }
ul { margin: 0; padding-left: 18px } li { margin: 3px 0; font-size: 12.5px }
.n { font-weight: bold } .d { color: #7b5f49 } .s { color: #4b3a30; font-size: 11.5px; margin-top: 1px }
.res { color: #2f6b4a; font-size: 11px }
.chips span { display: inline-block; border: 1px solid #b59a72; border-radius: 12px; padding: 1px 9px; margin: 2px 4px 2px 0; font-size: 12px }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px }
figure { margin: 0; break-inside: avoid } figure img { width: 100%; height: 34mm; object-fit: cover; border: 3px solid #fff8e8; box-shadow: 0 1px 3px rgba(0,0,0,.35); filter: sepia(.35) }
figcaption { font-size: 10px; color: #6b4a3a; margin-top: 2px }
.foot { position: absolute; bottom: 10mm; left: 0; right: 0; text-align: center; font-size: 10px; color: #8a6f55 }
</style></head><body>
<section class="page cover">
  <div class="tomb"><b>R.I.P.</b><span>${esc(year(r.from))} – ${esc(year(r.to))}</span></div>
  <h1>${esc(t.cryptGrimoire(r.name))}</h1>
  <div class="sub">${esc(t.cryptFiles(r.files))} · ${esc(year(r.from))} – ${esc(year(r.to))}</div>
  ${epitaph ? `<div class="epitaph">${esc(epitaph)}</div>` : ''}
  <div class="foot">OUIJA</div>
</section>
<section class="page">
  ${r.souls.length ? `<h2>${esc(t.cryptSouls)}</h2><div class="chips">${r.souls.map((s) => `<span>${esc(s.name)} · ${s.files}</span>`).join('')}</div>` : ''}
  ${r.places.length ? `<h2>${esc(t.cryptPlaces)}</h2><div class="chips">${r.places.map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : ''}
  <h2>${esc(t.cryptYears)}</h2>
  ${r.years.map((y) => `<div class="year"><h3>${y.year} <small>${esc(t.cryptFiles(y.count))}${y.people.length ? ` · ${esc(y.people.join(', '))}` : ''}</small></h3><ul>${y.highlights.map(file).join('')}</ul></div>`).join('')}
</section>
${pics ? `<section class="page"><h2>${esc(t.cryptPortraits)}</h2><div class="grid">${pics}</div></section>` : ''}
${r.voices.length || r.resurrected.length ? `<section class="page">
  ${r.voices.length ? `<h2>${esc(t.cryptVoices)}</h2><ul>${r.voices.map((v) => `<li><span class="n">${esc(v.name)}</span> <span class="d">· ${esc(voiceLabel(v))} · ${esc(fmtDate(v.date))}</span>${v.summary ? `<div class="s">${esc(v.summary)}</div>` : ''}</li>`).join('')}</ul>` : ''}
  ${r.resurrected.length ? `<h2>${esc(t.cryptResurrected(r.resurrectedCount))}</h2><ul>${r.resurrected.map(file).join('')}</ul>` : ''}
</section>` : ''}
</body></html>`
}
