import { create } from 'zustand'
import type { ComfyUIStatus, GenerationResult, GenerationParams, LoraInfo, ModelInfo } from '@shared/types'

interface GenerationParamsState extends GenerationParams {
  setPrompt: (p: string) => void
  setNegativePrompt: (p: string) => void
  setSeed: (s: number) => void
  setSteps: (s: number) => void
  setCfg: (c: number) => void
  setWidth: (w: number) => void
  setHeight: (h: number) => void
  setLora: (name: string | null, modelStr?: number, clipStr?: number) => void
  setModel: (name: string) => void
  randomizeSeed: () => void
}

interface GenerationProgress {
  current: number
  max: number
}

interface SessionState {
  status: ComfyUIStatus
  setStatus: (s: ComfyUIStatus) => void
  generating: boolean
  setGenerating: (g: boolean) => void
  progress: GenerationProgress | null
  setProgress: (p: GenerationProgress | null) => void
  history: GenerationResult[]
  addToHistory: (r: GenerationResult) => void
  setHistory: (h: GenerationResult[]) => void
  deleteHistory: (ids: string[]) => void
  selectedId: string | null
  selectImage: (id: string | null) => void
  loras: LoraInfo[]
  setLoras: (l: LoraInfo[]) => void
  refreshLoras: () => Promise<void>
  models: ModelInfo[]
  setModels: (m: ModelInfo[]) => void
  refreshModels: () => Promise<void>
  comfyUrl: string
  setComfyUrl: (url: string) => void
  theme: 'dark' | 'light'
  toggleTheme: () => void
  generateTrigger: number
  requestGenerate: () => void
  params: GenerationParamsState
}

function loadPrompt(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

const defaultParams: GenerationParams = {
  prompt: loadPrompt('anima-prompt', ''),
  negativePrompt: loadPrompt('anima-negative-prompt', ''),
  seed: Math.floor(Math.random() * 2147483647),
  steps: 20,
  cfg: 5,
  width: 648,
  height: 1152,
  loraName: null,
  loraStrengthModel: 0.5,
  loraStrengthClip: 0.5,
  modelName: 'anima/JANIMA_v10.safetensors'
}

export const useSessionStore = create<SessionState>((set) => ({
  status: { online: false, queueSize: 0 },
  setStatus: (status) => set({ status }),
  generating: false,
  setGenerating: (generating) => set({ generating }),
  progress: null,
  setProgress: (progress) => set({ progress }),
  history: [],
  addToHistory: (result) => set((s) => ({ history: [result, ...s.history] })),
  setHistory: (history) => set({ history }),
  deleteHistory: (ids) => set((s) => ({
    history: s.history.filter((h) => !ids.includes(h.id)),
    selectedId: ids.includes(s.selectedId ?? '') ? null : s.selectedId
  })),
  selectedId: null,
  selectImage: (selectedId) => set({ selectedId }),
  loras: [],
  setLoras: (loras) => set({ loras }),
  refreshLoras: async () => {
    const loras = await window.electronAPI.loras.list()
    set({ loras })
  },
  models: [],
  setModels: (models) => set({ models }),
  refreshModels: async () => {
    const models = await window.electronAPI.models.list()
    set({ models })
  },
  comfyUrl: 'http://127.0.0.1:8188',
  setComfyUrl: (comfyUrl) => set({ comfyUrl }),
  theme: (localStorage.getItem('anima-theme') as 'dark' | 'light') || 'dark',
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('anima-theme', next)
      return { theme: next }
    }),
  generateTrigger: 0,
  requestGenerate: () => set((s) => ({ generateTrigger: s.generateTrigger + 1 })),
  params: {
    ...defaultParams,
    setPrompt: (prompt) => { localStorage.setItem('anima-prompt', prompt); set((s) => ({ params: { ...s.params, prompt } })) },
    setNegativePrompt: (negativePrompt) => { localStorage.setItem('anima-negative-prompt', negativePrompt); set((s) => ({ params: { ...s.params, negativePrompt } })) },
    setSeed: (seed) => set((s) => ({ params: { ...s.params, seed } })),
    setSteps: (steps) => set((s) => ({ params: { ...s.params, steps } })),
    setCfg: (cfg) => set((s) => ({ params: { ...s.params, cfg } })),
    setWidth: (width) => set((s) => ({ params: { ...s.params, width } })),
    setHeight: (height) => set((s) => ({ params: { ...s.params, height } })),
    setLora: (loraName, modelStr, clipStr) =>
      set((s) => ({
        params: {
          ...s.params,
          loraName,
          loraStrengthModel: modelStr ?? s.params.loraStrengthModel,
          loraStrengthClip: clipStr ?? s.params.loraStrengthClip
        }
      })),
    setModel: (modelName) => set((s) => ({ params: { ...s.params, modelName } })),
    randomizeSeed: () => set((s) => ({ params: { ...s.params, seed: Math.floor(Math.random() * 2147483647) } }))
  }
}))
