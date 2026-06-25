import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electronAPI", {
  comfyui: {
    getStatus: () => ipcRenderer.invoke("comfyui:status"),
    generate: (params) => ipcRenderer.invoke("comfyui:generate", params),
    setUrl: (url) => ipcRenderer.invoke("comfyui:setUrl", url),
    launch: () => ipcRenderer.invoke("comfyui:launch"),
    onProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("comfyui:progress", handler);
      return () => ipcRenderer.removeListener("comfyui:progress", handler);
    },
    onStatusUpdate: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("comfyui:statusUpdate", handler);
      return () => ipcRenderer.removeListener("comfyui:statusUpdate", handler);
    },
    onLaunchError: (callback) => {
      const handler = (_event, message) => callback(message);
      ipcRenderer.on("comfyui:launchError", handler);
      return () => ipcRenderer.removeListener("comfyui:launchError", handler);
    }
  },
  loras: {
    list: () => ipcRenderer.invoke("loras:list")
  },
  models: {
    list: () => ipcRenderer.invoke("models:list")
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (settings) => ipcRenderer.invoke("settings:set", settings),
    selectDir: () => ipcRenderer.invoke("settings:selectDir")
  },
  app: {
    getWorkflowDefaults: () => ipcRenderer.invoke("app:getWorkflowDefaults")
  },
  file: {
    loadHistory: () => ipcRenderer.invoke("file:loadHistory"),
    deleteHistoryItems: (items) => ipcRenderer.invoke("file:deleteHistoryItems", items),
    readImage: (filePath) => ipcRenderer.invoke("file:readImage", filePath)
  }
});
