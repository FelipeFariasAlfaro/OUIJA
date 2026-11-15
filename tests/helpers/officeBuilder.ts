import { buildZip } from './zipBuilder'

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** Libro de Excel mínimo con una hoja. */
export function buildXlsx(rows: (string | number)[][], sheetName = 'Presupuesto'): Buffer {
  const shared: string[] = []
  const idx = (s: string) => {
    const i = shared.indexOf(s)
    return i >= 0 ? i : shared.push(s) - 1
  }
  const sheetRows = rows
    .map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = `${String.fromCharCode(65 + c)}${r + 1}`
        return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${idx(v)}</v></c>`
      })
      return `<row r="${r + 1}">${cells.join('')}</row>`
    })
    .join('')
  return buildZip([
    { name: 'xl/workbook.xml', data: `<workbook><sheets><sheet name="${x(sheetName)}" sheetId="1"/></sheets></workbook>` },
    { name: 'xl/sharedStrings.xml', data: `<sst>${shared.map((s) => `<si><t>${x(s)}</t></si>`).join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', data: `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>` }
  ])
}

export function buildPptx(slides: string[][]): Buffer {
  return buildZip(
    slides.map((paragraphs, i) => ({
      name: `ppt/slides/slide${i + 1}.xml`,
      data: `<p:sld><p:cSld><p:spTree><p:sp><p:txBody>${paragraphs.map((p) => `<a:p><a:r><a:t>${x(p)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    }))
  )
}

export function buildOdt(paragraphs: string[]): Buffer {
  return buildZip([{ name: 'content.xml', data: `<office:document-content><office:body><office:text>${paragraphs.map((p) => `<text:p>${x(p)}</text:p>`).join('')}</office:text></office:body></office:document-content>` }])
}

export function buildEpub(chapters: string[]): Buffer {
  return buildZip(chapters.map((html, i) => ({ name: `OEBPS/cap${i + 1}.xhtml`, data: `<html><head><title>x</title></head><body>${html}</body></html>` })))
}
