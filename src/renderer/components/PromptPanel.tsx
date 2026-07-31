import { useSessionStore } from '../stores/sessionStore'
import { useGenerator } from '../hooks/useGenerator'
import { Sparkles, Shuffle } from 'lucide-react'
import { MODEL_PROFILES } from '../../shared/modelProfiles'
import { ModelSidebar } from './ModelSidebar'

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

  const profile = MODEL_PROFILES[params.diffusionModel]

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-4 overflow-y-auto">
        <ModelSidebar
          diffusionModel={params.diffusionModel}
          onDiffusionModelChange={params.setDiffusionModel}
          modelName={params.modelName}
          onModelChange={params.setModel}
          models={models}
          loraName={params.loraName}
          onLoraChange={(name) => params.setLora(name)}
          loras={loras}
          loraStrengthModel={params.loraStrengthModel}
          loraStrengthClip={params.loraStrengthClip}
          onLoraStrengthModelChange={(v) => params.setLora(params.loraName, v, undefined)}
          onLoraStrengthClipChange={(v) => params.setLora(params.loraName, undefined, v)}
          refreshLorasFn={refreshLoras}
        />

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
                style={{ width: `${progress.max > 0 ? (progress.current / progress.max) * 100 : 0}%` }}
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
