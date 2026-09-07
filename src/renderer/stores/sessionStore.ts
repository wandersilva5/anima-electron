import { create } from 'zustand'
import type { ComfyUIStatus, GenerationResult, GenerationParams, LoraInfo, ModelInfo, DiffusionModelId, LoraSelection } from '@shared/types'
import { MODEL_PROFILES } from '@shared/modelProfiles'
import { playCompletionSound } from '../utils/sound'

interface GenerationParamsState extends GenerationParams {
  setPrompt: (p: string) => void
  setNegativePrompt: (p: string) => void
  setSeed: (s: number) => void
  setSteps: (s: number) => void
  setCfg: (c: number) => void
  setWidth: (w: number) => void
  setHeight: (h: number) => void
  toggleLora: (name: string) => void
  clearLoras: () => void
  setLoraStrength: (name: string, kind: 'model' | 'clip', v: number) => void
  setModel: (name: string) => void
  setDiffusionModel: (id: DiffusionModelId) => void
  randomizeSeed: () => void
  setFilenamePrefix: (prefix: string) => void
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
  pendingHistoryPick: GenerationResult | null
  requestHistoryPick: (item: GenerationResult | null) => void
  selectedId: string | null
  selectImage: (id: string | null) => void
  loras: LoraInfo[]
  setLoras: (l: LoraInfo[]) => void
  /** Lista de LoRAs para as abas Melhorar/Recriar (seleção separada da aba Gerar) */
  tabLoras: LoraInfo[]
  setTabLoras: (l: LoraInfo[]) => void
  refreshLoras: () => Promise<void>
  models: ModelInfo[]
  setModels: (m: ModelInfo[]) => void
  theme: 'dark' | 'light'
  toggleTheme: () => void
  generateTrigger: number
  requestGenerate: () => void
  seedLocked: boolean
  setSeedLocked: (locked: boolean) => void
  params: GenerationParamsState
}

function loadPrompt(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

function loadNum(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    const n = raw !== null ? Number(raw) : NaN
    return Number.isFinite(n) ? n : fallback
  } catch { return fallback }
}

/** Carrega LoRAs salvos para o modelo de difusão; descarta entradas malformadas */
function loadLoras(model: DiffusionModelId): LoraSelection[] {
  try {
    const raw = localStorage.getItem(`anima-loras-${model}`)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (l): l is LoraSelection =>
        !!l && typeof l === 'object' &&
        typeof (l as LoraSelection).name === 'string' &&
        typeof (l as LoraSelection).strengthModel === 'number' &&
        typeof (l as LoraSelection).strengthClip === 'number'
    )
  } catch { return [] }
}

function saveLoras(model: DiffusionModelId, loras: LoraSelection[]): void {
  try { localStorage.setItem(`anima-loras-${model}`, JSON.stringify(loras)) } catch { /* ignore */ }
}

const savedModel = (localStorage.getItem('anima-diffusion-model') as DiffusionModelId) || 'anima'
const profile = MODEL_PROFILES[savedModel]
const defaultParams: GenerationParams = {
  diffusionModel: savedModel,
  prompt: loadPrompt(`anima-prompt-${savedModel}`, ''),
  negativePrompt: loadPrompt(`anima-negative-prompt-${savedModel}`, ''),
  seed: Math.floor(Math.random() * 2147483647),
  steps: loadNum(`anima-steps-${savedModel}`, profile.defaults.steps),
  cfg: loadNum(`anima-cfg-${savedModel}`, profile.defaults.cfg),
  width: loadNum(`anima-width-${savedModel}`, profile.defaults.width),
  height: loadNum(`anima-height-${savedModel}`, profile.defaults.height),
  loras: loadLoras(savedModel),
  modelName: localStorage.getItem(`anima-checkpoint-${savedModel}`) || '',
  filenamePrefix: localStorage.getItem('anima-filename-prefix') || 'anima'
}

