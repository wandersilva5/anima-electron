import { useState } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useGenerator } from '../hooks/useGenerator'
import { Sparkles, Shuffle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { SafeImage } from './SafeImage'

export function PromptPanel() {
  const { params, generating, progress, status, loras, models, refreshLoras } = useSessionStore()
  const { generate, error } = useGenerator()
  const [modelsOpen, setModelsOpen] = useState(false)
  const [lorasOpen, setLorasOpen] = useState(true)

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-4 overflow-y-auto">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Prompt Positivo
          </label>
          <textarea
            value={params.prompt}
            onChange={(e) => params.setPrompt(e.target.value)}
            placeholder="Descreva a imagem que deseja gerar..."
            rows={4}
            className="w-full bg-surface rounded-lg border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Prompt Negativo
          </label>
          <textarea
            value={params.negativePrompt}
            onChange={(e) => params.setNegativePrompt(e.target.value)}
            placeholder="O que evitar na imagem..."
            rows={3}
            className="w-full bg-surface rounded-lg border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
          />
        </div>

        <div>
          <button
            onClick={() => setModelsOpen(!modelsOpen)}
            className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 w-full text-left"
          >
            {modelsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Modelo de Difusão
          </button>

          {modelsOpen && (
            <div>
              {models.length === 0 ? (
                <p className="text-xs text-text-muted">Nenhum modelo encontrado</p>
              ) : (
                <div className="max-h-48 overflow-y-auto custom-scroll">
                  <div className="grid grid-cols-3 gap-2">
                    {models.map((model) => {
                      const displayName = model.name.replace(/\.(safetensors|ckpt)$/, '').split('/').pop() ?? model.name
                      const isSelected = params.modelName === model.name
                      return (
                        <button
                          key={model.name}
                          onClick={() => params.setModel(model.name)}
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
                              <span className="text-[7px] text-text-muted text-center px-1 leading-tight">
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

        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Parâmetros
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <ParamField label="Seed">
              <div className="flex gap-1">
                <input
                  type="number"
                  value={params.seed}
                  onChange={(e) => params.setSeed(Number(e.target.value))}
                  className="w-full bg-surface rounded-lg border border-border px-2 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  onClick={params.randomizeSeed}
                  className="p-1.5 rounded-lg bg-surface-tertiary hover:bg-border text-text-secondary hover:text-text-primary transition-colors shrink-0"
                  title="Randomizar seed"
                >
                  <Shuffle size={14} />
                </button>
              </div>
            </ParamField>

            <SliderField
              label="Steps"
              value={params.steps}
              min={1}
              max={50}
              onChange={params.setSteps}
            />

            <SliderField
              label="CFG Scale"
              value={params.cfg}
              min={1}
              max={20}
              step={0.5}
              onChange={params.setCfg}
            />

            <ParamField label="Resolução">
              <div className="flex gap-1">
                <input
                  type="number"
                  value={params.width}
                  onChange={(e) => params.setWidth(Number(e.target.value))}
                  className="w-full bg-surface rounded-lg border border-border px-2 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="text-text-muted self-center text-xs">×</span>
                <input
                  type="number"
                  value={params.height}
                  onChange={(e) => params.setHeight(Number(e.target.value))}
                  className="w-full bg-surface rounded-lg border border-border px-2 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </ParamField>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <button
              onClick={() => setLorasOpen(!lorasOpen)}
              className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider text-left flex-1"
            >
              {lorasOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              LoRA
              {params.loraName && <span className="ml-1 text-accent font-normal normal-case">(ativo)</span>}
            </button>
            <button
              onClick={refreshLoras}
              className="p-1 rounded-lg hover:bg-surface-tertiary text-text-muted hover:text-text-primary transition-colors shrink-0"
              title="Atualizar lista de LoRAs"
            >
              <RefreshCw size={12} />
            </button>
          </div>

          {lorasOpen && (
            <div>
              {loras.length === 0 ? (
                <p className="text-xs text-text-muted">Nenhum LoRA encontrado em D:\ComfyUI_windows_portable\ComfyUI\models\loras</p>
              ) : (
                <div className="max-h-60 overflow-y-auto custom-scroll">
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => params.setLora(null)}
                      className={`
                        aspect-square rounded-xl border-2 flex items-center justify-center text-xs
                        transition-all
                        ${!params.loraName
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-surface-tertiary text-text-muted hover:border-text-muted'
                        }
                      `}
                    >
                      None
                    </button>
                    {loras.map((lora) => {
                      const displayName = lora.name.replace(/\.(safetensors|ckpt)$/, '').split('/').pop() ?? lora.name
                      return (
                        <button
                          key={lora.name}
                          onClick={() => params.setLora(lora.name)}
                          className={`
                            relative aspect-square rounded-xl border-2 overflow-hidden
                            transition-all group
                            ${params.loraName === lora.name
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
                          {params.loraName === lora.name && (
                            <div className="absolute inset-x-0 bottom-0 h-1 bg-accent" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {params.loraName && (
                <div className="mt-3 space-y-2">
                  <SliderField
                    label="Model Strength"
                    value={params.loraStrengthModel}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(v) => params.setLora(params.loraName, v, undefined)}
                  />
                  <SliderField
                    label="CLIP Strength"
                    value={params.loraStrengthClip}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(v) => params.setLora(params.loraName, undefined, v)}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
            {error}
          </div>
        )}
      </div>

      <div className="mt-auto p-4 border-t border-border">
        <div className="mb-2 text-xs text-text-muted text-center">
          Ctrl+Enter para gerar
        </div>

        {generating && progress && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-text-secondary">Gerando...</span>
              <span className="text-text-muted font-mono">{progress.current}/{progress.max}</span>
            </div>
            <div className="w-full h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
                style={{ width: `${(progress.current / progress.max) * 100}%` }}
              />
            </div>
          </div>
        )}

        {generating && !progress && (
          <div className="flex items-center gap-2 text-xs text-text-secondary mb-3 justify-center">
            <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Aguardando ComfyUI...
          </div>
        )}

        <button
          onClick={generate}
          disabled={generating || !status.online || !params.prompt.trim()}
          className={`
            w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm
            transition-all duration-200
            ${generating || !status.online || !params.prompt.trim()
              ? 'bg-accent-muted text-text-muted cursor-not-allowed'
              : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98] shadow-lg shadow-accent/20'
            }
          `}
        >
          {generating ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Gerando...
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Gerar
            </>
          )}
        </button>
      </div>
    </div>
  )
}

function ParamField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-muted">{label}</label>
      </div>
      {children}
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-muted">{label}</label>
        <span className="text-xs text-text-secondary font-mono">{value}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}
