import { useEffect } from 'react'
import type { ModelInfo, DiffusionModelId } from '@shared/types'
import { useFilterModels } from './useFilterModels'

export function useAutoSelectModel(
  models: ModelInfo[],
  diffusionModel: DiffusionModelId,
  current: string,
  setCurrent: (name: string) => void
): void {
  const compatible = useFilterModels(models, diffusionModel)
  useEffect(() => {
    if (compatible.length > 0 && !compatible.some(m => m.name === current)) {
      setCurrent(compatible[0].name)
    }
  }, [compatible, current, setCurrent])
}
