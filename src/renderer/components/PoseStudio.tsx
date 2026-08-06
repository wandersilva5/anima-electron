import { useState, useCallback, useRef, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Upload, Wand2, Trash2, Play, Sparkles, Clock } from 'lucide-react'
import { MODEL_PROFILES } from '@shared/modelProfiles'
import type { DiffusionModelId, GenerationResult } from '@shared/types'
import { ModelSidebar } from './ModelSidebar'

const DEFAULT_POSE_PROMPT = 'masterpiece, best quality, amazing quality, very aesthetic, same character, same outfit, highly detailed'

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
  footer?: React.ReactNode
}

function DropPanel({ title, hint, src, dragOver, onDragOver, onFile, onClear, inputRef, badge, badgeClass, footer }: DropPanelProps) {
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

      {footer}
    </div>
  )
}

export function PoseStudio() {
  const { status, loras, models, refreshLoras, addToHistory } = useSessionStore()

  const selectedModel: DiffusionModelId = 'z-image'
  const [selectedCheckpoint, setSelectedCheckpoint] = useState('')
  const [selectedLora, setSelectedLora] = useState<string | null>(null)
  const [loraStrengthModel, setLoraStrengthModel] = useState(0.5)
  const [loraStrengthClip, setLoraStrengthClip] = useState(0.5)
  const [denoise, setDenoise] = useState(0.7)
  const [captioning, setCaptioning] = useState(false)
  const [charPrompt, setCharPrompt] = useState('')

  const [poseSrc, setPoseSrc] = useState<string | null>(null)
  const [poseJoints, setPoseJoints] = useState<Record<string, [number, number]> | null>(null)
  const [detectingPose, setDetectingPose] = useState(false)
  const [charSrc, setCharSrc] = useState<string | null>(null)
  const [resultSrc, setResultSrc] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOverPose, setDragOverPose] = useState(false)
  const [dragOverChar, setDragOverChar] = useState(false)
  const [progress, setProgress] = useState<{ current: number; max: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [eta, setEta] = useState<number | null>(null)

  const poseInputRef = useRef<HTMLInputElement>(null)
  const charInputRef = useRef<HTMLInputElement>(null)
  const startTimeRef = useRef(0)
  const progressTimerRef = useRef<ReturnType<typeof setInterval>>()

  const profile = MODEL_PROFILES[selectedModel]

  useEffect(() => {
    const compatible = models.filter((model) => {
      const name = model.name.toLowerCase()
      return name.includes('z-image') || name.includes('z_image')
    })
    if (compatible.length > 0 && !compatible.some(m => m.name === selectedCheckpoint)) {
      setSelectedCheckpoint(compatible[0].name)
    }
  }, [models, selectedCheckpoint])

  useEffect(() => {
    setSelectedLora(null)
    const folder = MODEL_PROFILES['z-image'].loraFolder
    window.electronAPI.loras.list(folder).then((newLoras) => {
      useSessionStore.getState().setLoras(newLoras)
    }).catch(() => {})
  }, [])

  const detectPose = useCallback(async (src: string): Promise<Record<string, [number, number]> | null> => {
    setDetectingPose(true)
    setError(null)
    try {
      const joints = await window.electronAPI.pose.extractFromBase64(src)
      if (!joints) {
        setError('Não foi possível detectar uma pose na imagem. Verifique se o modelo DWPose está baixado e tente outra imagem.')
        return null
      }
      setPoseJoints(joints)
      return joints
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao detectar pose da imagem')
      return null
    } finally {
      setDetectingPose(false)
    }
  }, [])

  const handlePoseFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = async (e) => {
      const src = e.target?.result as string
      setPoseSrc(src)
      setPoseJoints(null)
      setResultSrc(null)
      await detectPose(src)
    }
    reader.readAsDataURL(file)
  }, [detectPose])

  const handleCharFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setCharSrc(e.target?.result as string)
      setResultSrc(null)
      setCharPrompt('')
      setError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const clearPose = useCallback(() => {
    setPoseSrc(null)
    setPoseJoints(null)
    setResultSrc(null)
    if (poseInputRef.current) poseInputRef.current.value = ''
  }, [])

  const clearChar = useCallback(() => {
    setCharSrc(null)
    setResultSrc(null)
    setCharPrompt('')
    if (charInputRef.current) charInputRef.current.value = ''
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!poseSrc || !charSrc) return

    let effectivePrompt = charPrompt.trim()
    if (!effectivePrompt) {
      setCaptioning(true)
      setError(null)
      try {
        const cap = await window.electronAPI.comfyui.captionImage({ imageBase64: charSrc })
        effectivePrompt = (cap.text || '').trim() || DEFAULT_POSE_PROMPT
        setCharPrompt(effectivePrompt)
      } catch {
        effectivePrompt = DEFAULT_POSE_PROMPT
      } finally {
        setCaptioning(false)
      }
    }

    setGenerating(true)
    setError(null)
    setResultSrc(null)
    setProgress(null)
    setElapsed(0)
    setEta(null)
    startTimeRef.current = Date.now()

    const unsubProgress = window.electronAPI.comfyui.onProgress((data) => {
      setProgress(data)
      const now = Date.now()
      const elapsedSec = (now - startTimeRef.current) / 1000
      setElapsed(elapsedSec)
      if (data.current > 0) {
        const estimated = (elapsedSec / data.current) * data.max
        setEta(estimated - elapsedSec)
      }
    })

    progressTimerRef.current = setInterval(() => {
      if (startTimeRef.current > 0) {
        setElapsed((Date.now() - startTimeRef.current) / 1000)
      }
    }, 1000)

    try {
      const extracted = poseJoints ?? await detectPose(poseSrc)
      if (!extracted) {
        setError('Detecte a pose da imagem antes de gerar.')
        return
      }

      const result = await window.electronAPI.comfyui.generateImprove({
        diffusionModel: selectedModel,
        prompt: effectivePrompt,
        negativePrompt: '',
        seed: Math.floor(Math.random() * 2147483647),
        steps: profile.defaults.steps,
        cfg: profile.defaults.cfg,
        width: profile.defaults.width,
        height: profile.defaults.height,
        modelName: selectedCheckpoint,
        loraName: selectedLora,
        loraStrengthModel,
        loraStrengthClip,
        imageBase64: charSrc,
        denoise,
        filenamePrefix: 'anima-pose',
      } as any)

      const image = result.images?.[0]
      if (image) {
        const src = `data:image/png;base64,${image.data}`
        setResultSrc(src)
        const entry: GenerationResult = {
          id: result.promptId,
          imageBase64: src,
          filePath: image.filePath,
          filename: image.filename,
          params: {
            diffusionModel: selectedModel,
            prompt: effectivePrompt,
            negativePrompt: '',
            seed: Math.floor(Math.random() * 2147483647),
            steps: profile.defaults.steps,
            cfg: profile.defaults.cfg,
            width: profile.defaults.width,
            height: profile.defaults.height,
            modelName: selectedCheckpoint,
            loraName: selectedLora,
            loraStrengthModel,
            loraStrengthClip,
          },
          timestamp: Date.now()
        }
        addToHistory(entry)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar com pose')
    } finally {
      unsubProgress()
      clearInterval(progressTimerRef.current)
      setGenerating(false)
      setProgress(null)
    }
  }, [poseSrc, poseJoints, charSrc, charPrompt, selectedCheckpoint, selectedLora, loraStrengthModel, loraStrengthClip, denoise, profile, detectPose, addToHistory])

  return (
    <div className="flex-1 flex gap-0 overflow-hidden">
      <main className="flex-1 flex flex-col items-center justify-center bg-surface overflow-hidden min-w-0 p-6">
        <div className="w-full max-w-5xl flex flex-col items-center gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
            <DropPanel
              title="1. Pose"
              hint="Arraste ou selecione a pose desejada"
              src={poseSrc}
              dragOver={dragOverPose}
              onDragOver={setDragOverPose}
              onFile={handlePoseFile}
              onClear={clearPose}
              inputRef={poseInputRef}
              badge={poseJoints ? 'Pose detectada' : detectingPose ? 'Detectando...' : undefined}
              badgeClass={poseJoints ? 'bg-success/20 text-success' : 'bg-accent/20 text-accent'}
              footer={detectingPose && (
                <div className="flex items-center justify-center gap-1.5 text-[10px] text-text-muted">
                  <div className="w-2.5 h-2.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  Extraindo pose via DWPose...
                </div>
              )}
            />

            <DropPanel
              title="2. Personagem"
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
        </div>
      </main>

      <aside className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-border bg-surface-secondary overflow-y-auto shrink-0 max-h-[40vh] lg:max-h-none">
        <div className="flex flex-col h-full">
          <div className="p-4 space-y-4 overflow-y-auto">
            <ModelSidebar
              diffusionModel={selectedModel}
              onDiffusionModelChange={() => {}}
              hideDiffusionSelector
              modelName={selectedCheckpoint}
              onModelChange={setSelectedCheckpoint}
              models={models}
              loraName={selectedLora}
              onLoraChange={setSelectedLora}
              loras={loras}
              loraStrengthModel={loraStrengthModel}
              loraStrengthClip={loraStrengthClip}
              onLoraStrengthModelChange={setLoraStrengthModel}
              onLoraStrengthClipChange={setLoraStrengthClip}
              refreshLorasFn={refreshLoras}
            />

            {/* Descrição automática da personagem */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-text-secondary">
                  Descrição da Personagem
                </label>
                {captioning && (
                  <span className="flex items-center gap-1 text-[10px] text-accent">
                    <div className="w-2.5 h-2.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                    Extraindo...
                  </span>
                )}
              </div>
              <textarea
                value={charPrompt}
                readOnly
                rows={3}
                placeholder={charSrc ? 'Será extraída automaticamente ao gerar.' : 'Faça upload da personagem primeiro.'}
                className="w-full bg-surface rounded-lg border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none"
              />
              <div className="flex items-center gap-1.5 mt-1.5">
                <Sparkles size={10} className="text-accent shrink-0" />
                <span className="text-[10px] text-text-muted">
                  Descrição extraída automaticamente para preservar a personagem.
                </span>
              </div>
            </div>

            {/* Denoise */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">Fidelidade à Personagem</label>
                <span className="text-xs text-text-secondary font-mono">{denoise.toFixed(2)}</span>
              </div>
              <input
                type="range"
                value={denoise}
                min={0.1}
                max={1}
                step={0.05}
                onChange={(e) => setDenoise(Number(e.target.value))}
                className="w-full mt-1"
                disabled={!charSrc || generating}
              />
              <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
                <span>Manter original</span>
                <span>Totalmente nova</span>
              </div>
            </div>
          </div>

          <div className="mt-auto p-4 border-t border-border space-y-3">
            {resultSrc && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-success/10 border border-success/20">
                <Sparkles size={14} className="text-success shrink-0" />
                <span className="text-xs text-text-primary">
                  Personagem recriada com a pose!
                </span>
              </div>
            )}

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
              disabled={!poseSrc || !charSrc || captioning || generating || !status.online}
              className={`
                w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm
                transition-all duration-200
                ${(!poseSrc || !charSrc || captioning || generating || !status.online)
                  ? 'bg-accent-muted text-text-muted cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98] shadow-lg shadow-accent/20'
                }
              `}
            >
              {captioning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Extraindo descrição...
                </>
              ) : generating ? (
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
