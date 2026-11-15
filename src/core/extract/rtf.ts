import { CP437, CP850, decodeWithTable } from './codepages'

/** Destinos de RTF cuyo contenido no es texto del documento. */
const SKIP_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'generator',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'themedata',
  'datastore',
  'latentstyles',
  'colorschememapping',
  'fldinst',
  'bkmkstart',
  'bkmkend',
  'object',
  'xmlnstbl'
])

interface GroupState {
  skip: boolean
  /** Caracteres de reemplazo a omitir tras un \uN. */
  ucSkip: number
}

const CP1252 = new TextDecoder('windows-1252')

/** Convierte RTF a texto plano. `src` debe ser el contenido leído como latin1 (un byte por carácter). */
export function rtfToText(src: string): string {
  const out: string[] = []
  const stack: GroupState[] = []
  let state: GroupState = { skip: false, ucSkip: 1 }
  let uc = 1
  let dos: string | null = null // tabla de la página DOS declarada con \pc o \pca
  let pendingSkip = 0
  let i = 0

  const emit = (s: string) => {
    if (!state.skip && s) out.push(s)
  }

  while (i < src.length) {
    const ch = src[i]
    if (pendingSkip > 0 && ch !== '\\' && ch !== '{' && ch !== '}') {
      if (ch !== '\r' && ch !== '\n') pendingSkip--
      i++
      continue
    }
    if (ch === '{') {
      stack.push(state)
      state = { ...state }
      i++
    } else if (ch === '}') {
      state = stack.pop() ?? state
      i++
    } else if (ch === '\\') {
      const next = src[i + 1]
      if (next === undefined) break
      if (next === "'") {
        const byte = Number.parseInt(src.slice(i + 2, i + 4), 16)
        if (!Number.isNaN(byte)) {
          if (pendingSkip > 0) pendingSkip--
          else emit(dos ? decodeWithTable(Buffer.from([byte]), dos) : CP1252.decode(Buffer.from([byte])))
        }
        i += 4
      } else if (next === '\\' || next === '{' || next === '}') {
        if (pendingSkip > 0) pendingSkip--
        else emit(next)
        i += 2
      } else if (next === '*') {
        state.skip = true
        i += 2
      } else if (next === '~') {
        emit('\u00a0')
        i += 2
      } else if (next === '-' || next === '_') {
        emit(next === '_' ? '-' : '')
        i += 2
      } else if (next === '\n' || next === '\r') {
        emit('\n')
        i += 2
      } else if (/[a-zA-Z]/.test(next)) {
        let j = i + 1
        while (j < src.length && /[a-zA-Z]/.test(src[j])) j++
        const word = src.slice(i + 1, j)
        let k = j
        if (src[k] === '-') k++
        while (k < src.length && /\d/.test(src[k])) k++
        const param = k > j ? Number.parseInt(src.slice(j, k), 10) : undefined
        if (src[k] === ' ') k++
        i = k

        if (SKIP_DESTINATIONS.has(word)) state.skip = true
        else if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') emit('\n')
        else if (word === 'tab') emit('\t')
        else if (word === 'emdash') emit('—')
        else if (word === 'endash') emit('–')
        else if (word === 'bullet') emit('•')
        else if (word === 'lquote') emit('‘')
        else if (word === 'rquote') emit('’')
        else if (word === 'ldblquote') emit('“')
        else if (word === 'rdblquote') emit('”')
        else if (word === 'uc' && param !== undefined) {
          uc = param
          state.ucSkip = param
        } else if (word === 'u' && param !== undefined) {
          const code = param < 0 ? param + 65536 : param
          emit(String.fromCharCode(code))
          pendingSkip = state.ucSkip || uc
        } else if (word === 'pc') dos = CP437
        else if (word === 'pca') dos = CP850
      } else {
        i += 2
      }
    } else if (ch === '\r' || ch === '\n') {
      i++
    } else {
      emit(ch)
      i++
    }
  }

  return out.join('')
}
