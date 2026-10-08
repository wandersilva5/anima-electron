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

  /** Reordena a lista (ordem da lista = ordem de aplicação no workflow) */
  const reorderLoras = useCallback((from: number, to: number) => {
    setSelectedLoras((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  return { selectedLoras, setSelectedLoras, toggleLora, clearLoras, setLoraStrength, reorderLoras }
}
