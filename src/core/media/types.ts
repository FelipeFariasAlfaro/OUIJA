export interface ContainerEntry {
  /** Ruta interna normalizada con `/`, sin `..` ni barra inicial. */
  name: string
  /** Tamaño descomprimido declarado, si se conoce. */
  size?: number
  /** Milisegundos desde epoch, si se conoce. */
  mtime?: number
  /** Devuelve el contenido. Rechaza con `Error` si la entrada está dañada. */
  read(): Promise<Buffer>
}

export interface ContainerError {
  name?: string
  message: string
}

export interface Container {
  entries: ContainerEntry[]
  errors: ContainerError[]
  /** `true` si el índice del contenedor estaba dañado y se rescataron entradas escaneándolo. */
  recovered: boolean
}
