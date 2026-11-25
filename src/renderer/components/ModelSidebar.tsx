import { useState, memo } from 'react'
import { useFilterModels } from '../hooks/useFilterModels'
import { useRefreshLoras } from '../hooks/useRefreshLoras'
import { X, ChevronUp, ChevronDown, Check, RefreshCw } from 'lucide-react'
import { MODEL_PROFILES, MODEL_IDS } from '@shared/modelProfiles'
import type { DiffusionModelId, ModelInfo, LoraInfo, LoraSelection } from '@shared/types'
import { SafeImage } from './SafeImage'

interface ModelSidebarProps {
  diffusionModel: DiffusionModelId
  onDiffusionModelChange: (id: DiffusionModelId) => void
  modelName: string
  onModelChange: (name: string) => void
  models: ModelInfo[]
  selectedLoras: LoraSelection[]
  onToggleLora: (name: string) => void
  onClearLoras: () => void
  onLoraStrengthChange: (name: string, kind: 'model' | 'clip', v: number) => void
  onReorderLoras?: (from: number, to: number) => void
  loras: LoraInfo[]
  refreshLorasFn: () => Promise<void>
  hideDiffusionSelector?: boolean
  compactLoraArea?: boolean
}

const displayModelName = (name: string): string =>
  name.replace(/\.(safetensors|ckpt|gguf)$/, '').split(/[/\\]/).pop() ?? name

const displayLoraName = (name: string): string =>
  name.replace(/\.(safetensors|ckpt|gguf)$/, '').split(/[/\\]/).pop() ?? name

interface LoraRowProps {
  sel: LoraSelection
  idx: number
  total: number
  isFirst: boolean
  isLast: boolean
  canReorder: boolean
  loras: LoraInfo[]
  profile: typeof MODEL_PROFILES[DiffusionModelId]
  onToggleLora: (name: string) => void
  onLoraStrengthChange: (name: string, kind: 'model' | 'clip', v: number) => void
  onReorderLoras?: (from: number, to: number) => void
}

