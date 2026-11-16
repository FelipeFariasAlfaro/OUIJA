import { app, shell } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/ipc'
import { isNewer } from '@shared/version'

/** Repositorio donde se publican las versiones. */
export const RELEASES_URL = 'https://github.com/FelipeFariasAlfaro/OUIJA/releases'
const LATEST_API = 'https://api.github.com/repos/FelipeFariasAlfaro/OUIJA/releases/latest'
const FIRST_CHECK_MS = 15_000
const EVERY_MS = 6 * 3600_000

/** Solo pruebas: una API local que imita a GitHub. Nunca se acepta un servidor remoto distinto. */
function latestApi(): string {
  const test = process.env['OUIJA_UPDATE_TEST_API']
  if (test && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(test)) return test
  return LATEST_API
}

/**
 * Busca versiones nuevas en GitHub Releases y ofrece instalarlas.
 * - Instaladores que se actualizan solos (Windows NSIS y AppImage en Linux): descarga en segundo
 *   plano con `electron-updater`, verifica la firma SHA-512 del release y reinicia cuando el usuario lo pide.
 * - El resto (paquete .deb, desarrollo): avisa y abre la página de descarga.
 * Lo único que se consulta es la lista de versiones de OUIJA; no se envía nada de los archivos del usuario.
 */
export class Updater {
  private state: UpdateState = { status: 'idle', current: app.getVersion(), canInstall: false }
  private timer: NodeJS.Timeout | undefined
  private first: NodeJS.Timeout | undefined
  private listeners = new Set<(s: UpdateState) => void>()
  private auto: AppUpdater | null = null
  readonly canInstall: boolean

  constructor() {
    this.canInstall = app.isPackaged && !process.env['OUIJA_UPDATE_TEST_API'] && (process.platform === 'win32' || Boolean(process.env['APPIMAGE']))
    this.state = { ...this.state, canInstall: this.canInstall }
  }

  get value(): UpdateState {
    return { ...this.state }
  }

  onChange(listener: (s: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.value)
  }

  /** Revisa al poco de arrancar y luego cada 6 horas, mientras `enabled` sea verdadero. */
  schedule(enabled: boolean): void {
    clearTimeout(this.first)
    clearInterval(this.timer)
    if (!enabled) return
    this.first = setTimeout(() => void this.check(), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(), EVERY_MS)
  }

  private async updater(): Promise<AppUpdater> {
    if (this.auto) return this.auto
    // `autoUpdater` se crea al leerlo por primera vez: solo cuando hace falta.
    const { autoUpdater } = electronUpdater
    autoUpdater.autoDownload = false // se ofrece; el usuario decide
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', latest: info.version }))
    autoUpdater.on('error', (e) => this.set({ status: 'error', message: e instanceof Error ? e.message : String(e) }))
    this.auto = autoUpdater
    return autoUpdater
  }

  async check(): Promise<UpdateState> {
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'ready') return this.value
    this.set({ status: 'checking', message: undefined })
    try {
      if (this.canInstall) {
        const r = await (await this.updater()).checkForUpdates()
        const latest = r?.updateInfo.version
        if (latest && isNewer(latest, this.state.current)) this.set({ status: 'available', latest, url: `${RELEASES_URL}/tag/v${latest}` })
        else this.set({ status: 'none' })
      } else {
        const res = await fetch(latestApi(), { headers: { accept: 'application/vnd.github+json', 'user-agent': `OUIJA/${this.state.current}` }, signal: AbortSignal.timeout(15_000) })
        if (!res.ok) throw new Error(`GitHub respondió ${res.status}`)
        const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
        const latest = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/i, '') : ''
        const url = typeof body.html_url === 'string' && body.html_url.startsWith(`${RELEASES_URL}/`) ? body.html_url : RELEASES_URL
        if (latest && isNewer(latest, this.state.current)) this.set({ status: 'available', latest, url })
        else this.set({ status: 'none' })
      }
    } catch (error) {
      this.set({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    return this.value
  }

  /** Descarga e instala (si este instalador puede) o abre la página de la versión. */
  async download(): Promise<UpdateState> {
    if (this.state.status !== 'available') return this.value
    if (!this.canInstall) {
      const url = this.state.url && this.state.url.startsWith(RELEASES_URL) ? this.state.url : RELEASES_URL
      await shell.openExternal(url)
      return this.value
    }
    this.set({ status: 'downloading', percent: 0 })
    try {
      await (await this.updater()).downloadUpdate()
    } catch (error) {
      this.set({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    return this.value
  }

  /** Cierra OUIJA, instala la versión descargada y vuelve a abrirla. */
  install(): void {
    if (this.state.status === 'ready' && this.auto) this.auto.quitAndInstall(false, true)
  }

  stop(): void {
    clearTimeout(this.first)
    clearInterval(this.timer)
  }
}
