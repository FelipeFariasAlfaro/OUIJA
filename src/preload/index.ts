import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type IndexState, type MediumApi, type SetupState } from '@shared/ipc'

/** Cada método invoca un canal fijo. La interfaz no puede enviar mensajes a otros canales. */
const api: MediumApi = {
  ask: (question) => ipcRenderer.invoke(IPC.ask, question),
  ghosts: () => ipcRenderer.invoke(IPC.ghosts),
  people: () => ipcRenderer.invoke(IPC.people),
  timeline: (id) => ipcRenderer.invoke(IPC.timeline, id),
  decideNames: (decision, a, b) => ipcRenderer.invoke(IPC.decideNames, decision, a, b),
  openFile: (path) => ipcRenderer.invoke(IPC.openFile, path),
  showInFolder: (path) => ipcRenderer.invoke(IPC.showInFolder, path),
  exportFile: (path) => ipcRenderer.invoke(IPC.exportFile, path),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  addFolder: () => ipcRenderer.invoke(IPC.addFolder),
  removeFolder: (folder) => ipcRenderer.invoke(IPC.removeFolder, folder),
  indexNow: () => ipcRenderer.invoke(IPC.indexNow),
  cancelIndex: () => ipcRenderer.invoke(IPC.cancelIndex),
  indexState: () => ipcRenderer.invoke(IPC.indexState),
  forgetAll: () => ipcRenderer.invoke(IPC.forgetAll),
  ollamaStatus: () => ipcRenderer.invoke(IPC.ollamaStatus),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  recentChanges: (limit) => ipcRenderer.invoke(IPC.recentChanges, limit),
  trashList: () => ipcRenderer.invoke(IPC.trashList),
  trashRestore: (ids, destination) => ipcRenderer.invoke(IPC.trashRestore, ids, destination),
  trashReveal: (path) => ipcRenderer.invoke(IPC.trashReveal, path),
  onChanges: (listener) => {
    const handler = () => listener()
    ipcRenderer.on(IPC.onChanges, handler)
    return () => ipcRenderer.removeListener(IPC.onChanges, handler)
  },
  aiConfig: () => ipcRenderer.invoke(IPC.aiConfig),
  aiValidate: (provider, apiKey) => ipcRenderer.invoke(IPC.aiValidate, provider, apiKey),
  aiListModels: (provider) => ipcRenderer.invoke(IPC.aiListModels, provider),
  aiSave: (input) => ipcRenderer.invoke(IPC.aiSave, input),
  aiForgetKey: (provider) => ipcRenderer.invoke(IPC.aiForgetKey, provider),
  setupState: () => ipcRenderer.invoke(IPC.setupState),
  setupStart: () => ipcRenderer.invoke(IPC.setupStart),
  setupCancel: () => ipcRenderer.invoke(IPC.setupCancel),
  suggestFolders: () => ipcRenderer.invoke(IPC.suggestFolders),
  addSuggestedFolder: (path) => ipcRenderer.invoke(IPC.addSuggestedFolder, path),
  finishOnboarding: () => ipcRenderer.invoke(IPC.finishOnboarding),
  onSetupState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: SetupState) => listener(state)
    ipcRenderer.on(IPC.onSetupState, handler)
    return () => ipcRenderer.removeListener(IPC.onSetupState, handler)
  },
  minimize: () => ipcRenderer.send(IPC.minimize),
  quit: () => ipcRenderer.send(IPC.quit),
  onIndexState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: IndexState) => listener(state)
    ipcRenderer.on(IPC.onIndexState, handler)
    return () => ipcRenderer.removeListener(IPC.onIndexState, handler)
  },
  onShown: (listener) => {
    const handler = () => listener()
    ipcRenderer.on(IPC.onShown, handler)
    return () => ipcRenderer.removeListener(IPC.onShown, handler)
  }
}

contextBridge.exposeInMainWorld('medium', api)
