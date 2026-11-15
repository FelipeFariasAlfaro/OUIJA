/** Mitad alta (0x80 a 0xFF) de las páginas de códigos DOS más comunes. 128 caracteres cada una. */

export const CP437 =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0'

export const CP850 =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜø£Ø×ƒ' +
  'áíóúñÑªº¿®¬½¼¡«»' +
  '░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
  '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤' +
  'ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀' +
  'ÓßÔÒõÕµþÞÚÛÙýÝ¯´' +
  '\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0'

export function decodeWithTable(buf: Buffer, table: string): string {
  const chunks: string[] = []
  const STEP = 1 << 15
  for (let start = 0; start < buf.length; start += STEP) {
    const end = Math.min(buf.length, start + STEP)
    let s = ''
    for (let i = start; i < end; i++) {
      const b = buf[i]
      s += b < 0x80 ? String.fromCharCode(b) : table[b - 0x80]
    }
    chunks.push(s)
  }
  return chunks.join('')
}
