import { join } from 'node:path'
import { app, globalShortcut, safeStorage, Tray } from 'electron'
import { pathToFileURL } from 'node:url'
import { IPC, type AppInfo } from '@shared/ipc'
import iconPath from '../../resources/icon.png?asset'
import trayPath from '../../resources/tray.png?asset'
import { MediumCore } from './core/medium'
import { SecretStore } from './core/secrets'
import { SettingsStore } from './core/settings'
import { registerIpc } from './ipc'
import { registerShortcut, type ShortcutResult } from './shortcut'
import { createTray, updateTrayMenu, type TrayActions } from './tray'
import { hardenSession, PaletteWindow, rendererFileFor } from './window'

// Wayland no deja que una aplicación capture teclas globales sin el portal del escritorio.
if (process.platform === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland') {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
}
if (process.env['MEDIUM_USER_DATA']) app.setPath('userData', process.env['MEDIUM_USER_DATA']) // pruebas

if (!app.requestSingleInstanceLock()) app.quit()

let palette: PaletteWindow
let tray: Tray | null = null
let shortcut: ShortcutResult = { accelerator: '', status: 'unavailable' }

function applyShortcut(accelerator: string): void {
  if (shortcut.status === 'registered') globalShortcut.unregister(shortcut.accelerator)
  shortcut = registerShortcut(globalShortcut, accelerator, () => palette.toggle(notifyShown))
}

const notifyShown = (): void => palette.send(IPC.onShown)

app.whenReady().then(async () => {
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
  const testBase = process.env['MEDIUM_AI_TEST_BASE'] // pruebas: un servidor local que imita al proveedor
  const core = new MediumCore({ dataDir: app.getPath('userData'), settings, secrets, aiDeps: testBase ? { baseUrl: testBase } : undefined })
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

  registerIpc({
    core,
    palette,
    appFileUrl: pathToFileURL(rendererFile).href,
    devServerUrl,
    getSettings: () => settings.value,
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
    }
  })

  if (settings.value.indexOnStart && settings.value.folders.length > 0) void core.indexNow()

  palette.show(notifyShown)

  app.on('second-instance', () => palette.show(notifyShown))
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('before-quit', () => void core.close())
})

// Cerrar la ventana cierra OUIJA. Mientras esté minimizada sigue activa y vigilando las carpetas.
app.on('window-all-closed', () => app.quit())
