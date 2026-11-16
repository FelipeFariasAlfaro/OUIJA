import { app, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { AiSaveInput } from '@shared/ai'
import { IPC, type AskFilters, type AppInfo, type ExportResult, type PresentResult, type Settings } from '@shared/ipc'
import type { Lang } from '@shared/langs'
import { ALL_KINDS, type FileKind } from '@shared/filetypes'
import type { MediumCore } from './core/medium'
import type { Updater } from './updater'
import { suggestFolders } from './core/setup'
import { AI_PROVIDER_IDS } from '@shared/ai'
import { asOneOf, asString, isTrustedSender } from './security'
import type { PaletteWindow } from './window'

/** Botón de los diálogos del sistema, en el idioma de la interfaz. */
const DIALOG: Record<Lang, { save: string; add: string; resurrect: string; present: string }> = {
  es: { save: 'Guardar aquí', add: 'Entregar a OUIJA', resurrect: 'Resucitar aquí', present: 'Traer aquí' },
  en: { save: 'Save here', add: 'Add to OUIJA', resurrect: 'Resurrect here', present: 'Bring it here' },
  pt: { save: 'Salvar aqui', add: 'Entregar ao OUIJA', resurrect: 'Ressuscitar aqui', present: 'Trazer para cá' },
  fr: { save: 'Enregistrer ici', add: 'Confier à OUIJA', resurrect: 'Ressusciter ici', present: 'Ramener ici' },
  ja: { save: 'ここに保存', add: 'OUIJA に渡す', resurrect: 'ここに復活', present: 'ここに持ってくる' },
  zh: { save: '保存到这里', add: '交给 OUIJA', resurrect: '在此复活', present: '带到这里' }
}

/** Valida los filtros de búsqueda que llegan de la interfaz: lo que no se reconoce se descarta. */
function asFilters(raw: unknown): AskFilters | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const date = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  const kinds = Array.isArray(o.kinds) ? [...new Set(o.kinds.filter((k): k is FileKind => typeof k === 'string' && (ALL_KINDS as string[]).includes(k)))] : []
  const out: AskFilters = {}
  if (kinds.length > 0) out.kinds = kinds
  if (date(o.dateFrom) !== undefined) out.dateFrom = date(o.dateFrom)
  if (date(o.dateTo) !== undefined) out.dateTo = date(o.dateTo)
  return Object.keys(out).length > 0 ? out : undefined
}

export interface IpcContext {
  core: MediumCore
  palette: PaletteWindow
  appFileUrl: string
  devServerUrl?: string
  appInfo(): AppInfo
  /** Se llama tras cambiar la configuración (para reaplicar atajo, menú, etc.). */
  onSettingsChanged(after: Settings, before: Settings): void
  getSettings(): Settings
  /** JSON para el `mcp.json` de un agente, con las rutas de esta instalación. */
  mcpConfig(): string
  updater: Updater
}

/**
 * Registra los canales IPC. Cada uno valida de dónde viene la llamada y qué argumentos trae. La
 * interfaz nunca recibe rutas arbitrarias del disco: solo puede actuar sobre lo que está en el índice.
 */
