import { useState } from 'react'
import { useFilterModels } from '../hooks/useFilterModels'
import { useRefreshLoras } from '../hooks/useRefreshLoras'
import { Search, RefreshCw, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { MODEL_PROFILES, MODEL_IDS } from '../../shared/modelProfiles'
import type { DiffusionModelId, ModelInfo, LoraInfo } from '@shared/types'
import { SafeImage } from './SafeImage'

interface ModelSidebarProps {
  diffusionModel: DiffusionModelId
  onDiffusionModelChange: (id: DiffusionModelId) => void
  modelName: string
  onModelChange: (name: string) => void
  models: ModelInfo[]
  loraName: string | null
  onLoraChange: (name: string | null) => void
  loras: LoraInfo[]
  loraStrengthModel: number
  loraStrengthClip: number
  onLoraStrengthModelChange: (v: number) => void
  onLoraStrengthClipChange: (v: number) => void
  refreshLorasFn: () => Promise<void>
}

export function ModelSidebar({
  diffusionModel,
  onDiffusionModelChange,
  modelName,
  onModelChange,
  models,
  loraName,
  onLoraChange,
  loras,
  loraStrengthModel,
  loraStrengthClip,
  onLoraStrengthModelChange,
  onLoraStrengthClipChange,
  refreshLorasFn
}: ModelSidebarProps) {
  const [modelsOpen, setModelsOpen] = useState(false)
  const [lorasOpen, setLorasOpen] = useState(false)
  const [loraSearch, setLoraSearch] = useState('')

  const filteredModels = useFilterModels(models, diffusionModel)
  const { refreshing, refreshed, handleRefresh } = useRefreshLoras({ refreshFn: refreshLorasFn })

  const filteredLoras = loras.filter((lora) =>
    lora.name.toLowerCase().includes(loraSearch.toLowerCase())
  )

  const profile = MODEL_PROFILES[diffusionModel]

  const displayModelName = (name: string): string =>
    name.replace(/\.(safetensors|ckpt|gguf)$/, '').split(/[/\\]/).pop() ?? name

  return (
    <>
      <div>
        <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
          Modelo de Difusão
        </label>
        <div className="grid grid-cols-3 gap-2">
          {MODEL_IDS.map((id) => {
            const prof = MODEL_PROFILES[id]
            const isSelected = diffusionModel === id
            return (
              <button
                key={id}
                onClick={() => onDiffusionModelChange(id)}
                className={`
                  flex flex-col items-center justify-center p-3 rounded-xl border-2 text-center transition-all duration-200 group
                  ${isSelected
                    ? 'border-accent bg-accent/5 text-text-primary shadow-lg shadow-accent/5'
                    : 'border-border bg-surface hover:border-text-muted text-text-secondary'
                  }
                `}
              >
                <span className={`text-xs font-bold transition-colors ${isSelected ? 'text-accent' : 'text-text-primary group-hover:text-text-primary'}`}>
                  {prof.label}
                </span>
                <span className="text-[9px] text-text-muted mt-1 leading-tight line-clamp-2">
                  {id === 'anima' ? 'Anime HD' : id === 'krea2' ? 'Turbo Rápido' : 'GGUF Flux'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <button
          onClick={() => setModelsOpen(!modelsOpen)}
          className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 w-full text-left"
        >
          {modelsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Checkpoint (UNET)
          {modelName && <span className="ml-1 text-accent font-normal normal-case">({displayModelName(modelName)})</span>}
        </button>

        {modelsOpen && (
          <div>
            {filteredModels.length === 0 ? (
              <p className="text-xs text-text-muted">Nenhum checkpoint encontrado</p>
            ) : (
              <div className="max-h-48 overflow-y-auto custom-scroll">
                <div className="grid grid-cols-3 gap-2">
                  {filteredModels.map((model) => {
                    const displayName = displayModelName(model.name)
                    const isSelected = modelName === model.name
                    return (
                      <button
                        key={model.name}
                        onClick={() => onModelChange(model.name)}
                        title={displayName}
                        className={`
                          relative aspect-square rounded-xl border-2 overflow-hidden
                          transition-all
                          ${isSelected
                            ? 'border-accent ring-1 ring-accent'
                            : 'border-border hover:border-text-muted'
                          }
                        `}
                      >
                        {model.previewUrl ? (
                          <SafeImage
                            path={model.previewUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-surface-tertiary flex items-center justify-center">
                            <span className="text-[10px] text-text-muted text-center px-1 leading-tight">
                              {displayName.slice(0, 18)}
                            </span>
                          </div>
                        )}
                        {isSelected && (
                          <div className="absolute inset-x-0 bottom-0 h-1 bg-accent" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <button
            onClick={() => setLorasOpen(!lorasOpen)}
            className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider text-left flex-1"
          >
            {lorasOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            LoRA
            {loraName && <span className="ml-1 text-accent font-normal normal-case">(ativo)</span>}
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`
              p-1 rounded-lg shrink-0 transition-all duration-300
              ${refreshed
                ? 'bg-success/20 text-success'
                : refreshing
                  ? 'bg-accent/10 text-accent'
                  : 'hover:bg-surface-tertiary text-text-muted hover:text-text-primary'
              }
            `}
            title="Atualizar lista de LoRAs"
          >
            {refreshed ? (
              <Check size={12} className="animate-[ping_0.3s_ease-out]" />
            ) : (
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            )}
          </button>
        </div>

        {lorasOpen && (
          <div>
            <div className="relative mb-2">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={loraSearch}
                onChange={(e) => setLoraSearch(e.target.value)}
                placeholder="Buscar LoRA..."
                className="w-full bg-surface rounded-lg border border-border pl-6 pr-7 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
              />
              {loraSearch && (
                <button
                  onClick={() => setLoraSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                >
                  ✕
                </button>
              )}
            </div>
            {filteredLoras.length === 0 ? (
              <p className="text-xs text-text-muted">Nenhum LoRA encontrado</p>
            ) : (
              <div className="max-h-60 overflow-y-auto custom-scroll">
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => onLoraChange(null)}
                    className={`
                      aspect-square rounded-xl border-2 flex items-center justify-center text-xs
                      transition-all
                      ${!loraName
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-surface-tertiary text-text-muted hover:border-text-muted'
                      }
                    `}
                  >
                    None
                  </button>
                  {filteredLoras.map((lora) => {
                    const displayName = lora.name.replace(/\.(safetensors|ckpt)$/, '').split('/').pop() ?? lora.name
                    return (
                      <button
                        key={lora.name}
                        onClick={() => onLoraChange(lora.name)}
                        title={displayName}
                        className={`
                          relative aspect-square rounded-xl border-2 overflow-hidden
                          transition-all group
                          ${loraName === lora.name
                            ? 'border-accent ring-1 ring-accent'
                            : 'border-border hover:border-text-muted'
                          }
                        `}
                      >
                        {lora.previewUrl ? (
                          <SafeImage
                            path={lora.previewUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-surface-tertiary flex items-center justify-center">
                            <span className="text-[8px] text-text-muted text-center px-1 leading-tight">
                              {displayName.slice(0, 15)}
                            </span>
                          </div>
                        )}
                        {loraName === lora.name && (
                          <div className="absolute inset-x-0 bottom-0 h-1 bg-accent" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {loraName && (
              <div className="mt-3 space-y-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-text-muted">Model Strength</label>
                    <span className="text-xs text-text-secondary font-mono">{loraStrengthModel.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    value={loraStrengthModel}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(e) => onLoraStrengthModelChange(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                {profile.hasLoraClipStrength && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-text-muted">CLIP Strength</label>
                      <span className="text-xs text-text-secondary font-mono">{loraStrengthClip.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      value={loraStrengthClip}
                      min={0}
                      max={2}
                      step={0.05}
                      onChange={(e) => onLoraStrengthClipChange(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
