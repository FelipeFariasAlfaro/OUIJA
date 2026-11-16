import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@core': resolve('src/core') } },
  test: {
    include: ['tests/autopsy/**/*.autopsy.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000
  }
})