const LoraRow = memo(function LoraRow({
  sel,
  idx,
  total,
  isFirst,
  isLast,
  canReorder,
  loras,
  profile,
  onToggleLora,
  onLoraStrengthChange,
  onReorderLoras
}: LoraRowProps) {
  const selLora = loras.find((l) => l.name === sel.name)

  return (
    <div className="p-2 rounded-xl border bg-surface transition-all">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-bold font-mono">
            {idx + 1}º
          </span>
          {total === 1 ? (
            <span className="px-1.5 py-0.5 rounded bg-surface-tertiary text-text-muted text-[9px] font-medium uppercase tracking-wide">
              único
            </span>
          ) : isFirst ? (
            <span className="px-1.5 py-0.5 rounded bg-success/15 text-success text-[9px] font-medium uppercase tracking-wide">
              primeiro
            </span>
          ) : isLast ? (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 text-[9px] font-medium uppercase tracking-wide">
              último
            </span>
          ) : null}
        </div>
        {canReorder && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => onReorderLoras?.(idx, idx - 1)}
              disabled={idx === 0}
              className="p-0.5 rounded hover:bg-surface-tertiary text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Mover para cima"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => onReorderLoras?.(idx, idx + 1)}
              disabled={idx === total - 1}
              className="p-0.5 rounded hover:bg-surface-tertiary text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Mover para baixo"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-2.5">
        <div className="flex flex-col items-center gap-1 shrink-0 w-20">
          <div className="w-20 h-20 rounded-lg border border-border overflow-hidden bg-surface-tertiary flex items-center justify-center">
            {selLora?.previewUrl ? (
              <SafeImage path={selLora.previewUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-lg text-text-muted font-bold">{idx + 1}</span>
            )}
          </div>
          <span className="text-[10px] text-text-secondary font-medium truncate w-full text-center" title={displayLoraName(sel.name)}>{displayLoraName(sel.name)}</span>
          <button
            onClick={() => onToggleLora(sel.name)}
            className="text-[10px] text-text-muted hover:text-error transition-colors"
            title="Remover LoRA"
          >
            <X size={12} />
          </button>
        </div>
        <div className="flex-1 min-w-0 space-y-1.5 py-0.5">
          <div className="space-y-0.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-text-muted">Model Strength</label>
              <span className="text-[10px] text-text-secondary font-mono">{sel.strengthModel.toFixed(2)}</span>
            </div>
            <input
              type="range"
              value={sel.strengthModel}
              min={0}
              max={2}
              step={0.05}
              onChange={(e) => onLoraStrengthChange(sel.name, 'model', Number(e.target.value))}
              className="w-full"
            />
          </div>
          {profile.hasLoraClipStrength && (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-text-muted">CLIP Strength</label>
                <span className="text-[10px] text-text-secondary font-mono">{sel.strengthClip.toFixed(2)}</span>
              </div>
              <input
                type="range"
                value={sel.strengthClip}
                min={0}
                max={2}
                step={0.05}
                onChange={(e) => onLoraStrengthChange(sel.name, 'clip', Number(e.target.value))}
                className="w-full"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

export function ModelSidebar({
  diffusionModel,
  onDiffusionModelChange,
  modelName,
  onModelChange,
  models,
  selectedLoras,
  onToggleLora,
  onClearLoras,
  onLoraStrengthChange,
  onReorderLoras,
  loras,
  refreshLorasFn,
  hideDiffusionSelector,
  compactLoraArea
}: ModelSidebarProps) {
  const [modelsOpen, setModelsOpen] = useState(false)
  const [lorasOpen, setLorasOpen] = useState(false)
  const [loraSearch, setLoraSearch] = useState('')

  const filteredModels = useFilterModels(models, diffusionModel)
  const { refreshing } = useRefreshLoras({ refreshFn: refreshLorasFn })

  const filteredLoras = loras.filter((lora) => lora.name.toLowerCase().includes(loraSearch.toLowerCase()))

  const profile = MODEL_PROFILES[diffusionModel]
  const hasSelection = selectedLoras.length > 0

  return (
    <>
      {/* Filtros de família de modelo */}
      {!hideDiffusionSelector && (
        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Modelo de Difusão
          </label>
          <div className="grid grid-cols-2 gap-2">
            {MODEL_IDS.map((id) => {
              const prof = MODEL_PROFILES[id]
              const isSelected = diffusionModel === id
              return (
                <button
                  key={id}
                  type="button"
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
                    {id === 'anima' ? 'Anime HD' : id === 'krea2' ? 'Turbo Rápido' : id === 'qwen-image' ? 'Edição 2.1' : 'GGUF Flux'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Checkpoint (UNET) */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Checkpoint (UNET)</h3>
          <button
            type="button"
            onClick={() => setModelsOpen((o) => !o)}
            className="p-1 rounded hover:bg-surface-tertiary transition-colors"
            aria-label={modelsOpen ? 'Fechar modelos' : 'Abrir modelos'}
          >
            {modelsOpen ? <ChevronUp size={14} className="text-text-secondary" /> : <ChevronDown size={14} className="text-text-secondary" />}
          </button>
        </div>
          <button
            type="button"
            onClick={() => setModelsOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-surface text-left transition-colors hover:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <span className="text-sm font-medium text-text-primary truncate">{displayModelName(modelName)}</span>
            {modelsOpen ? <ChevronUp size={16} className="text-text-secondary shrink-0" /> : <ChevronDown size={16} className="text-text-secondary shrink-0" />}
          </button>
          {modelsOpen && (
            <div className="mt-1 max-h-48 overflow-y-auto custom-scroll border border-border rounded-lg bg-surface p-1">
              {filteredModels.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-3">Nenhum modelo encontrado</p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 p-0.5">
                  {filteredModels.map((model) => {
                    const displayName = displayModelName(model.name)
                    const isSelected = model.name === modelName
                    return (
                      <button
                        key={model.name}
                        type="button"
                        onClick={() => {
                          onModelChange(model.name)
                          setModelsOpen(false)
                        }}
                        title={displayName}
                        className={`relative aspect-square rounded-xl border-2 overflow-hidden transition-all ${
                          isSelected
                            ? 'border-accent ring-1 ring-accent'
                            : 'border-border hover:border-text-muted'
                        }`}
                      >
                        {model.previewUrl ? (
                          <SafeImage path={model.previewUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-surface-tertiary flex items-center justify-center">
                            <span className="text-[10px] text-text-muted text-center px-1 leading-tight break-all">
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
              )}
            </div>
          )}
      </div>

      {/* LoRAs */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            LoRAs
            {compactLoraArea && hasSelection && (
              <span className="ml-1.5 text-[11px] font-semibold text-accent">{selectedLoras.length}</span>
            )}
          </h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLorasOpen((o) => !o)}
              className="p-1 rounded hover:bg-surface-tertiary transition-colors"
              aria-label={lorasOpen ? 'Fechar LoRAs' : 'Abrir LoRAs'}
              title={lorasOpen ? 'Ocultar LoRAs' : 'Mostrar LoRAs'}
            >
              {lorasOpen ? <ChevronUp size={14} className="text-text-secondary" /> : <ChevronDown size={14} className="text-text-secondary" />}
            </button>
            <button
              type="button"
              onClick={refreshLorasFn}
              disabled={refreshing}
              className="p-1 rounded hover:bg-surface-tertiary transition-colors disabled:opacity-40"
              title="Atualizar lista de LoRAs"
            >
              <RefreshCw size={14} className={`text-text-secondary ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {lorasOpen && (
          <div className="space-y-2">
            <input
              type="text"
              value={loraSearch}
              onChange={(e) => setLoraSearch(e.target.value)}
              placeholder="Buscar LoRA..."
              className="w-full px-2.5 py-1.5 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="max-h-60 overflow-y-auto custom-scroll">
              {filteredLoras.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-4">Nenhum LoRA encontrado</p>
              ) : compactLoraArea ? (
                <div className="grid grid-cols-4 gap-1.5 p-0.5">
                  {filteredLoras.map((lora) => {
                    const selection = selectedLoras.find((sel) => sel.name === lora.name)
                    return (
                      <button
                        key={lora.name}
                        type="button"
                        onClick={() => onToggleLora(lora.name)}
                        title={lora.name}
                        className={`relative w-full aspect-square rounded-lg overflow-hidden border transition-colors ${selection
                          ? 'border-accent ring-1 ring-accent/50'
                          : 'border-border hover:border-accent/50'
                          }`}
                      >
                        {lora.previewUrl ? (
                          <SafeImage path={lora.previewUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="w-full h-full flex items-center justify-center text-[9px] text-text-muted text-center px-1 leading-tight break-all bg-surface-tertiary">
                            {displayLoraName(lora.name).slice(0, 18)}
                          </span>
                        )}
                        {selection && (
                          <span className="absolute top-0 right-0 w-4 h-4 bg-accent flex items-center justify-center rounded-bl-md">
                            <Check size={11} className="text-white" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredLoras.map((lora) => {
                    const selection = selectedLoras.find((sel) => sel.name === lora.name)
                    return (
                      <button
                        key={lora.name}
                        type="button"
                        onClick={() => onToggleLora(lora.name)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-colors text-left ${selection
                          ? 'bg-accent/10 border-accent/30 text-text-primary'
                          : 'border-border hover:bg-surface-tertiary hover:border-accent/20 text-text-secondary'
                          }`}
                      >
                        <div className="w-8 h-8 shrink-0 rounded overflow-hidden bg-surface-tertiary border border-border flex items-center justify-center">
                          {lora.previewUrl ? (
                            <SafeImage path={lora.previewUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[7px] text-text-muted text-center px-0.5 leading-tight break-all">
                              {displayLoraName(lora.name).slice(0, 10)}
                            </span>
                          )}
                        </div>
                        <span className="flex-1 min-w-0 truncate text-sm">{displayLoraName(lora.name)}</span>
                        {selection && <Check size={14} className="text-accent shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* LoRAs selecionadas com drag-and-drop */}
        {hasSelection && (!compactLoraArea || lorasOpen) && (
          <div className="mt-3 space-y-3">
            {onReorderLoras && (
              <p className="text-[10px] text-text-muted leading-tight">
                Ordem no workflow: <span className="text-accent font-semibold">1º → {selectedLoras.length}º</span>
                {' — '}use as setas para reordenar (o último aplicado tem prioridade nos traços em conflito).
              </p>
            )}
            {selectedLoras.map((sel, idx) => {
              const total = selectedLoras.length
              const isFirst = idx === 0
              const isLast = idx === total - 1
              return (
                <LoraRow
                  key={sel.name}
                  sel={sel}
                  idx={idx}
                  total={total}
                  isFirst={isFirst}
                  isLast={isLast}
                  canReorder={!!onReorderLoras}
                  loras={loras}
                  profile={profile}
                  onToggleLora={onToggleLora}
                  onLoraStrengthChange={onLoraStrengthChange}
                  onReorderLoras={onReorderLoras}
                />
              )
            })}
          </div>
        )}

        {hasSelection && (!compactLoraArea || lorasOpen) && (
          <button
            type="button"
            onClick={onClearLoras}
            className="w-full mt-2 px-3 py-1.5 rounded-lg border border-error/30 bg-error/10 text-error text-sm font-medium hover:bg-error/20 transition-colors"
          >
            Limpar todas as LoRAs
          </button>
        )}
      </div>
    </>
  )
}
