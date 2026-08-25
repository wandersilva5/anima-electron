import { useCallback, useState } from 'react'
import type { LoraSelection } from '@shared/types'

export function useLoraSelection(initial: LoraSelection[] = []) {
  const [selectedLoras, setSelectedLoras] = useState<LoraSelection[]>(initial)

  const toggleLora = useCallback((name: string) => {
    setSelectedLoras((prev) =>
      prev.some((l) => l.name === name)
        ? prev.filter((l) => l.name !== name)
        : [...prev, { name, strengthModel: 0.5, strengthClip: 0.5 }]
    )
  }, [])

  const clearLoras = useCallback(() => setSelectedLoras([]), [])

  const setLoraStrength = useCallback((name: string, kind: 'model' | 'clip', value: number) => {
    setSelectedLoras((prev) =>
      prev.map((l) =>
        l.name === name
          ? (kind === 'model' ? { ...l, strengthModel: value } : { ...l, strengthClip: value })
          : l
      )
    )
  }, [])

  return { selectedLoras, toggleLora, clearLoras, setLoraStrength }
}
