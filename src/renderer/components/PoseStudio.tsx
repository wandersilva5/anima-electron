import { useState, useCallback, useRef, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Upload, Wand2, Trash2, Play, Clock } from 'lucide-react'
import type { GenerationResult } from '@shared/types'
import { ModelSidebar } from './ModelSidebar'
import { useGenerationProgress } from '../hooks/useGenerationProgress'

interface DropPanelProps {
  title: string
  hint: string
  src: string | null
  dragOver: boolean
  onDragOver: (v: boolean) => void
  onFile: (file: File) => void
  onClear: () => void
  inputRef: React.RefObject<HTMLInputElement>
  badge?: string
  badgeClass?: string
}

function DropPanel({ title, hint, src, dragOver, onDragOver, onFile, onClear, inputRef, badge, badgeClass }: DropPanelProps) {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    onDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onDragOver, onFile])

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{title}</span>
        {badge && (
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide ${badgeClass ?? 'bg-surface-tertiary text-text-muted'}`}>
            {badge}
          </span>
        )}
      </div>

      {!src ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); onDragOver(true) }}
          onDragLeave={() => onDragOver(false)}
          onClick={() => inputRef.current?.click()}
          className={`
            w-full aspect-[3/4] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2
            cursor-pointer transition-all duration-200
            ${dragOver
              ? 'border-accent bg-accent/5 scale-[1.02]'
              : 'border-border hover:border-text-muted hover:bg-surface-secondary'
            }
          `}
        >
          <Upload size={32} className="text-text-muted" />
          <span className="text-sm text-text-secondary font-medium px-4 text-center">
            {hint}
          </span>
          <span className="text-[10px] text-text-muted">Clique ou arraste · PNG, JPG, WebP</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onFile(file)
            }}
          />
        </div>
      ) : (
        <div className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden bg-surface-secondary border border-border">
          <img
            src={src}
            alt={title}
            className="w-full h-full object-contain"
            draggable={false}
          />
          <div className="absolute top-2 left-2 flex items-center gap-1.5">
            <button
              onClick={() => inputRef.current?.click()}
              className="p-1.5 rounded-lg bg-surface/80 backdrop-blur-sm text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
              title="Trocar imagem"
            >
              <Upload size={14} />
            </button>
            <button
              onClick={onClear}
              className="p-1.5 rounded-lg bg-surface/80 backdrop-blur-sm text-text-secondary hover:text-error hover:bg-surface transition-colors"
              title="Remover imagem"
            >
              <Trash2 size={14} />
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onFile(file)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function PoseStudio() {
  const { status, loras, models, refreshLoras, addToHistory } = useSessionStore()

  const [poseSrc, setPoseSrc] = useState<string | null>(null)
  const [charSrc, setCharSrc] = useState<string | null>(null)
  const [resultSrc, setResultSrc] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [dragOverPose, setDragOverPose] = useState(false)
  const [dragOverChar, setDragOverChar] = useState(false)
  const { progress, elapsed, eta, startProgress } = useGenerationProgress()

  // ModelSidebar state — não usado na geração de pose (Krea2-Pose tem modelo fixo no workflow)
  // mas mantemos para consistência visual
  const [selectedCheckpoint] = useState('')
  const selectedLoras: import('@shared/types').LoraSelection[] = []

  const poseInputRef = useRef<HTMLInputElement>(null)
  const charInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const folder = 'Krea2'
    window.electronAPI.loras.list(folder).then((newLoras) => {
      useSessionStore.getState().setLoras(newLoras)
    }).catch(() => {})
  }, [])

  // Imagem escolhida no histórico (sidebar) vira a referência de personagem
  const pendingPick = useSessionStore((s) => s.pendingHistoryPick)
  const requestHistoryPick = useSessionStore((s) => s.requestHistoryPick)
  useEffect(() => {
    if (!pendingPick) return
    const picked = pendingPick
    requestHistoryPick(null)
    const apply = (src: string) => {
      setCharSrc(src)
      setResultSrc(null)
      setError(null)
    }
    if (picked.imageBase64) {
      apply(picked.imageBase64)
    } else if (picked.filePath) {
      window.electronAPI.file.readImage(picked.filePath).then((data) => {
        if (data) apply(data)
      })
    }
  }, [pendingPick, requestHistoryPick])

  const handlePoseFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setPoseSrc(e.target?.result as string)
      setResultSrc(null)
      setError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleCharFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setCharSrc(e.target?.result as string)
      setResultSrc(null)
      setError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const clearPose = useCallback(() => {
    setPoseSrc(null)
    setResultSrc(null)
    if (poseInputRef.current) poseInputRef.current.value = ''
  }, [])

  const clearChar = useCallback(() => {
    setCharSrc(null)
    setResultSrc(null)
    if (charInputRef.current) charInputRef.current.value = ''
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!poseSrc || !charSrc) return

    setGenerating(true)
    setError(null)
    setWarning(null)
    setResultSrc(null)

    const stopProgress = startProgress()

    try {
      const seed = Math.floor(Math.random() * 2147483647)
      const result = await window.electronAPI.comfyui.generatePose({
        charImageBase64: charSrc,
        poseImageBase64: poseSrc,
        seed,
        filenamePrefix: 'anima-pose'
      })

      const image = result.images?.[0]
      if (image) {
        if (result.warning) setWarning(result.warning)
        const src = `data:image/png;base64,${image.data}`
        setResultSrc(src)
        const entry: GenerationResult = {
          id: result.promptId,
          imageBase64: src,
          filePath: image.filePath,
          filename: image.filename,
          params: {
            diffusionModel: 'krea2',
            prompt: '',
            negativePrompt: '',
            seed,
            steps: 8,
            cfg: 1,
            width: 1024,
            height: 1024,
            modelName: selectedCheckpoint,
            loras: selectedLoras,
          },
          timestamp: Date.now()
        }
        addToHistory(entry)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar com pose')
    } finally {
      stopProgress()
      setGenerating(false)
    }
  }, [poseSrc, charSrc, selectedCheckpoint, selectedLoras, startProgress, addToHistory])

  return (
    <div className="flex-1 flex gap-0 overflow-hidden">
      <main className="flex-1 flex flex-col items-center justify-center bg-surface overflow-hidden min-w-0 p-6">
        <div className="w-full max-w-5xl flex flex-col items-center gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
            <DropPanel
              title="1. Pose de Referência"
              hint="Arraste ou selecione a imagem com a pose desejada"
              src={poseSrc}
              dragOver={dragOverPose}
              onDragOver={setDragOverPose}
              onFile={handlePoseFile}
              onClear={clearPose}
              inputRef={poseInputRef}
            />

            <DropPanel
              title="2. Personagem (identidade)"
              hint="Arraste ou selecione a imagem da personagem"
              src={charSrc}
              dragOver={dragOverChar}
              onDragOver={setDragOverChar}
              onFile={handleCharFile}
              onClear={clearChar}
              inputRef={charInputRef}
            />

            <div className="flex flex-col gap-2 min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                3. Resultado
              </span>
              <div className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden bg-surface-secondary border border-border flex items-center justify-center">
                {resultSrc ? (
                  <img
                    src={resultSrc}
                    alt="Resultado"
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 px-4 text-center">
                    <Wand2 size={28} className="text-text-muted" />
                    <span className="text-sm text-text-muted">
                      {generating ? 'Gerando...' : 'A personagem recriada com a pose aparecerá aqui'}
                    </span>
                  </div>
                )}
                {resultSrc && (
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-success/90 text-white text-[9px] font-semibold uppercase tracking-wider">
                    Gerado
                  </div>
                )}
                {generating && (
                  <div className="absolute inset-0 bg-surface/60 backdrop-blur-sm flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      <span className="text-xs text-text-secondary">Gerando...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className="w-full p-3 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
              {error}
            </div>
          )}
          {warning && (
            <div className="w-full p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs">
              {warning}
            </div>
          )}

          <div className="w-full p-3 rounded-lg bg-accent/5 border border-accent/20 text-xs text-text-secondary flex items-start gap-2">
            <span className="text-accent shrink-0 mt-0.5">ℹ</span>
            <span>
              O modelo <strong className="text-text-primary">Krea2</strong> transfere a pose diretamente por referência visual — sem necessidade de extração de esqueleto. Basta fornecer as duas imagens.
            </span>
          </div>
        </div>
      </main>

      <aside className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-border bg-surface-secondary overflow-y-auto shrink-0 max-h-[40vh] lg:max-h-none">
        <div className="flex flex-col h-full">
          <div className="p-4 space-y-4 overflow-y-auto">
            <ModelSidebar
              diffusionModel="krea2"
              onDiffusionModelChange={() => {}}
              hideDiffusionSelector
              modelName={selectedCheckpoint}
              onModelChange={() => {}}
              models={models}
              loras={loras}
              selectedLoras={selectedLoras}
              onToggleLora={() => {}}
              onClearLoras={() => {}}
              onLoraStrengthChange={() => {}}
              refreshLorasFn={refreshLoras}
            />

            <div className="p-3 rounded-lg bg-surface border border-border text-xs text-text-muted space-y-1">
              <p className="font-medium text-text-secondary">Como funciona:</p>
              <p>1. A <strong className="text-text-primary">Pose de Referência</strong> define a postura e ângulo do corpo.</p>
              <p>2. O <strong className="text-text-primary">Personagem</strong> define a identidade, rosto e roupa a preservar.</p>
              <p>3. O Krea2 combina os dois para gerar o resultado final.</p>
            </div>
          </div>

          <div className="mt-auto p-4 border-t border-border space-y-3">
            {generating && (
              <div className="space-y-2">
                {progress ? (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-secondary flex items-center gap-1">
                        <Clock size={12} />
                        {elapsed < 60
                          ? `${elapsed.toFixed(0)}s`
                          : `${Math.floor(elapsed / 60)}m ${(elapsed % 60).toFixed(0)}s`}
                      </span>
                      <span className="text-text-muted font-mono">{progress.current}/{progress.max}</span>
                      {eta !== null && eta > 0 && (
                        <span className="text-text-muted">
                          ~{eta < 60
                            ? `${eta.toFixed(0)}s`
                            : `${Math.floor(eta / 60)}m ${(eta % 60).toFixed(0)}s`}
                        </span>
                      )}
                    </div>
                    <div className="w-full h-1.5 bg-surface-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progress.max > 0 ? (progress.current / progress.max) * 100 : 0}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-xs text-text-secondary">
                    <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                    Aguardando ComfyUI...
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={!poseSrc || !charSrc || generating || !status.online}
              className={`
                w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm
                transition-all duration-200
                ${(!poseSrc || !charSrc || generating || !status.online)
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
                  <Play size={16} />
                  Gerar com Pose
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
