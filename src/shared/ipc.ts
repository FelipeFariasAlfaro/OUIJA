import type { AiConfig, AiProviderId, AiSaved, AiSaveInput, AiSettings, AiValidation } from './ai'
import type { FileKind } from './filetypes'
import type { Ghost, Lang, Person, PersonSummary, SearchAnswer } from './types'

/** Configuración persistente del usuario. */
export interface Settings {
  /** Carpetas que se indexan. */
  folders: string[]
  /** Nombres de carpeta que se omiten. */
  excludeDirs: string[]
  includeHidden: boolean
  /** Años sin uso para considerar un archivo "fantasma". */
  staleYears: number
  lang: Lang
  /** Atajo global para abrir la paleta. */
  shortcut: string
  ollamaHost: string
  embedModel: string
  /** Modelo de chat. Vacío = elegir uno instalado automáticamente. */
  chatModel: string
  /** Dimensión de los vectores del modelo de embeddings (se detecta sola). */
  embedDimensions: number
  indexOnStart: boolean
  watchFolders: boolean
  /** Leer, en segundo plano, el texto dentro de imágenes pequeñas (logos, capturas). */
  ocrImages: boolean
  /** Tipos de archivo que no entran en las búsquedas. Vacío = todos. El índice no cambia. */
  excludedKinds: FileKind[]
  /** Ya se hizo la bienvenida y la puesta en marcha inicial. */
  onboarded: boolean
  /** Niebla, relámpagos lejanos y algún fantasma de fondo. */
  ambience: boolean
  /** Buscar versiones nuevas en GitHub al abrir y cada 6 horas. */
  autoUpdate: boolean
  /** Ya se hizo (o se saltó) el recorrido guiado por las secciones. */
  tourDone: boolean
  /** Modelo de lenguaje: local o de un servicio externo. */
  ai: AiSettings
}

export interface OllamaStatus {
  available: boolean
  host: string
  models: string[]
  embedModel: string
  embedModelInstalled: boolean
  /** Modelo local de respuestas instalado, si hay uno (se informa aunque las respuestas las dé un servicio externo). */
  chatModel?: string
  /** Pasos pendientes para dejarlo listo. La interfaz los traduce. */
  hints: OllamaHint[]
}

export interface OllamaHint {
  code: 'start-ollama' | 'pull-embed' | 'pull-chat'
  /** Comando a ejecutar, si aplica (por ejemplo `ollama pull bge-m3`). */
  command?: string
}

export type IndexPhase = 'idle' | 'scanning' | 'indexing' | 'reading' | 'entities' | 'error'

export interface IndexState {
  phase: IndexPhase
  processed: number
  total: number
  current?: string
  indexed: number
  skipped: number
  errors: number
  /** Mensaje cuando `phase` es `error`. */
  message?: string
  /** Última vez que terminó una indexación completa (ms). */
  lastRunAt?: number
}

export interface AppInfo {
  version: string
  platform: string
  /** `registered` si el atajo global funciona; `unavailable` si el sistema no lo permite (por ejemplo Wayland). */
  shortcut: { accelerator: string; status: 'registered' | 'unavailable' }
  trayAvailable: boolean
  /** Escritorio de Linux (por ejemplo GNOME), para orientar al usuario si la bandeja no se ve. */
  desktop: string
  dataDir: string
}

export interface PresentResult {
  /** `null` si el usuario canceló. */
  savedTo: string | null
  format?: 'docx' | 'xlsx' | 'md'
}

export interface ExportResult {
  /** `null` si el usuario canceló. */
  savedTo: string | null
}

/** Canales IPC. La interfaz solo puede invocar lo que figura aquí. */
export const IPC = {
  ask: 'medium:ask',
  ghosts: 'medium:ghosts',
  people: 'medium:people',
  timeline: 'medium:timeline',
  decideNames: 'medium:decide-names',
  openFile: 'medium:open-file',
  showInFolder: 'medium:show-in-folder',
  exportFile: 'medium:export-file',
  bringToPresent: 'medium:bring-to-present',
  mcpConfig: 'medium:mcp-config',
  getSettings: 'medium:get-settings',
  setSettings: 'medium:set-settings',
  addFolder: 'medium:add-folder',
  removeFolder: 'medium:remove-folder',
  indexNow: 'medium:index-now',
  cancelIndex: 'medium:cancel-index',
  indexState: 'medium:index-state',
  forgetAll: 'medium:forget-all',
  aiConfig: 'medium:ai-config',
  aiValidate: 'medium:ai-validate',
  aiListModels: 'medium:ai-list-models',
  aiSave: 'medium:ai-save',
  aiForgetKey: 'medium:ai-forget-key',
  recentChanges: 'medium:recent-changes',
  fileKinds: 'medium:file-kinds',
  trashList: 'medium:trash-list',
  trashRestore: 'medium:trash-restore',
  trashReveal: 'medium:trash-reveal',
  setupState: 'medium:setup-state',
  updateState: 'medium:update-state',
  updateCheck: 'medium:update-check',
  updateDownload: 'medium:update-download',
  updateInstall: 'medium:update-install',
  setupStart: 'medium:setup-start',
  setupCancel: 'medium:setup-cancel',
  suggestFolders: 'medium:suggest-folders',
  addSuggestedFolder: 'medium:add-suggested-folder',
  finishOnboarding: 'medium:finish-onboarding',
  ollamaStatus: 'medium:ollama-status',
  appInfo: 'medium:app-info',
  minimize: 'medium:minimize',
  toggleMaximize: 'medium:toggle-maximize',
  quit: 'medium:quit',
  /** Eventos del proceso principal hacia la interfaz. */
  onIndexState: 'medium:on-index-state',
  onShown: 'medium:on-shown',
  onSetupState: 'medium:on-setup-state',
  onUpdateState: 'medium:on-update-state',
  onChanges: 'medium:on-changes'
} as const

