import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

const alias = {
  '@shared': resolve('src/shared'),
  '@core': resolve('src/core')
}

export default defineConfig({
  main: {
    resolve: { alias },
    define: { __OUIJA_VERSION__: JSON.stringify(version) },
    build: {
      rollupOptions: {
        // `mcp.js`: el servidor MCP como script de Node (se ejecuta con ELECTRON_RUN_AS_NODE=1).
        input: { index: resolve('src/main/index.ts'), mcp: resolve('src/main/mcp.ts') }
      }
    }
  },
  preload: { resolve: { alias } },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { ...alias, '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()]
  }
})
