import type { AppSettings, ComfyUIStatus, LoraInfo, ModelInfo } from '@shared/types'

interface GenerateResult {
  promptId: string
  images: { filename: string; data: string; filePath: string }[]
}

interface ComfyUIStatusWithLaunch extends ComfyUIStatus {
  launching: boolean
}

interface SavedHistoryItem {
  id: string
  filePath: string
  filename: string
  params: import('./types').GenerationParams
  timestamp: number
}

interface ElectronAPI {
  comfyui: {
    getStatus: () => Promise<ComfyUIStatus>
    generate: (params: unknown) => Promise<GenerateResult>
    setUrl: (url: string) => Promise<void>
    launch: () => Promise<{ success: boolean; message: string }>
    onProgress: (callback: (data: { current: number; max: number }) => void) => () => void
    onStatusUpdate: (callback: (data: ComfyUIStatusWithLaunch) => void) => () => void
    onLaunchError: (callback: (message: string) => void) => () => void
  }
  loras: {
    list: () => Promise<LoraInfo[]>
  }
  models: {
    list: () => Promise<ModelInfo[]>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (settings: AppSettings) => Promise<AppSettings>
    selectDir: () => Promise<string | null>
  }
  file: {
    loadHistory: () => Promise<SavedHistoryItem[]>
    deleteHistoryItems: (items: { id: string; filePath: string }[]) => Promise<void>
    readImage: (filePath: string) => Promise<string | null>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
