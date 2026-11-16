import { join } from 'node:path'
import { BrowserWindow, screen, session, type WebContents } from 'electron'
import { isAllowedRequest } from './security'

export const WINDOW_SIZE = { width: 980, height: 700 }
/** Lo mínimo para que la interfaz no se rompa. */
export const MIN_WINDOW_SIZE = { width: 720, height: 520 }

export interface PaletteOptions {
  preload: string
  rendererFile: string
  devServerUrl?: string
  icon: string
}

/** Cierra puertas por defecto: sin permisos, sin navegación externa, sin red que no sea local. */
export function hardenSession(): void {
  const ses = session.defaultSession
  // Ningún permiso salvo escribir texto en el portapapeles (el botón "Copiar configuración" del MCP).
  const allowed = (permission: string): boolean => permission === 'clipboard-sanitized-write'
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => allowed(permission))
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
      // Las ventanas transparentes no se pueden redimensionar bien en Electron: la ventana es opaca.
      backgroundColor: '#0d0d16',
      resizable: true,
      maximizable: true,
      minWidth: MIN_WINDOW_SIZE.width,
      minHeight: MIN_WINDOW_SIZE.height,
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
    // En pantallas chicas, el tamaño inicial se ajusta al espacio disponible.
    const width = Math.max(MIN_WINDOW_SIZE.width, Math.min(WINDOW_SIZE.width, area.width - 40))
    const height = Math.max(MIN_WINDOW_SIZE.height, Math.min(WINDOW_SIZE.height, area.height - 40))
    this.win.setSize(width, height)
    this.win.setPosition(Math.round(area.x + (area.width - width) / 2), Math.round(area.y + Math.max(0, (area.height - height) / 2)))
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

  toggleMaximize(): void {
    if (this.win.isMaximized()) this.win.unmaximize()
    else this.win.maximize()
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
