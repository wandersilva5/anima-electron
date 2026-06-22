import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  comfyui: {
    getStatus: () => ipcRenderer.invoke('comfyui:status'),
    generate: (params: unknown) => ipcRenderer.invoke('comfyui:generate', params),
    setUrl: (url: string) => ipcRenderer.invoke('comfyui:setUrl', url),
    launch: () => ipcRenderer.invoke('comfyui:launch'),
    onProgress: (callback: (data: { current: number; max: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { current: number; max: number }) => callback(data)
      ipcRenderer.on('comfyui:progress', handler)
      return () => ipcRenderer.removeListener('comfyui:progress', handler)
    },
    onStatusUpdate: (callback: (data: { online: boolean; queueSize: number; launching: boolean }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { online: boolean; queueSize: number; launching: boolean }) => callback(data)
      ipcRenderer.on('comfyui:statusUpdate', handler)
      return () => ipcRenderer.removeListener('comfyui:statusUpdate', handler)
    },
    onLaunchError: (callback: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
      ipcRenderer.on('comfyui:launchError', handler)
      return () => ipcRenderer.removeListener('comfyui:launchError', handler)
    }
  },
  loras: {
    list: () => ipcRenderer.invoke('loras:list')
  },
  models: {
    list: () => ipcRenderer.invoke('models:list')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
    selectDir: () => ipcRenderer.invoke('settings:selectDir')
  },
  app: {
    getWorkflowDefaults: () => ipcRenderer.invoke('app:getWorkflowDefaults')
  },
  file: {
    loadHistory: () => ipcRenderer.invoke('file:loadHistory'),
    deleteHistoryItems: (ids: string[]) => ipcRenderer.invoke('file:deleteHistoryItems', ids),
    readImage: (filePath: string) => ipcRenderer.invoke('file:readImage', filePath)
  }
})
