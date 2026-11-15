/** Tipos de archivo que OUIJA conoce. Puro y sin dependencias: lo usan el núcleo y la interfaz. */

export type FileKind =
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'text'
  | 'code'
  | 'data'
  | 'web'
  | 'ebook'
  | 'email'
  | 'image'
  | 'design'
  | 'audio'
  | 'video'
  | 'archive'
  | 'font'
  | 'executable'
  | 'other'

const TABLE: Record<Exclude<FileKind, 'other'>, string> = {
  document: 'doc docx dot dotx odt rtf pdf wpd wps wri ws lwp sdw pages',
  spreadsheet: 'xls xlsx xlsm xlsb ods csv tsv numbers',
  presentation: 'ppt pptx pps ppsx odp key',
  text: 'txt md markdown log rst tex nfo text',
  code:
    'py pyi js jsx mjs cjs ts tsx java kt kts c h cpp cc hpp cs go rs php rb swift sh bash zsh ps1 bat cmd css scss sass less vue svelte lua r dart scala pl gradle feature ipynb sql',
  data: 'json xml yaml yml toml ini cfg conf properties rels env plist',
  web: 'html htm xhtml mhtml',
  ebook: 'epub mobi azw azw3 djvu',
  email: 'eml msg mbox',
  image: 'jpg jpeg png gif webp bmp svg tif tiff heic heif avif ico raw cr2 nef dng xcf',
  design: 'psd ai xd fig sketch drawio eps indd dwg dxf',
  audio: 'mp3 wav flac ogg m4a aac wma opus mid midi aiff',
  video: 'mp4 mkv avi mov wmv webm flv m4v mpg mpeg 3gp',
  archive: 'zip rar 7z tar gz tgz bz2 xz arj lzh lha iso img cab jar war',
  font: 'ttf otf woff woff2 fntdata eot',
  executable: 'exe msi appimage deb rpm apk dmg bin run snap'
}

const KIND_BY_EXT = new Map<string, FileKind>()
export const EXTENSIONS_BY_KIND = {} as Record<FileKind, string[]>
for (const [kind, list] of Object.entries(TABLE) as [FileKind, string][]) {
  EXTENSIONS_BY_KIND[kind] = list.split(' ')
  for (const ext of EXTENSIONS_BY_KIND[kind]) KIND_BY_EXT.set(ext, kind)
}
EXTENSIONS_BY_KIND.other = []

export const ALL_KINDS = [...Object.keys(TABLE), 'other'] as FileKind[]

export function kindOf(ext: string): FileKind {
  return KIND_BY_EXT.get(ext.toLowerCase()) ?? 'other'
}

/** Archivos compilados, temporales o de sistema: no aportan nada al buscarlos y se omiten. */
const IGNORED_EXTENSIONS = new Set(
  'pyc pyo class o obj so dll dylib lib a ko map tmp temp part crdownload download swp swo pdb ilk exp d lock'.split(' ')
)
const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', 'ehthumbs.db', '.localized', 'icon\r'])

export function extensionOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function isIgnoredFile(name: string): boolean {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).toLowerCase()
  if (IGNORED_NAMES.has(base)) return true
  if (base.startsWith('~$')) return true // archivos de bloqueo de Office
  return IGNORED_EXTENSIONS.has(extensionOf(base))
}

/** Palabras (en español e inglés) con las que alguien puede referirse a cada tipo. Se indexan con el nombre. */
export const KIND_WORDS: Record<FileKind, string> = {
  document: 'documento document',
  spreadsheet: 'planilla hoja de cálculo excel spreadsheet',
  presentation: 'presentación diapositivas powerpoint slides presentation',
  text: 'texto text notas',
  code: 'código fuente programa script code source',
  data: 'datos configuración data config',
  web: 'página web html website',
  ebook: 'libro electrónico ebook book',
  email: 'correo email mensaje mail',
  image: 'imagen foto fotografía imagen image picture photo',
  design: 'diseño gráfico design graphic',
  audio: 'audio sonido música grabación audio sound music recording',
  video: 'video película clip video movie',
  archive: 'archivo comprimido respaldo comprimido archive backup',
  font: 'fuente tipografía font',
  executable: 'programa instalador ejecutable installer executable app',
  other: 'archivo file'
}

export const KIND_LABEL: Record<'es' | 'en', Record<FileKind, string>> = {
  es: {
    document: 'Documento',
    spreadsheet: 'Planilla',
    presentation: 'Presentación',
    text: 'Texto',
    code: 'Código',
    data: 'Datos',
    web: 'Página web',
    ebook: 'Libro',
    email: 'Correo',
    image: 'Imagen',
    design: 'Diseño',
    audio: 'Audio',
    video: 'Video',
    archive: 'Respaldo',
    font: 'Fuente',
    executable: 'Programa',
    other: 'Archivo'
  },
  en: {
    document: 'Document',
    spreadsheet: 'Spreadsheet',
    presentation: 'Presentation',
    text: 'Text',
    code: 'Code',
    data: 'Data',
    web: 'Web page',
    ebook: 'Book',
    email: 'Email',
    image: 'Image',
    design: 'Design',
    audio: 'Audio',
    video: 'Video',
    archive: 'Backup',
    font: 'Font',
    executable: 'Program',
    other: 'File'
  }
}
