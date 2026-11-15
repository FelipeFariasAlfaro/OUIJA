export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface ShortcutResult {
  accelerator: string
  status: 'registered' | 'unavailable'
}

/**
 * Registra el atajo global. Si el sistema lo rechaza (por ejemplo Wayland sin el portal de atajos, o
 * un atajo ya ocupado), la aplicación sigue funcionando por el ícono de la bandeja.
 */
export function registerShortcut(api: ShortcutApi, accelerator: string, onPress: () => void): ShortcutResult {
  try {
    return { accelerator, status: api.register(accelerator, onPress) ? 'registered' : 'unavailable' }
  } catch {
    return { accelerator, status: 'unavailable' } // acelerador mal formado
  }
}
