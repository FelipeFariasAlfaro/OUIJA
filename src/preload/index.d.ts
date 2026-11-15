import type { MediumApi } from '../shared/ipc'

declare global {
  interface Window {
    /** Solo existe dentro de Electron. En un navegador (vista previa) no está definido. */
    medium?: MediumApi
  }
}

export {}