export const useSessionStore = create<SessionState>((set) => ({
  status: { online: false, queueSize: 0 },
  setStatus: (status) => set({ status }),
  generating: false,
  setGenerating: (generating) => set({ generating }),
  progress: null,
  setProgress: (progress) => set({ progress }),
  history: [],
  addToHistory: (result) => {
    playCompletionSound()
    set((s) => ({ history: [result, ...s.history] }))
  },
  setHistory: (history) => set({ history }),
  deleteHistory: (ids) => set((s) => ({
    history: s.history.filter((h) => !ids.includes(h.id)),
    selectedId: ids.includes(s.selectedId ?? '') ? null : s.selectedId
  })),
  pendingHistoryPick: null,
  requestHistoryPick: (pendingHistoryPick) => set({ pendingHistoryPick }),
  selectedId: null,
  selectImage: (selectedId) => set({ selectedId }),
  loras: [],
  setLoras: (loras) => set((s) => {
    // Remove seleções que não existem mais na pasta; mantém as válidas
    const valid = s.params.loras.filter((sel) => loras.some((l) => l.name === sel.name))
    if (valid.length === 0 && loras.length > 0) {
      return { loras, params: { ...s.params, loras: [{ name: loras[0].name, strengthModel: 0.5, strengthClip: 0.5 }] } }
    }
    if (valid.length !== s.params.loras.length) {
      return { loras, params: { ...s.params, loras: valid } }
    }
    return { loras }
  }),
  // Lista de LoRAs exibida em outra aba — NÃO sanitiza params.loras (seleção da aba Gerar),
  // pois cada aba gerencia sua própria seleção
  tabLoras: [],
  setTabLoras: (tabLoras) => set({ tabLoras }),
  refreshLoras: async () => {
    const state = useSessionStore.getState()
    const modelId = state.params.diffusionModel
    const prof = MODEL_PROFILES[modelId]
    const loras = await window.electronAPI.loras.list(prof.loraFolder)
    state.setLoras(loras)
  },
  models: [],
  setModels: (models) => set((s) => {
    const isGGUF = s.params.diffusionModel === 'z-image'
    const compatible = models.filter(m => isGGUF ? m.name.endsWith('.gguf') : m.name.endsWith('.safetensors'))
    const hasCurrent = models.some(m => m.name === s.params.modelName)
    if (!hasCurrent && compatible.length > 0) {
      return { models, params: { ...s.params, modelName: compatible[0].name } }
    }
    return { models }
  }),
  theme: (localStorage.getItem('anima-theme') as 'dark' | 'light') || 'dark',
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('anima-theme', next)
      return { theme: next }
    }),
  generateTrigger: 0,
  requestGenerate: () => set((s) => ({ generateTrigger: s.generateTrigger + 1 })),
  seedLocked: (localStorage.getItem('anima-seed-locked') === 'true'),
  setSeedLocked: (seedLocked) => {
    localStorage.setItem('anima-seed-locked', String(seedLocked))
    set({ seedLocked })
  },
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
    setSteps: (steps) => {
      const model = useSessionStore.getState().params.diffusionModel
      localStorage.setItem(`anima-steps-${model}`, String(steps))
      set((s) => ({ params: { ...s.params, steps } }))
    },
    setCfg: (cfg) => {
      const model = useSessionStore.getState().params.diffusionModel
      localStorage.setItem(`anima-cfg-${model}`, String(cfg))
      set((s) => ({ params: { ...s.params, cfg } }))
    },
    setWidth: (width) => {
      const model = useSessionStore.getState().params.diffusionModel
      localStorage.setItem(`anima-width-${model}`, String(width))
      set((s) => ({ params: { ...s.params, width } }))
    },
    setHeight: (height) => {
      const model = useSessionStore.getState().params.diffusionModel
      localStorage.setItem(`anima-height-${model}`, String(height))
      set((s) => ({ params: { ...s.params, height } }))
    },
    toggleLora: (name) =>
      set((s) => {
        const exists = s.params.loras.some((l) => l.name === name)
        const next = exists
          ? s.params.loras.filter((l) => l.name !== name)
          : [...s.params.loras, { name, strengthModel: 0.5, strengthClip: 0.5 }]
        saveLoras(s.params.diffusionModel, next)
        return { params: { ...s.params, loras: next } }
      }),
    clearLoras: () =>
      set((s) => {
        saveLoras(s.params.diffusionModel, [])
        return { params: { ...s.params, loras: [] } }
      }),
    setLoraStrength: (name, kind, value) =>
      set((s) => {
        const next = s.params.loras.map((l) =>
          l.name === name
            ? (kind === 'model' ? { ...l, strengthModel: value } : { ...l, strengthClip: value })
            : l
        )
        saveLoras(s.params.diffusionModel, next)
        return { params: { ...s.params, loras: next } }
      }),
    setModel: (modelName) => {
      const model = useSessionStore.getState().params.diffusionModel
      localStorage.setItem(`anima-checkpoint-${model}`, modelName)
      set((s) => ({ params: { ...s.params, modelName } }))
    },
    setDiffusionModel: (diffusionModel) =>
      set((s) => {
        localStorage.setItem('anima-diffusion-model', diffusionModel)
        const prof = MODEL_PROFILES[diffusionModel]
        const savedPrompt = localStorage.getItem(`anima-prompt-${diffusionModel}`) || ''
        const savedNegPrompt = localStorage.getItem(`anima-negative-prompt-${diffusionModel}`) || ''

        const isGGUF = diffusionModel === 'z-image'
        const compatible = s.models.filter(m => isGGUF ? m.name.endsWith('.gguf') : m.name.endsWith('.safetensors'))
        const savedCheckpoint = localStorage.getItem(`anima-checkpoint-${diffusionModel}`) || ''
        const found = compatible.find(m => m.name === savedCheckpoint)
        const modelName = found ? savedCheckpoint : (compatible[0]?.name ?? '')

        const nextParams = {
          ...s.params,
          diffusionModel,
          prompt: savedPrompt,
          negativePrompt: savedNegPrompt,
          steps: loadNum(`anima-steps-${diffusionModel}`, prof.defaults.steps),
          cfg: loadNum(`anima-cfg-${diffusionModel}`, prof.defaults.cfg),
          width: loadNum(`anima-width-${diffusionModel}`, prof.defaults.width),
          height: loadNum(`anima-height-${diffusionModel}`, prof.defaults.height),
          loras: loadLoras(diffusionModel),
          modelName
        }

        setTimeout(() => {
          useSessionStore.getState().refreshLoras()
        }, 50)

        return { params: nextParams }
      }),
    randomizeSeed: () => set((s) => ({ params: { ...s.params, seed: Math.floor(Math.random() * 2147483647) } })),
    setFilenamePrefix: (filenamePrefix) => {
      localStorage.setItem('anima-filename-prefix', filenamePrefix)
      set((s) => ({ params: { ...s.params, filenamePrefix } }))
    }
  }
}))
