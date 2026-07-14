import { useState, useCallback, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useGenerator } from '../hooks/useGenerator'
import { Sparkles, Shuffle, RefreshCw, Check, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { SafeImage } from './SafeImage'
import { MODEL_PROFILES, MODEL_IDS } from '../../shared/modelProfiles'

const ASPECT_RATIOS = [
  { label: '1:1', width: 1152, height: 1152 },
  { label: '2:3', width: 768, height: 1152 },
  { label: '3:2', width: 1152, height: 768 },
  { label: '9:16', width: 648, height: 1152 },
  { label: '16:9', width: 1152, height: 648 },
] as const

export function PromptPanel() {
  const { params, generating, progress, status, loras, models, refreshLoras } = useSessionStore()
  const activePreset = ASPECT_RATIOS.find(
    (ar) => ar.width === params.width && ar.height === params.height
  )
  const { generate, error } = useGenerator()
  const [modelsOpen, setModelsOpen] = useState(false)
  const [lorasOpen, setLorasOpen] = useState(false)
  const [refreshingLoras, setRefreshingLoras] = useState(false)
  const [lorasRefreshed, setLorasRefreshed] = useState(false)
  const [loraSearch, setLoraSearch] = useState('')
  const loraRefreshTimer = useRef<ReturnType<typeof setTimeout>>()

  const profile = MODEL_PROFILES[params.diffusionModel]

  const filteredModels = models.filter((model) => {
    const name = model.name.toLowerCase()
    if (params.diffusionModel === 'anima') {
      return name.includes('anima')
    } else if (params.diffusionModel === 'krea2') {
      return name.includes('krea') || name.includes('krea2') || name === 'krea2_turbo_fp8_scaled.safetensors'
    } else if (params.diffusionModel === 'z-image') {
      return name.includes('z-image') || name.includes('z_image')
    }
    return true
  })

  const filteredLoras = loras.filter((lora) =>
    lora.name.toLowerCase().includes(loraSearch.toLowerCase())
  )

  const handleRefreshLoras = useCallback(async () => {
    if (refreshingLoras) return
    setRefreshingLoras(true)
    try {
      await refreshLoras()
      setLorasRefreshed(true)
      clearTimeout(loraRefreshTimer.current)
      loraRefreshTimer.current = setTimeout(() => setLorasRefreshed(false), 1500)
    } finally {
      setRefreshingLoras(false)
    }
  }, [refreshLoras, refreshingLoras])

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-4 overflow-y-auto">
        {/* Seletor de Modelo de Difusão */}
        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Modelo de Difusão
          </label>
          <div className="grid grid-cols-3 gap-2">
            {MODEL_IDS.map((id) => {
              const prof = MODEL_PROFILES[id]
              const isSelected = params.diffusionModel === id
              return (
                <button
                  key={id}
                  onClick={() => params.setDiffusionModel(id)}
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

        {profile.hasNegativePrompt && (
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
        )}

        <div>
          <button
            onClick={() => setModelsOpen(!modelsOpen)}
            className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 w-full text-left"
          >
            {modelsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Arquivo do Checkpoint (UNET)
          </button>

          {modelsOpen && (
            <div>
              {filteredModels.length === 0 ? (
                <p className="text-xs text-text-muted">Nenhum checkpoint correspondente encontrado</p>
              ) : (
                <div className="max-h-48 overflow-y-auto custom-scroll">
                  <div className="grid grid-cols-3 gap-2">
                    {filteredModels.map((model) => {
                      const displayName = model.name.replace(/\.(safetensors|ckpt)$/, '').split(/[/\\]/).pop() ?? model.name
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
              <div className="flex flex-wrap gap-1 mb-1.5">
                {ASPECT_RATIOS.map((ar) => {
                  const isActive = params.width === ar.width && params.height === ar.height
                  return (
                    <button
                      key={ar.label}
                      onClick={() => {
                        params.setWidth(ar.width)
                        params.setHeight(ar.height)
                      }}
                      className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                        isActive
                          ? 'bg-accent text-white'
                          : 'bg-surface-tertiary text-text-secondary hover:bg-border'
                      }`}
                    >
                      {ar.label}
                    </button>
                  )
                })}
                <span
                  className={`px-2 py-1 rounded-lg text-xs font-medium ${
                    !activePreset
                      ? 'bg-accent text-white'
                      : 'bg-surface-tertiary text-text-muted'
                  }`}
                >
                  Personalizado
                </span>
              </div>
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

            <div className="col-span-2">
              <ParamField label="Prefixo do Arquivo">
                <input
                  type="text"
                  value={params.filenamePrefix || ''}
                  onChange={(e) => params.setFilenamePrefix(e.target.value)}
                  placeholder="Ex: hinata"
                  className="w-full bg-surface rounded-lg border border-border px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
                />
              </ParamField>
            </div>
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
              onClick={handleRefreshLoras}
              disabled={refreshingLoras}
              className={`
                p-1 rounded-lg shrink-0 transition-all duration-300
                ${lorasRefreshed
                  ? 'bg-success/20 text-success'
                  : refreshingLoras
                    ? 'bg-accent/10 text-accent'
                    : 'hover:bg-surface-tertiary text-text-muted hover:text-text-primary'
                }
              `}
              title="Atualizar lista de LoRAs"
            >
              {lorasRefreshed ? (
                <Check size={12} className="animate-[ping_0.3s_ease-out]" />
              ) : (
                <RefreshCw size={12} className={refreshingLoras ? 'animate-spin' : ''} />
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
                    {filteredLoras.map((lora) => {
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
                  {profile.hasLoraClipStrength && (
                    <SliderField
                      label="CLIP Strength"
                      value={params.loraStrengthClip}
                      min={0}
                      max={2}
                      step={0.05}
                      onChange={(v) => params.setLora(params.loraName, undefined, v)}
                    />
                  )}
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
