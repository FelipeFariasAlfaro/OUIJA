import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, cp, link, lstat, mkdir, opendir, readdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, win32 } from 'node:path'
import type { RestoreFailure, RestoreOutcome } from '@shared/ipc'

/** Un elemento de la papelera, con lo necesario para mostrarlo y traerlo de vuelta. */
export interface TrashItem {
  /** Estable mientras el elemento siga en la papelera. */
  id: string
  name: string
  originalPath?: string
  trashedAt?: number
  size: number
  sizeApprox: boolean
  isDir: boolean
  ext: string
  /** Dónde está ahora (dentro de la papelera). */
  payload: string
  /** Archivos de metadatos que se borran al resucitarlo. */
  meta: string[]
}

export interface TrashDeps {
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
  uid?: number
  /** Puntos de montaje donde buscar papeleras de discos externos (Linux). Por defecto, los de /proc/mounts. */
  mounts?: string[]
  /** Carpetas `$Recycle.Bin` donde buscar (Windows). Por defecto, las de cada unidad. */
  recycleBins?: string[]
  /** Reemplazables en pruebas para forzar fallos de cambio de disco. */
  ops?: Partial<MoveOps>
}

export interface MoveOps {
  link: typeof link
  rename: typeof rename
  copyFile: typeof copyFile
  cp: typeof cp
}

const MAX_ITEMS = 5000
const DIR_SIZE_LIMIT = 4000

const idOf = (payload: string): string => createHash('sha1').update(payload).digest('hex').slice(0, 16)

/** `/ruta/con%20espacios` → `/ruta/con espacios`. Devuelve `undefined` si no se puede decodificar. */
export function decodeTrashPath(raw: string): string | undefined {
  try {
    return raw.split('/').map((p) => decodeURIComponent(p)).join('/')
  } catch {
    return undefined
  }
}

/** Una ruta original solo vale si es absoluta y no se sale con `..`. */
export function safeOriginalPath(path: string | undefined, windows = false): string | undefined {
  if (!path || path.includes('\0')) return undefined
  const parts = path.split(windows ? /[\\/]/ : '/')
  if (parts.includes('..')) return undefined
  return (windows ? /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') : isAbsolute(path)) ? path : undefined
}

/** Lee un `.trashinfo` del estándar freedesktop. `topdir` es la raíz del disco para papeleras de discos externos. */
export function parseTrashInfo(text: string, topdir?: string): { originalPath?: string; trashedAt?: number } {
  const lines = text.split(/\r?\n/)
  const get = (key: string) => lines.find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1).trim()
  const raw = get('Path')
  let originalPath: string | undefined
  if (raw) {
    const decoded = decodeTrashPath(raw)
    // En las papeleras de discos externos la ruta es relativa a la raíz del disco.
    originalPath = decoded === undefined ? undefined : safeOriginalPath(decoded.startsWith('/') ? decoded : topdir ? join(topdir, decoded) : undefined)
  }
  const date = get('DeletionDate')
  // Sin zona horaria: es la hora local de quien borró, que es justo cómo la interpreta `Date`.
  const trashedAt = date && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(date) ? new Date(date).getTime() : undefined
  return { originalPath, trashedAt: trashedAt !== undefined && Number.isFinite(trashedAt) ? trashedAt : undefined }
}

/** Lee un `$I…` de la Papelera de Windows (versiones 1 y 2). */
export function parseRecycleInfo(buf: Buffer): { originalPath?: string; trashedAt?: number; size?: number } | undefined {
  if (buf.length < 28) return undefined
  const version = Number(buf.readBigInt64LE(0))
  const size = Number(buf.readBigInt64LE(8))
  const filetime = buf.readBigUInt64LE(16)
  // FILETIME: intervalos de 100 ns desde 1601. Se pasa a ms desde 1970.
  const trashedAt = Number(filetime / 10000n) - 11644473600000
  let text: string
  if (version === 1) text = buf.subarray(24, Math.min(buf.length, 24 + 520)).toString('utf16le')
  else if (version === 2) {
    const chars = buf.readUInt32LE(24)
    text = buf.subarray(28, 28 + chars * 2).toString('utf16le')
  } else return undefined
  const originalPath = safeOriginalPath(text.split('\0')[0], true)
  return { originalPath, trashedAt: trashedAt > 0 && trashedAt < 4e12 ? trashedAt : undefined, size: size >= 0 ? size : undefined }
}

/**
 * Mueve sin pisar nunca nada que ya exista. `link` falla si el destino existe, así que dos
 * personas o procesos no pueden pisarse ni siquiera en una carrera.
 */
