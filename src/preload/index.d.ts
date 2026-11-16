import type { OuijaApi } from '../shared/ipc'

declare global {
  interface Window {
    /** Solo existe dentro de Electron. En un navegador (vista previa) no está definido. */
    ouija?: OuijaApi
  }
}

export {}
