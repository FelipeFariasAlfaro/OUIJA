import process from 'node:process'
// Genera los íconos de OUIJA (fantasma con los brazos arriba) a partir de un SVG: aplicación, bandeja y logo.
// Uso: node scripts/make-icons.mjs   (necesita Chromium de Playwright)
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BODY =
  'M50 4C34 4 25 16 23 33L15 30C9 27 5 32 8 38L18 56C19 70 18 80 20 90C26 96 32 90 38 93C44 96 50 90 56 93C62 96 70 91 76 90C86 88 93 86 93 80C90 72 84 62 81 54L90 40C94 34 91 25 86 26C82 27 80 31 79 34C77 17 68 4 50 4Z'
const EYES = [
  'M31 19C37 22 43 25 43 29C40 31 36 31 33 29C30 26 30 22 31 19Z',
  'M66 19C60 22 55 25 54 28C57 31 61 31 64 29C67 26 67 22 66 19Z'
]
const MOUTH = 'M32 35C40 38 58 37 65 34C64 40 62 44 60 46L56 43L52 48L48 43L44 49L40 44L37 47C34 43 32 39 32 35Z'
const FACE = [...EYES, MOUTH]

const svg = (size, inner, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${bg}${inner}</svg>`

// Logo: fantasma blanco con la cara oscura sobre fondo transparente.
const logo = svg(512, `<path d="${BODY}" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>${FACE.map((d) => `<path d="${d}" fill="#14102b"/>`).join('')}`)

// Aplicación: cuadrado redondeado violeta con degradado y el fantasma.
const appIcon = svg(
  512,
  `<g transform="translate(14 12) scale(.72)"><path d="${BODY}" fill="#faf8ff" stroke="#faf8ff" stroke-width="2" stroke-linejoin="round"/>${FACE.map((d) => `<path d="${d}" fill="#281a5a"/>`).join('')}</g>`,
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#4c1d95"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(#g)"/>'
)

// Bandeja: fantasma blanco con la cara vaciada (se ve bien en barras oscuras).
const trayIcon = (size) =>
  svg(size, `<path fill-rule="evenodd" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round" d="${BODY} ${FACE.join(' ')}"/>`)

mkdirSync('resources', { recursive: true })
writeFileSync('resources/logo.svg', logo)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage()
async function shot(markup, size, file) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`)
  writeFileSync(file, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }))
}
await shot(appIcon, 512, 'resources/icon.png')
await shot(trayIcon(32), 32, 'resources/tray.png')
await shot(trayIcon(64), 64, 'resources/tray@2x.png')
await browser.close()
console.log('Íconos generados en resources/')
