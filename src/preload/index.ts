import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  comfyui: {
    getStatus: () => ipcRenderer.invoke('comfyui:status'),
    generate: (params: unknown) => ipcRenderer.invoke('comfyui:generate', params),
    generateImprove: (params: unknown) => ipcRenderer.invoke('comfyui:generateImprove', params),
    generatePose: (params: unknown) => ipcRenderer.invoke('comfyui:generatePose', params),
    captionImage: (params: { imageBase64: string }) => ipcRenderer.invoke('comfyui:captionImage', params),
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
    list: (subfolder?: string) => ipcRenderer.invoke('loras:list', subfolder)
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
    getWorkflowDefaults: (diffusionModel?: string) => ipcRenderer.invoke('app:getWorkflowDefaults', diffusionModel),
    getModelProfiles: () => ipcRenderer.invoke('app:getModelProfiles')
  },
  file: {
    loadHistory: () => ipcRenderer.invoke('file:loadHistory'),
    deleteHistoryItems: (items: { id: string; filePath: string }[]) => ipcRenderer.invoke('file:deleteHistoryItems', items),
    readImage: (filePath: string) => ipcRenderer.invoke('file:readImage', filePath)
  }
})
