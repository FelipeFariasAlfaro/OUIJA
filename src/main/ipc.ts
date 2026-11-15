import { app, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { AiSaveInput } from '@shared/ai'
import { IPC, type AppInfo, type ExportResult, type Settings } from '@shared/ipc'
import type { MediumCore } from './core/medium'
import { suggestFolders } from './core/setup'
import { AI_PROVIDER_IDS } from '@shared/ai'
import { asOneOf, asString, isTrustedSender } from './security'
import type { PaletteWindow } from './window'

export interface IpcContext {
  core: MediumCore
  palette: PaletteWindow
  appFileUrl: string
  devServerUrl?: string
  appInfo(): AppInfo
  /** Se llama tras cambiar la configuración (para reaplicar atajo, menú, etc.). */
  onSettingsChanged(after: Settings, before: Settings): void
  getSettings(): Settings
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

  handle(IPC.ask, (_e, q) => core.ask(asString(q, 'pregunta', 2000)))
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
      dialog.showOpenDialog(palette.win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: ctx.getSettings().lang === 'es' ? 'Guardar aquí' : 'Save here' })
    )
    if (chosen.canceled || chosen.filePaths.length === 0) return { savedTo: null }
    const saved = await core.exportTo(file, chosen.filePaths[0])
    shell.showItemInFolder(saved)
    return { savedTo: saved }
  })

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
      dialog.showOpenDialog(palette.win, { properties: ['openDirectory'], buttonLabel: ctx.getSettings().lang === 'es' ? 'Entregar a OUIJA' : 'Add to OUIJA' })
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

  handle(IPC.recentChanges, (_e, limit) => core.recentChanges(typeof limit === 'number' ? limit : 30))
  handle(IPC.trashList, () => core.trashOverview())
  handle(IPC.trashRestore, async (_e, ids, destination) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((i) => typeof i === 'string' && i.length <= 40)) throw new Error('Argumento inválido: elementos')
    const where = asOneOf(destination, ['original', 'choose'] as const, 'destino')
    let dir: string | undefined
    if (where === 'choose') {
      const chosen = await palette.withoutHiding(() =>
        dialog.showOpenDialog(palette.win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: ctx.getSettings().lang === 'es' ? 'Resucitar aquí' : 'Resurrect here' })
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
  onTrusted(IPC.quit, () => app.quit())

  core.onState((state) => palette.send(IPC.onIndexState, state))
  core.setup.onState((state) => palette.send(IPC.onSetupState, state))
  core.onChanges(() => palette.send(IPC.onChanges))
}