// --- Puesta en marcha inicial -----------------------------------------------

export type SetupStepId = 'runtime' | 'embed' | 'chat'
export type SetupStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'
export type SetupDetail = 'checking' | 'downloading' | 'verifying' | 'extracting' | 'starting' | 'pulling'
export type SetupErrorCode = 'offline' | 'no-space' | 'checksum' | 'unsupported' | 'extract' | 'start' | 'pull' | 'blocked' | 'unknown'

export interface SetupStep {
  id: SetupStepId
  status: SetupStepStatus
  detail?: SetupDetail
  /** Bytes completados y totales de la fase actual (0 si no se conocen). */
  completed: number
  total: number
  /** Tamaño aproximado de la descarga completa, para mostrarlo antes de empezar. */
  sizeBytes: number
  /** Por qué se omitió (por ejemplo, poca memoria) o el nombre del modelo/versión instalado. */
  note?: string
  error?: SetupErrorCode
  errorMessage?: string
}

export interface OptionalTool {
  id: 'libreoffice' | 'tesseract' | 'poppler' | '7zip'
  found: boolean
  /** Comando para instalarlo en este sistema. */
  hint: string
}

export interface SetupState {
  running: boolean
  steps: SetupStep[]
  /** Hay motor local y modelo de significado: ya se puede indexar y buscar. */
  ready: boolean
  /** Todo lo necesario (incluido el modelo de respuestas, si corresponde) está listo. */
  complete: boolean
  tools: OptionalTool[]
}

export interface FolderSuggestion {
  path: string
  name: string
}

// --- Cambios detectados -----------------------------------------------------

/** Cuántos archivos de un tipo hay en el índice. */
export interface KindCount {
  kind: FileKind
  count: number
}

/** Filtros que el usuario elige en la búsqueda. */
export interface AskFilters {
  /** Solo estos tipos de archivo. Vacío o ausente = todos. */
  kinds?: FileKind[]
  /** Solo archivos modificados desde / hasta esta fecha (ms). */
  dateFrom?: number
  dateTo?: number
}

/** Actualizaciones publicadas en GitHub Releases. */
export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  /** Versión instalada. */
  current: string
  /** Versión nueva, si la hay. */
  latest?: string
  /** Página de la versión nueva. */
  url?: string
  /** Avance de la descarga (0 a 100). */
  percent?: number
  message?: string
  /** `true` si esta instalación se actualiza sola (Windows y AppImage); si no, se abre la página de descarga. */
  canInstall: boolean
}

export type ChangeKind = 'added' | 'modified' | 'removed'

export interface ChangeDto {
  id: number
  /** ms desde epoch */
  ts: number
  kind: ChangeKind
  name: string
  path: string
  ext: string
  size: number
  /** De qué trata el archivo, si OUIJA ya lo leyó (o lo sabía cuando se eliminó). */
  summary?: string
  /** El archivo sigue en el índice. */
  exists: boolean
}

// --- Patíbulo: la papelera -------------------------------------------------

export interface TrashItemDto {
  id: string
  name: string
  /** Dónde estaba antes de borrarse. Falta si la papelera no lo recuerda. */
  originalPath?: string
  originalFolder?: string
  /** Cuándo se borró (ms). */
  trashedAt?: number
  size: number
  /** El tamaño de una carpeta se calcula hasta un límite. */
  sizeApprox: boolean
  isDir: boolean
  ext: string
  kind: FileKind
  /** OUIJA conocía este archivo antes de que se borrara. */
  summary?: string
}

export interface TrashOverview {
  /** `false` si este sistema no permite leer la papelera (por ejemplo, macOS). */
  supported: boolean
  items: TrashItemDto[]
  totalCount: number
  totalSize: number
  byKind: Partial<Record<FileKind, number>>
  oldest?: number
  /** Cuántas papeleras se revisaron (la del usuario y las de discos externos). */
  locations: number
}

export type RestoreFailure = 'not-found' | 'no-original' | 'no-destination' | 'failed'

export type RestoreOutcome =
  | { id: string; ok: true; restoredTo: string; /** Se cambió el nombre porque ya existía uno igual. */ renamed: boolean }
  | { id: string; ok: false; error: RestoreFailure; message: string }

export interface RestoreResponse {
  /** El usuario cerró el selector de carpeta sin elegir. */
  canceled: boolean
  results: RestoreOutcome[]
}

