import { homedir } from 'node:os'
import { join } from 'node:path'
import { MediumCore } from '../core/medium'
import { SecretStore } from '../core/secrets'
import { SettingsStore } from '../core/settings'
import { ouijaTools, serveStdio } from './server'

/** Carpeta de datos de la aplicación cuando el servidor corre fuera de Electron (como Node). */
export function defaultDataDir(): string {
  if (process.env['OUIJA_DATA_DIR']) return process.env['OUIJA_DATA_DIR']
  if (process.platform === 'win32') return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'medium')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'medium')
  return join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'medium')
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
  const core = new MediumCore({ dataDir, settings, secrets, passive: true })
  await core.init()
  serveStdio(ouijaTools(core), version, () => {
    void core.close().finally(() => exit(0))
  })
}
