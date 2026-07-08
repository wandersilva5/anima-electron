import { create } from 'zustand'
import type { ComfyUIStatus, GenerationResult, GenerationParams, LoraInfo, ModelInfo, DiffusionModelId } from '@shared/types'
import { MODEL_PROFILES } from '../../shared/modelProfiles'

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
  setDiffusionModel: (id: DiffusionModelId) => void
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

const savedModel = (localStorage.getItem('anima-diffusion-model') as DiffusionModelId) || 'anima'
const profile = MODEL_PROFILES[savedModel]
const defaultParams: GenerationParams = {
  diffusionModel: savedModel,
  prompt: loadPrompt(`anima-prompt-${savedModel}`, ''),
  negativePrompt: loadPrompt(`anima-negative-prompt-${savedModel}`, ''),
  seed: Math.floor(Math.random() * 2147483647),
  steps: profile.defaults.steps,
  cfg: profile.defaults.cfg,
  width: profile.defaults.width,
  height: profile.defaults.height,
  loraName: null,
  loraStrengthModel: 0.5,
  loraStrengthClip: 0.5,
  modelName: savedModel === 'z-image' ? 'z-image\\z_image_turbo-Q4_K_M.gguf' :
             savedModel === 'krea2' ? 'krea2_turbo_fp8_scaled.safetensors' :
             'anima\\JANIMA_v10.safetensors'
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
    const state = useSessionStore.getState()
    const modelId = state.params.diffusionModel
    const prof = MODEL_PROFILES[modelId]
    const loras = await window.electronAPI.loras.list(prof.loraFolder)
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
    setPrompt: (prompt) => {
      const model = useSessionStore.getState().params.diffusionModel
      localStorage.setItem(`anima-prompt-${model}`, prompt)
      set((s) => ({ params: { ...s.params, prompt } }))
    },
    setNegativePrompt: (negativePrompt) => {
      const model = useSessionStore.getState().params.diffusionModel
      localStorage.setItem(`anima-negative-prompt-${model}`, negativePrompt)
      set((s) => ({ params: { ...s.params, negativePrompt } }))
    },
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
    setDiffusionModel: (diffusionModel) =>
      set((s) => {
        localStorage.setItem('anima-diffusion-model', diffusionModel)
        const prof = MODEL_PROFILES[diffusionModel]
        const savedPrompt = localStorage.getItem(`anima-prompt-${diffusionModel}`) || ''
        const savedNegPrompt = localStorage.getItem(`anima-negative-prompt-${diffusionModel}`) || ''

        const nextParams = {
          ...s.params,
          diffusionModel,
          prompt: savedPrompt,
          negativePrompt: savedNegPrompt,
          steps: prof.defaults.steps,
          cfg: prof.defaults.cfg,
          width: prof.defaults.width,
          height: prof.defaults.height,
          loraName: null,
          modelName: diffusionModel === 'z-image' ? 'z-image\\z_image_turbo-Q4_K_M.gguf' :
                     diffusionModel === 'krea2' ? 'krea2_turbo_fp8_scaled.safetensors' :
                     'anima\\JANIMA_v10.safetensors'
        }

        setTimeout(() => {
          useSessionStore.getState().refreshLoras()
        }, 50)

        return { params: nextParams }
      }),
    randomizeSeed: () => set((s) => ({ params: { ...s.params, seed: Math.floor(Math.random() * 2147483647) } }))
  }
}))
