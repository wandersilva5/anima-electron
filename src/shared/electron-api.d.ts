import type { AppSettings, ComfyUIStatus, LoraInfo, ModelInfo } from '@shared/types'

interface GenerateResult {
  promptId: string
  images: { filename: string; data: string; filePath: string }[]
  warning?: string
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
    generateImprove: (params: unknown) => Promise<GenerateResult>
    generatePose: (params: import('./types').PoseGenerationParams) => Promise<GenerateResult>
    generateOutfit: (params: import('./types').OutfitGenerationParams) => Promise<GenerateResult>
    captionImage: (params: { imageBase64: string; mode?: 'descriptive' | 'tags' }) => Promise<{ text: string }>
    clearCache: () => Promise<{ success: boolean; message: string }>
    setUrl: (url: string) => Promise<void>
    launch: () => Promise<{ success: boolean; message: string }>
    onProgress: (callback: (data: { current: number; max: number }) => void) => () => void
    onStatusUpdate: (callback: (data: ComfyUIStatusWithLaunch) => void) => () => void
    onLaunchError: (callback: (message: string) => void) => () => void
  }
  loras: {
    list: (subfolder?: string) => Promise<LoraInfo[]>
  }
  models: {
    list: () => Promise<ModelInfo[]>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (settings: AppSettings) => Promise<AppSettings>
    selectDir: () => Promise<string | null>
  }
  app: {
    getWorkflowDefaults: (diffusionModel?: string) => Promise<any>
    getModelProfiles: () => Promise<Record<string, import('./types').ModelProfile>>
    getVersion: () => Promise<string>
    /** Workflow JSON da aba Pose (VNCCS Pose Studio QI2.1) para carregar no webview */
    getPoseStudioWorkflow: () => Promise<import('./types').WorkflowJSON | null>
  }
  file: {
    loadHistory: () => Promise<SavedHistoryItem[]>
    deleteHistoryItems: (items: { id: string; filePath: string }[]) => Promise<void>
    readImage: (filePath: string) => Promise<string | null>
    readThumbnail: (filePath: string) => Promise<string | null>
    selectImage: () => Promise<string | null>
  }
  pose: {
    extractFromImage: (imagePath: string) => Promise<Record<string, [number, number]> | null>
    extractFromBase64: (imageBase64: string) => Promise<Record<string, [number, number]> | null>
  }
  clipboard: {
    readImage: () => Promise<string | null>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