export async function moveNoClobber(src: string, dest: string, isDir: boolean, ops: Partial<MoveOps> = {}): Promise<void> {
  const o: MoveOps = { link, rename, copyFile, cp, ...ops }
  if (isDir) {
    await mkdir(dest) // falla si ya existe
    try {
      await o.rename(src, dest) // reemplaza la carpeta vacía que acabamos de crear
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        await rm(dest, { recursive: true, force: true })
        throw error
      }
      // `dest` es la carpeta vacía que acabamos de crear: se copia dentro, sin sobrescribir nada.
      await o.cp(src, dest, { recursive: true, force: false, preserveTimestamps: true })
      await rm(src, { recursive: true, force: true })
    }
    return
  }
  try {
    await o.link(src, dest)
    await unlink(src)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw error
    // Otro disco, o un sistema de archivos sin enlaces duros: se copia (sin pisar) y recién entonces se borra el original.
    await o.copyFile(src, dest, constants.COPYFILE_EXCL)
    await unlink(src)
  }
}

/** Busca un nombre libre: `foto.png`, `foto (resucitado).png`, `foto (resucitado 2).png`… */
export async function freeName(dir: string, name: string): Promise<{ path: string; renamed: boolean }> {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let n = 0; n < 1000; n++) {
    const candidate = n === 0 ? name : `${stem} (resucitado${n > 1 ? ` ${n}` : ''})${ext}`
    const path = join(dir, candidate)
    try {
      await lstat(path)
    } catch {
      return { path, renamed: n > 0 }
    }
  }
  throw new Error('No se encontró un nombre libre')
}

async function sizeOf(path: string, isDir: boolean): Promise<{ size: number; approx: boolean }> {
  if (!isDir) return { size: (await lstat(path)).size, approx: false } // lstat: un enlace simbólico no hereda el tamaño de su destino
  let total = 0
  let seen = 0
  const stack = [path]
  while (stack.length > 0 && seen < DIR_SIZE_LIMIT) {
    const dir = stack.pop() as string
    let handle
    try {
      handle = await opendir(dir)
    } catch {
      continue
    }
    for await (const entry of handle) {
      if (++seen > DIR_SIZE_LIMIT) break
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) total += (await stat(full).catch(() => ({ size: 0 }))).size
    }
  }
  return { size: total, approx: seen >= DIR_SIZE_LIMIT }
}

/** Lee y restaura la papelera del sistema: freedesktop en Linux y la Papelera de reciclaje en Windows. */
export class TrashService {
  private readonly platform: NodeJS.Platform
  private readonly home: string
  private readonly env: NodeJS.ProcessEnv
  private items = new Map<string, TrashItem>()

  constructor(private readonly deps: TrashDeps = {}) {
    this.platform = deps.platform ?? process.platform
    this.home = deps.home ?? homedir()
    this.env = deps.env ?? process.env
  }

  get supported(): boolean {
    return this.platform === 'linux' || this.platform === 'win32'
  }

  // --- Dónde están las papeleras --------------------------------------------

  private async linuxTrashes(): Promise<{ root: string; topdir?: string }[]> {
    const dataHome = this.env['XDG_DATA_HOME'] || join(this.home, '.local', 'share')
    const out: { root: string; topdir?: string }[] = [{ root: join(dataHome, 'Trash') }]
    const uid = this.deps.uid ?? process.getuid?.()
    if (uid === undefined) return out
    let mounts = this.deps.mounts
    if (!mounts) {
      try {
        mounts = (await readFile('/proc/mounts', 'utf8')).split('\n').map((l) => l.split(' ')[1]?.replace(/\\040/g, ' ')).filter((m): m is string => Boolean(m) && m.startsWith('/'))
      } catch {
        mounts = []
      }
    }
    for (const top of new Set(mounts)) {
      for (const candidate of [join(top, `.Trash-${uid}`), join(top, '.Trash', String(uid))]) {
        if (await stat(join(candidate, 'info')).then((s) => s.isDirectory(), () => false)) out.push({ root: candidate, topdir: top })
      }
    }
    return out
  }

  private async windowsBins(): Promise<string[]> {
    if (this.deps.recycleBins) return this.deps.recycleBins
    const bins: string[] = []
    for (let c = 65; c <= 90; c++) {
      const bin = `${String.fromCharCode(c)}:\\$Recycle.Bin`
      if (await stat(bin).then(() => true, () => false)) bins.push(bin)
    }
    return bins
  }

  // --- Lectura ------------------------------------------------------------------

  async list(): Promise<{ items: TrashItem[]; locations: number }> {
    if (!this.supported) return { items: [], locations: 0 }
    const found: TrashItem[] = []
    let locations = 0

    if (this.platform === 'linux') {
      for (const t of await this.linuxTrashes()) {
        locations++
        found.push(...(await this.readLinux(t.root, t.topdir)))
      }
    } else {
      for (const bin of await this.windowsBins()) {
        locations++
        found.push(...(await this.readWindows(bin)))
      }
    }

    found.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
    const limited = found.slice(0, MAX_ITEMS)
    this.items = new Map(limited.map((i) => [i.id, i]))
    return { items: limited, locations }
  }

