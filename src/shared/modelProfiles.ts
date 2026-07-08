import type { DiffusionModelId, ModelProfile } from './types'

export const MODEL_PROFILES: Record<DiffusionModelId, ModelProfile> = {
  anima: {
    id: 'anima',
    label: 'Anima',
    description: 'Modelo Anima — estilo anime detalhado',
    workflowFile: 'anima-simples.json',
    loraFolder: 'Anima',
    hasNegativePrompt: true,
    hasLoraClipStrength: true,
    defaults: {
      steps: 20,
      cfg: 5,
      width: 648,
      height: 1152,
      sampler: 'er_sde',
      scheduler: 'simple'
    }
  },
  krea2: {
    id: 'krea2',
    label: 'Krea2',
    description: 'Krea2 Turbo — geração rápida, sem prompt negativo',
    workflowFile: 'Krea2 - Simples.json',
    loraFolder: 'Krea2',
    hasNegativePrompt: false,
    hasLoraClipStrength: true,
    defaults: {
      steps: 8,
      cfg: 1,
      width: 512,
      height: 1024,
      sampler: 'euler',
      scheduler: 'simple'
    }
  },
  'z-image': {
    id: 'z-image',
    label: 'Z-Image',
    description: 'Z-Image Turbo — GGUF quantizado, rápido',
    workflowFile: 'Z-Image Turbo.json',
    loraFolder: 'z-image',
    hasNegativePrompt: true,
    hasLoraClipStrength: false,
    defaults: {
      steps: 9,
      cfg: 1,
      width: 704,
      height: 1024,
      sampler: 'euler',
      scheduler: 'normal'
    }
  }
}

export const MODEL_IDS: DiffusionModelId[] = ['anima', 'krea2', 'z-image']
