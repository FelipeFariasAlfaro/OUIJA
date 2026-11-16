import { join } from 'node:path'
import { app, globalShortcut, safeStorage, Tray } from 'electron'
import { pathToFileURL } from 'node:url'
import { IPC, type AppInfo } from '@shared/ipc'
import iconPath from '../../resources/icon.png?asset'
import trayPath from '../../resources/tray.png?asset'
import { OuijaCore } from './core/ouija'
import { SecretStore } from './core/secrets'
import { SettingsStore } from './core/settings'
import { registerIpc } from './ipc'
import { runPendingExorcism } from './purge'
import { existingDataDir, prepareDataDir, resolveDataDir } from './dataDir'
import { Updater } from './updater'
import { runMcp } from './mcp/run'
import { registerShortcut, type ShortcutResult } from './shortcut'
import { createTray, updateTrayMenu, type TrayActions } from './tray'
import { hardenSession, PaletteWindow, rendererFileFor } from './window'

// Wayland no deja que una aplicación capture teclas globales sin el portal del escritorio.
if (process.platform === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland') {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
}
// Carpeta de datos: `~/.config/ouija` (o `%APPDATA%\\ouija`). La antigua `medium` se renombra la primera vez.
if (process.env['OUIJA_USER_DATA']) app.setPath('userData', process.env['OUIJA_USER_DATA']) // pruebas
else if (!process.argv.includes('--mcp')) app.setPath('userData', prepareDataDir(app.getPath('appData')))
else app.setPath('userData', existingDataDir(app.getPath('appData')))
// Un exorcismo pedido en la sesión anterior: la carpeta de datos queda limpia antes de usarla.
if (!process.argv.includes('--mcp')) runPendingExorcism(app.getPath('userData'))


// `ouija --mcp`: servidor MCP por stdio para agentes (Kiro, Claude Desktop…), sin ventana. Convive con la
// aplicación abierta: solo lee el índice que ella mantiene.
const MCP_MODE = process.argv.includes('--mcp')
if (MCP_MODE) {
  app.disableHardwareAcceleration()
  runMcp(process.env['OUIJA_DATA_DIR'] ? resolveDataDir(process.env['OUIJA_DATA_DIR']) : app.getPath('userData'), app.getVersion(), (code) => app.exit(code)).catch((error: unknown) => {
    console.error('OUIJA MCP:', error instanceof Error ? error.message : error)
    app.exit(1)
  })
} else if (!app.requestSingleInstanceLock()) app.quit()

/** Configuración para el `mcp.json` de un agente, con las rutas reales de esta instalación. */
function mcpConfig(): string {
  const dataDir = app.getPath('userData')
  const appImage = process.env['APPIMAGE']
  // En un AppImage la ruta interna cambia en cada arranque: se usa el propio AppImage con `--mcp`.
  const server = appImage
    ? { command: appImage, args: ['--mcp'], env: { OUIJA_DATA_DIR: dataDir } }
    : { command: process.execPath, args: [join(app.getAppPath(), 'out', 'main', 'mcp.js')], env: { ELECTRON_RUN_AS_NODE: '1', OUIJA_DATA_DIR: dataDir } }
  return JSON.stringify({ mcpServers: { ouija: server } }, null, 2)
}

let palette: PaletteWindow
let tray: Tray | null = null
let shortcut: ShortcutResult = { accelerator: '', status: 'unavailable' }

function applyShortcut(accelerator: string): void {
  if (shortcut.status === 'registered') globalShortcut.unregister(shortcut.accelerator)
  shortcut = registerShortcut(globalShortcut, accelerator, () => palette.toggle(notifyShown))
}

const notifyShown = (): void => palette.send(IPC.onShown)

app.whenReady().then(async () => {
  if (MCP_MODE) return
  app.setName('OUIJA')
  hardenSession()

  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  await settings.load()
  // Las claves de API se guardan cifradas con el almacén del sistema. Si no hay uno seguro (por ejemplo, Linux sin
  // llavero), solo viven en memoria mientras OUIJA esté abierto.
  const secrets = new SecretStore(join(app.getPath('userData'), 'secrets.json'), {
    available: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  })
  await secrets.load()
  const testBase = process.env['OUIJA_AI_TEST_BASE'] // pruebas: un servidor local que imita al proveedor
  // Pruebas: servidores locales falsos ("Nombre:puerto,…") en vez de los puertos habituales.
  const testServers = process.env['OUIJA_TEST_LOCAL_SERVERS']
    ?.split(',')
    .map((s) => s.split(':'))
    .map(([name, port]) => ({ name, port: Number(port) }))
    .filter((s) => s.name && Number.isInteger(s.port))
  const core = new OuijaCore({
    dataDir: app.getPath('userData'),
    settings,
    secrets,
    aiDeps: testBase ? { baseUrl: testBase } : undefined,
    localServers: testServers ? { servers: testServers } : undefined
  })
  await core.init()

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  const rendererFile = rendererFileFor(__dirname)
  palette = new PaletteWindow({
    preload: join(__dirname, '../preload/index.js'),
    rendererFile,
    devServerUrl,
    icon: iconPath
  })

  const actions: TrayActions = {
    open: () => palette.show(notifyShown),
    indexNow: () => void core.indexNow(),
    quit: () => app.quit()
  }
  try {
    tray = createTray(trayPath, settings.value.lang, actions)
  } catch {
    tray = null // sin bandeja: queda el atajo y volver a abrir la aplicación
  }
  applyShortcut(settings.value.shortcut)
  const updater = new Updater()

  registerIpc({
    core,
    palette,
    appFileUrl: pathToFileURL(rendererFile).href,
    devServerUrl,
    getSettings: () => settings.value,
    mcpConfig,
    updater,
    appInfo: (): AppInfo => ({
      version: app.getVersion(),
      platform: process.platform,
      shortcut,
      trayAvailable: tray !== null,
      desktop: process.env['XDG_CURRENT_DESKTOP'] ?? '',
      dataDir: app.getPath('userData')
    }),
    onSettingsChanged: (after, before) => {
      if (after.shortcut !== before.shortcut) applyShortcut(after.shortcut)
      if (tray && after.lang !== before.lang) updateTrayMenu(tray, after.lang, actions)
      if (after.autoUpdate !== before.autoUpdate) updater.schedule(after.autoUpdate)
    }
  })

  if (settings.value.indexOnStart && settings.value.folders.length > 0) void core.indexNow()

  palette.show(notifyShown)

  app.on('second-instance', () => palette.show(notifyShown))
  app.on('will-quit', () => globalShortcut.unregisterAll())
  updater.schedule(settings.value.autoUpdate)
  app.on('before-quit', () => {
    updater.stop()
    void core.close()
  })
})

// Cerrar la ventana cierra OUIJA. Mientras esté minimizada sigue activa y vigilando las carpetas.
app.on('window-all-closed', () => app.quit())