  private async readLinux(root: string, topdir?: string): Promise<TrashItem[]> {
    let names: string[]
    try {
      names = await readdir(join(root, 'files'))
    } catch {
      return []
    }
    const items: TrashItem[] = []
    for (const entry of names) {
      const payload = join(root, 'files', entry)
      try {
        const st = await lstat(payload)
        const infoPath = join(root, 'info', `${entry}.trashinfo`)
        const info = await readFile(infoPath, 'utf8').then((t) => parseTrashInfo(t, topdir), () => ({ originalPath: undefined, trashedAt: undefined }))
        const isDir = st.isDirectory()
        const sz = await sizeOf(payload, isDir)
        items.push({
          id: idOf(payload),
          name: info.originalPath ? basename(info.originalPath) : entry,
          originalPath: info.originalPath,
          trashedAt: info.trashedAt ?? Math.round(st.ctimeMs),
          size: sz.size,
          sizeApprox: sz.approx,
          isDir,
          ext: isDir ? '' : extname(entry).slice(1).toLowerCase(),
          payload,
          meta: [infoPath]
        })
      } catch {
        // un elemento ilegible no impide ver los demás
      }
    }
    return items
  }

  private async readWindows(bin: string): Promise<TrashItem[]> {
    const items: TrashItem[] = []
    let sids: string[]
    try {
      sids = await readdir(bin)
    } catch {
      return []
    }
    for (const sid of sids) {
      let names: string[]
      try {
        names = await readdir(join(bin, sid))
      } catch {
        continue // la carpeta de otro usuario: no hay permiso
      }
      for (const name of names.filter((n) => n.startsWith('$I'))) {
        const metaPath = join(bin, sid, name)
        const payload = join(bin, sid, `$R${name.slice(2)}`)
        try {
          const info = parseRecycleInfo(await readFile(metaPath))
          if (!info) continue
          const st = await lstat(payload)
          const isDir = st.isDirectory()
          const sz = await sizeOf(payload, isDir)
          items.push({
            id: idOf(payload),
            name: info.originalPath ? win32.basename(info.originalPath) : name,
            originalPath: info.originalPath,
            trashedAt: info.trashedAt,
            size: sz.size,
            sizeApprox: sz.approx,
            isDir,
            ext: isDir ? '' : extname(payload).slice(1).toLowerCase(),
            payload,
            meta: [metaPath]
          })
        } catch {
          // se omite
        }
      }
    }
    return items
  }

  // --- Resurrección ---------------------------------------------------------------

  /**
   * Trae un elemento de vuelta. Sin `destDir` lo deja donde estaba (creando las carpetas que falten).
   * No pisa nada: si ya hay uno con ese nombre, usa "(resucitado)". Solo actúa sobre elementos que
   * vienen de la última lectura de la papelera.
   */
  async restore(id: string, destDir?: string): Promise<RestoreOutcome> {
    const item = this.items.get(id)
    const fail = (error: RestoreFailure, message: string): RestoreOutcome => ({ id, ok: false, error, message })
    if (!item) return fail('not-found', 'Ese elemento ya no está en la papelera')
    if (!(await lstat(item.payload).then(() => true, () => false))) {
      this.items.delete(id)
      return fail('not-found', 'Ese elemento ya no está en la papelera')
    }

    let dir = destDir
    if (!dir) {
      if (!item.originalPath) return fail('no-original', 'La papelera no recuerda dónde estaba: elige una carpeta')
      dir = this.platform === 'win32' ? win32.dirname(item.originalPath) : dirname(item.originalPath)
    }
    if (!isAbsolute(dir) && !/^[A-Za-z]:[\\/]/.test(dir)) return fail('no-destination', 'La carpeta de destino no es válida')

    try {
      await mkdir(dir, { recursive: true })
      const base = item.name
      // Reintenta si otro proceso ocupa el nombre justo entre la comprobación y el movimiento.
      for (let attempt = 0; attempt < 5; attempt++) {
        const target = await freeName(dir, base)
        try {
          await moveNoClobber(item.payload, target.path, item.isDir, this.deps.ops)
          for (const m of item.meta) await rm(m, { force: true })
          this.items.delete(id)
          return { id, ok: true, restoredTo: target.path, renamed: target.renamed }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      }
      return fail('failed', 'No se encontró un nombre libre en la carpeta')
    } catch (error) {
      return fail('failed', error instanceof Error ? error.message : String(error))
    }
  }
}
