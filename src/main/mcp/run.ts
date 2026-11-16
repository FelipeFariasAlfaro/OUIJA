import { homedir } from 'node:os'
import { join } from 'node:path'
import { existingDataDir, resolveDataDir } from '../dataDir'
import { OuijaCore } from '../core/ouija'
import { SecretStore } from '../core/secrets'
import { SettingsStore } from '../core/settings'
import { ouijaTools, serveStdio } from './server'

/** Carpeta de datos de la aplicación cuando el servidor corre fuera de Electron (como Node). */
export function defaultDataDir(): string {
  if (process.env['OUIJA_DATA_DIR']) return resolveDataDir(process.env['OUIJA_DATA_DIR'])
  const appData =
    process.platform === 'win32'
      ? (process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config')
  // El servidor solo lee: no renombra la carpeta antigua, pero la usa si es la única que hay.
  return existingDataDir(appData)
}

/**
 * Arranca el servidor MCP sobre el índice de `dataDir`, en modo pasivo: la aplicación sigue siendo
 * quien indexa; el servidor solo lee. Las claves de API no se cargan (responde sin modelo de lenguaje).
 */
export async function runMcp(dataDir: string, version: string, exit: (code: number) => void = (c) => process.exit(c)): Promise<void> {
  const settings = new SettingsStore(join(dataDir, 'settings.json'))
  await settings.load()
  const secrets = new SecretStore(join(dataDir, 'secrets.mcp.json'), {
    available: () => false,
    encrypt: () => Buffer.alloc(0),
    decrypt: () => ''
  })
  const core = new OuijaCore({ dataDir, settings, secrets, passive: true })
  await core.init()
  serveStdio(ouijaTools(core), version, () => {
    void core.close().finally(() => exit(0))
  })
}