export type NameDecision = 'merge' | 'split' | 'clear'

/** API que el preload expone como `window.medium`. */
export interface MediumApi {
  /** Pregunta al índice. `filters` restringe por tipo de archivo y por fecha de modificación. */
  ask(question: string, filters?: AskFilters): Promise<SearchAnswer>
  ghosts(): Promise<Ghost[]>
  people(): Promise<PersonSummary[]>
  timeline(personId: string): Promise<Person | null>
  decideNames(decision: NameDecision, a: string, b: string): Promise<void>
  openFile(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  exportFile(path: string): Promise<ExportResult>
  /** "Traer al presente": guarda una copia en un formato de hoy (DOCX, XLSX o Markdown) en la carpeta que se elija. */
  bringToPresent(path: string): Promise<PresentResult>
  /** Configuración lista para pegar en el `mcp.json` de un agente (Kiro, Claude Desktop…). */
  mcpConfig(): Promise<string>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  /** Abre el selector de carpetas del sistema y agrega la elegida. */
  addFolder(): Promise<Settings>
  removeFolder(folder: string): Promise<Settings>
  indexNow(): Promise<void>
  cancelIndex(): Promise<void>
  indexState(): Promise<IndexState>
  /** Olvida todo el índice, las entidades y las copias temporales. */
  forgetAll(): Promise<void>
  ollamaStatus(): Promise<OllamaStatus>
  appInfo(): Promise<AppInfo>
  /** Tipos de archivo que hay en el índice, con su cantidad (para elegir cuáles incluir en las búsquedas). */
  fileKinds(): Promise<KindCount[]>
  /** Lo último que OUIJA detectó: archivos nuevos, modificados y eliminados. */
  recentChanges(limit?: number): Promise<ChangeDto[]>
  /** Archivos que hay hoy en la papelera, con lo que OUIJA sabe de ellos. */
  trashList(): Promise<TrashOverview>
  /**
   * Trae de vuelta archivos de la papelera. Con `original` los deja donde estaban; con `choose` se abre el
   * selector de carpeta. Nunca sobrescribe: si ya existe uno igual, le cambia el nombre.
   */
  trashRestore(ids: string[], destination: 'original' | 'choose'): Promise<RestoreResponse>
  /** Muestra en el explorador un archivo resucitado en esta sesión. */
  trashReveal(path: string): Promise<void>
  /** Se llama cuando cambia la lista de cambios detectados. */
  onChanges(listener: () => void): () => void
  /** Configuración del modelo de lenguaje (sin la clave). */
  aiConfig(): Promise<AiConfig>
  /**
   * Comprueba una clave con el proveedor y devuelve los modelos que esa clave puede usar. La clave
   * se guarda en el proceso principal, nunca vuelve a la interfaz.
   */
  aiValidate(provider: AiProviderId, apiKey: string): Promise<AiValidation>
  /** Modelos disponibles con la clave ya guardada de `provider`. */
  aiListModels(provider: AiProviderId): Promise<AiValidation>
  /** Prueba el modelo con una consulta mínima y, si responde, guarda la configuración y la clave validada. */
  aiSave(input: AiSaveInput): Promise<AiSaved>
  /** Borra la clave guardada de un proveedor. */
  aiForgetKey(provider: AiProviderId): Promise<AiConfig>
  /** Qué hay instalado y qué falta. No descarga nada. */
  setupState(): Promise<SetupState>
  /** Instala lo que falte (motor local y modelos) y lo deja funcionando. Devuelve al terminar. */
  setupStart(): Promise<SetupState>
  setupCancel(): Promise<void>
  /** Carpetas habituales del usuario (Documentos, Descargas, Escritorio) que existen. */
  suggestFolders(): Promise<FolderSuggestion[]>
  /** Agrega una carpeta de `suggestFolders`. Cualquier otra ruta se rechaza. */
  addSuggestedFolder(path: string): Promise<Settings>
  /** Marca la bienvenida como hecha y empieza a indexar. */
  finishOnboarding(): Promise<Settings>
  onSetupState(listener: (state: SetupState) => void): () => void
  /** Estado de las actualizaciones (versión nueva en GitHub, descarga, lista para instalar). */
  updateState(): Promise<UpdateState>
  updateCheck(): Promise<UpdateState>
  /** Descarga la versión nueva o, si esta instalación no puede actualizarse sola, abre su página. */
  updateDownload(): Promise<UpdateState>
  /** Reinicia OUIJA instalando la versión descargada. */
  updateInstall(): Promise<void>
  onUpdateState(listener: (state: UpdateState) => void): () => void
  /** Minimiza la ventana a la barra de tareas o al dock. */
  minimize(): void
  /** Maximiza la ventana, o la devuelve a su tamaño si ya estaba maximizada. */
  toggleMaximize(): void
  /** Cierra OUIJA por completo. */
  quit(): void
  /** Suscripción a cambios del estado de indexación. Devuelve la función para cancelar. */
  onIndexState(listener: (state: IndexState) => void): () => void
  /** Se llama cada vez que la paleta se muestra (para enfocar el cuadro de búsqueda). */
  onShown(listener: () => void): () => void
}
