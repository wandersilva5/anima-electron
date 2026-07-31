import { useMemo } from 'react'
import type { ModelInfo, DiffusionModelId } from '@shared/types'

export function useFilterModels(models: ModelInfo[], diffusionModel: DiffusionModelId): ModelInfo[] {
  return useMemo(() => {
    return models.filter((model) => {
      const name = model.name.toLowerCase()
      if (diffusionModel === 'anima') {
        return name.includes('anima')
      } else if (diffusionModel === 'krea2') {
        return name.includes('krea') || name.includes('krea2') || name === 'krea2_turbo_fp8_scaled.safetensors'
      } else if (diffusionModel === 'z-image') {
        return name.includes('z-image') || name.includes('z_image')
      }
      return true
    })
  }, [models, diffusionModel])
}
