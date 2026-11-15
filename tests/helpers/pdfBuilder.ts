/** PDF mínimo de una página con texto ASCII, para pruebas. */
export function buildPdf(
  lines: string[],
  { fontSize = 12, width = 300, height = 200 }: { fontSize?: number; width?: number; height?: number } = {}
): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&')
  const content =
    `BT /F1 ${fontSize} Tf 20 ${height - fontSize - 20} Td ${Math.round(fontSize * 1.4)} TL ` + lines.map((l) => `(${esc(l)}) Tj T*`).join(' ') + ' ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
