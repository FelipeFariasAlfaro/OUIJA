import type { MediumApi } from '@shared/ipc'

/** Puente con el proceso principal. Solo existe dentro de la aplicación de escritorio. */
export const api = window.medium as MediumApi
export const isDesktop = window.medium !== undefined
