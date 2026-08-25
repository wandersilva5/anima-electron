import type { GenerationParams, LoraSelection } from '@shared/types'

type LegacyParams = Partial<GenerationParams> & {
  loras?: unknown
  loraName?: string | null
  loraStrengthModel?: number
  loraStrengthClip?: number
}

// Lê a lista de LoRAs usados em uma geração, tolerando itens do histórico
// salvos no formato antigo (loraName + loraStrengthModel/loraStrengthClip).
export function getSelectedLoras(params: LegacyParams | undefined | null): LoraSelection[] {
  if (!params) return []
  const raw: unknown = params.loras
  if (Array.isArray(raw)) {
    return raw.filter(
      (l): l is LoraSelection =>
        !!l && typeof l === 'object' && typeof (l as LoraSelection).name === 'string'
    )
  }
  if (typeof params.loraName === 'string' && params.loraName) {
    return [{
      name: params.loraName,
      strengthModel: Number(params.loraStrengthModel ?? 1),
      strengthClip: Number(params.loraStrengthClip ?? 1)
    }]
  }
  return []
}

export function loraDisplayName(name: string): string {
  return name.replace(/\.(safetensors|ckpt|gguf)$/, '').split(/[/\\]/).pop() ?? name
}
