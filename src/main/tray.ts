import { Menu, Tray, nativeImage } from 'electron'
import type { Lang } from '@shared/types'

const LABELS = {
  es: { open: 'Abrir OUIJA', index: 'Indexar ahora', quit: 'Salir' },
  en: { open: 'Open OUIJA', index: 'Index now', quit: 'Quit' },
  pt: { open: 'Abrir OUIJA', index: 'Indexar agora', quit: 'Sair' },
  fr: { open: 'Ouvrir OUIJA', index: 'Indexer maintenant', quit: 'Quitter' },
  ja: { open: 'OUIJA を開く', index: '今すぐインデックス', quit: '終了' },
  zh: { open: '打开 OUIJA', index: '立即索引', quit: '退出' }
} as const satisfies Record<Lang, unknown>

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