export function registerIpc(ctx: IpcContext): void {
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent): void => {
    const url = event.senderFrame?.url ?? ''
    if (!isTrustedSender(url, ctx.appFileUrl, ctx.devServerUrl)) throw new Error('Origen no autorizado')
  }
  const handle = <T>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      trusted(event)
      return fn(event, ...args)
    })
  }
  const { core, palette } = ctx
  /** Rutas resucitadas en esta sesión: lo único que `trashReveal` acepta. */
  const restoredPaths = new Set<string>()

  handle(IPC.ask, (_e, q, filters) => core.ask(asString(q, 'pregunta', 2000), asFilters(filters)))
  handle(IPC.ghosts, () => core.ghosts())
  handle(IPC.people, () => core.people())
  handle(IPC.timeline, (_e, id) => core.timeline(asString(id, 'id', 300)))
  handle(IPC.decideNames, (_e, decision, a, b) =>
    core.decideNames(asOneOf(decision, ['merge', 'split', 'clear'] as const, 'decisión'), asString(a, 'nombre', 200), asString(b, 'nombre', 200))
  )

  handle(IPC.openFile, async (_e, path) => {
    const target = await core.preparePathToOpen(asString(path, 'ruta'))
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })
  handle(IPC.showInFolder, async (_e, path) => shell.showItemInFolder(await core.pathToReveal(asString(path, 'ruta'))))
  handle(IPC.exportFile, async (_e, path): Promise<ExportResult> => {
    const file = asString(path, 'ruta')
    await core.requireIndexed(file) // antes de molestar al usuario con un diálogo
    const chosen = await palette.withoutHiding(() =>
      dialog.showOpenDialog(palette.win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: DIALOG[ctx.getSettings().lang].save })
    )
    if (chosen.canceled || chosen.filePaths.length === 0) return { savedTo: null }
    const saved = await core.exportTo(file, chosen.filePaths[0])
    shell.showItemInFolder(saved)
    return { savedTo: saved }
  })

  handle(IPC.bringToPresent, async (_e, path): Promise<PresentResult> => {
    const file = asString(path, 'ruta')
    await core.requireIndexed(file)
    const chosen = await palette.withoutHiding(() =>
      dialog.showOpenDialog(palette.win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: DIALOG[ctx.getSettings().lang].present })
    )
    if (chosen.canceled || chosen.filePaths.length === 0) return { savedTo: null }
    const r = await core.bringToPresent(file, chosen.filePaths[0])
    shell.showItemInFolder(r.savedTo)
    return r
  })
  handle(IPC.mcpConfig, () => ctx.mcpConfig())

  handle(IPC.getSettings, () => ctx.getSettings())
  handle(IPC.setSettings, async (_e, patch) => {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new Error('Argumento inválido: configuración')
    const before = ctx.getSettings()
    // El modelo de lenguaje y su clave solo se cambian por `aiSave`, que prueba el modelo antes de guardar.
    const { ai: _ai, onboarded: _onboarded, ...allowed } = patch as Partial<Settings>
    void _ai
    void _onboarded
    const after = await core.updateSettings(allowed)
    ctx.onSettingsChanged(after, before)
    return after
  })
  handle(IPC.addFolder, async () => {
    const chosen = await palette.withoutHiding(() =>
      dialog.showOpenDialog(palette.win, { properties: ['openDirectory'], buttonLabel: DIALOG[ctx.getSettings().lang].add })
    )
    if (chosen.canceled || chosen.filePaths.length === 0) return ctx.getSettings()
    const before = ctx.getSettings()
    const after = await core.addFolder(chosen.filePaths[0])
    ctx.onSettingsChanged(after, before)
    void core.indexNow()
    return after
  })
  handle(IPC.removeFolder, async (_e, folder) => {
    const before = ctx.getSettings()
    const after = await core.removeFolder(asString(folder, 'carpeta'))
    ctx.onSettingsChanged(after, before)
    return after
  })

  handle(IPC.fileKinds, () => core.fileKinds())
  handle(IPC.recentChanges, (_e, limit) => core.recentChanges(typeof limit === 'number' ? limit : 30))
  handle(IPC.trashList, () => core.trashOverview())
  handle(IPC.trashRestore, async (_e, ids, destination) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((i) => typeof i === 'string' && i.length <= 40)) throw new Error('Argumento inválido: elementos')
    const where = asOneOf(destination, ['original', 'choose'] as const, 'destino')
    let dir: string | undefined
    if (where === 'choose') {
      const chosen = await palette.withoutHiding(() =>
        dialog.showOpenDialog(palette.win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: DIALOG[ctx.getSettings().lang].resurrect })
      )
      if (chosen.canceled || chosen.filePaths.length === 0) return { canceled: true, results: [] }
      dir = chosen.filePaths[0]
    }
    const results = await core.restoreFromTrash(ids as string[], dir)
    for (const r of results) if (r.ok) restoredPaths.add(r.restoredTo)
    return { canceled: false, results }
  })
  handle(IPC.trashReveal, (_e, path) => {
    const file = asString(path, 'ruta')
    if (!restoredPaths.has(file)) throw new Error('Solo se pueden mostrar archivos resucitados en esta sesión')
    shell.showItemInFolder(file)
  })
  handle(IPC.aiConfig, () => core.ai.config())
  handle(IPC.aiValidate, (_e, provider, key) => core.ai.validate(asOneOf(provider, AI_PROVIDER_IDS, 'proveedor'), asString(key, 'clave', 400)))
  handle(IPC.aiListModels, (_e, provider) => core.ai.listModels(asOneOf(provider, AI_PROVIDER_IDS, 'proveedor')))
  handle(IPC.aiSave, async (_e, input) => {
    if (typeof input !== 'object' || input === null) throw new Error('Argumento inválido: configuración de IA')
    const i = input as AiSaveInput
    const result = await core.ai.save({
      mode: asOneOf(i.mode, ['local', 'remote'] as const, 'modo'),
      provider: i.provider === undefined ? undefined : asOneOf(i.provider, AI_PROVIDER_IDS, 'proveedor'),
      model: i.model === undefined ? undefined : asString(i.model, 'modelo', 120),
      remoteDocuments: i.remoteDocuments === true
    })
    // Al volver al modelo local, se descarga el modelo de respuestas si falta.
    if (result.ok && result.config.mode === 'local') void core.setup.start()
    if (result.ok) void core.modelsChanged()
    return result
  })
  handle(IPC.aiForgetKey, (_e, provider) => core.ai.forgetKey(asOneOf(provider, AI_PROVIDER_IDS, 'proveedor')))
  handle(IPC.updateState, () => ctx.updater.value)
  handle(IPC.updateCheck, () => ctx.updater.check())
  handle(IPC.updateDownload, () => ctx.updater.download())
  handle(IPC.updateInstall, () => ctx.updater.install())
  handle(IPC.setupState, () => core.setup.check())
  handle(IPC.setupStart, () => core.setup.start())
  handle(IPC.setupCancel, () => core.setup.cancel())
  handle(IPC.suggestFolders, () => suggestFolders())
  handle(IPC.addSuggestedFolder, async (_e, path) => {
    const wanted = asString(path, 'carpeta')
    if (!(await suggestFolders()).some((f) => f.path === wanted)) throw new Error('Carpeta no sugerida')
    const before = ctx.getSettings()
    const after = await core.addFolder(wanted)
    ctx.onSettingsChanged(after, before)
    return after
  })
  handle(IPC.finishOnboarding, async () => {
    const before = ctx.getSettings()
    const after = await core.updateSettings({ onboarded: true })
    ctx.onSettingsChanged(after, before)
    void core.indexNow()
    return after
  })

  handle(IPC.indexNow, () => {
    void core.indexNow()
  })
  handle(IPC.cancelIndex, () => core.cancelIndex())
  handle(IPC.indexState, () => core.getState())
  handle(IPC.forgetAll, () => core.forgetAll())
  handle(IPC.ollamaStatus, () => core.ollamaStatus())
  handle(IPC.appInfo, () => ctx.appInfo())

  const onTrusted = (channel: string, action: () => void): void => {
    ipcMain.on(channel, (event) => {
      try {
        trusted(event)
        action()
      } catch {
        // llamada no autorizada: se ignora
      }
    })
  }
  onTrusted(IPC.minimize, () => palette.minimize())
  onTrusted(IPC.toggleMaximize, () => palette.toggleMaximize())
  onTrusted(IPC.quit, () => app.quit())

  core.onState((state) => palette.send(IPC.onIndexState, state))
  core.setup.onState((state) => palette.send(IPC.onSetupState, state))
  ctx.updater.onChange((state) => palette.send(IPC.onUpdateState, state))
  core.onChanges(() => palette.send(IPC.onChanges))
}
