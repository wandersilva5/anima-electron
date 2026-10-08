import type { DiffusionModelId, ImproveEditMode, LoraSelection, RegionalLoraSlot } from '@shared/types'

/**
 * Persistência por aba das últimas configurações usadas.
 * Cada aba guarda seu próprio snapshot em localStorage, isolado por chave.
 */

const PREFIX = 'anima-tab'

export interface RegionalSettings {
  enabled: boolean
  face: RegionalLoraSlot | null
  breasts: RegionalLoraSlot | null
  body: RegionalLoraSlot | null
}

interface TabSettings {
  diffusionModel: DiffusionModelId
  checkpoint: string
  loras: LoraSelection[]
  prompt: string
  denoise: number
  captionMode?: 'descriptive' | 'tags'
  regional?: RegionalSettings
  editMode?: ImproveEditMode
}

export function loadTabSettings(key: string): Partial<TabSettings> {
  try {
    const raw = localStorage.getItem(`${PREFIX}-${key}`)
    return raw ? (JSON.parse(raw) as Partial<TabSettings>) : {}
  } catch {
    return {}
  }
}

export function saveTabSettings(key: string, settings: Partial<TabSettings>): void {
  try {
    localStorage.setItem(`${PREFIX}-${key}`, JSON.stringify(settings))
  } catch {
    // localStorage cheio/indisponível — ignora silenciosamente
  }
}

/** Debounce simples para não gravar localStorage a cada tecla */
export function debouncedSaveTabSettings(key: string, delay = 400): (settings: Partial<TabSettings>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (settings) => {
    clearTimeout(timer)
    timer = setTimeout(() => saveTabSettings(key, settings), delay)
  }
}
