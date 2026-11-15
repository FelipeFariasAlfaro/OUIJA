import { Menu, Tray, nativeImage } from 'electron'
import type { Lang } from '@shared/types'

const LABELS = {
  es: { open: 'Abrir OUIJA', index: 'Indexar ahora', quit: 'Salir' },
  en: { open: 'Open OUIJA', index: 'Index now', quit: 'Quit' }
} as const

export interface TrayActions {
  open(): void
  indexNow(): void
  quit(): void
}

/** Ícono en la bandeja del sistema (o barra de menú) con menú contextual. */
export function createTray(iconPath: string, lang: Lang, actions: TrayActions): Tray {
  const tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('OUIJA')
  tray.on('click', actions.open)
  updateTrayMenu(tray, lang, actions)
  return tray
}

export function updateTrayMenu(tray: Tray, lang: Lang, actions: TrayActions): void {
  const t = LABELS[lang]
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t.open, click: actions.open },
      { label: t.index, click: actions.indexNow },
      { type: 'separator' },
      { label: t.quit, click: actions.quit }
    ])
  )
}
