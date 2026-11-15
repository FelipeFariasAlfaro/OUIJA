import { join } from 'node:path'
import { BrowserWindow, screen, session, type WebContents } from 'electron'
import { isAllowedRequest } from './security'

export const WINDOW_SIZE = { width: 760, height: 580 }

export interface PaletteOptions {
  preload: string
  rendererFile: string
  devServerUrl?: string
  icon: string
}

/** Cierra puertas por defecto: sin permisos, sin navegación externa, sin red que no sea local. */
export function hardenSession(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url) })
  })
}

function lockNavigation(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

/**
 * Ventana principal de OUIJA. Sin marco del sistema (la interfaz trae sus propios botones), con
 * esquinas redondeadas y presente en la barra de tareas o el dock: minimizada, se recupera con un clic.
 */
export class PaletteWindow {
  readonly win: BrowserWindow
  constructor(options: PaletteOptions) {
    this.win = new BrowserWindow({
      ...WINDOW_SIZE,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: true,
      fullscreenable: false,
      skipTaskbar: false,
      title: 'OUIJA',
      icon: options.icon,
      webPreferences: {
        preload: options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: Boolean(options.devServerUrl)
      }
    })
    lockNavigation(this.win.webContents)
    if (options.devServerUrl) void this.win.loadURL(options.devServerUrl)
    else void this.win.loadFile(options.rendererFile)
  }

  get visible(): boolean {
    return this.win.isVisible() && !this.win.isMinimized()
  }

  /** Coloca la ventana arriba y al centro de la pantalla donde está el cursor (solo la primera vez). */
  private placed = false
  private place(): void {
    if (this.placed) return
    this.placed = true
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    this.win.setPosition(Math.round(area.x + (area.width - WINDOW_SIZE.width) / 2), Math.round(area.y + area.height * 0.14))
  }

  /** Muestra la ventana (la restaura si estaba minimizada) y le da el foco. */
  show(onShown?: () => void): void {
    this.place()
    if (this.win.isMinimized()) this.win.restore()
    this.win.show()
    this.win.focus()
    onShown?.()
  }

  /** Minimiza a la barra de tareas o al dock. */
  minimize(): void {
    this.win.minimize()
  }

  /** Atajo y bandeja: si ya está al frente la minimiza; si no, la trae. */
  toggle(onShown?: () => void): void {
    if (this.visible && this.win.isFocused()) this.minimize()
    else this.show(onShown)
  }

  /** Ejecuta una acción que abre diálogos del sistema. */
  async withoutHiding<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } finally {
      this.win.focus()
    }
  }

  send(channel: string, ...args: unknown[]): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, ...args)
  }

  get url(): string {
    return this.win.webContents.getURL()
  }
}

export const rendererFileFor = (dir: string): string => join(dir, '../renderer/index.html')
