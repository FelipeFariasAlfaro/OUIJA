/**
 * Punto de entrada del servidor MCP cuando se ejecuta como Node (por ejemplo, con el ejecutable de
 * OUIJA y `ELECTRON_RUN_AS_NODE=1`, o con `node out/main/mcp.js`). No carga Electron.
 */
import { defaultDataDir, runMcp } from './mcp/run'

declare const __OUIJA_VERSION__: string | undefined

runMcp(defaultDataDir(), typeof __OUIJA_VERSION__ === 'string' ? __OUIJA_VERSION__ : '0.0.0').catch((error: unknown) => {
  console.error('OUIJA MCP:', error instanceof Error ? error.message : error)
  process.exit(1)
})
