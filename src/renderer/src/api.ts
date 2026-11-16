import type { OuijaApi } from '@shared/ipc'

/** Puente con el proceso principal. Solo existe dentro de la aplicación de escritorio. */
export const api = window.ouija as OuijaApi
export const isDesktop = window.ouija !== undefined
