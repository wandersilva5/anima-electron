import { useState, useCallback, useRef, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Upload, Wand2, Trash2, Sparkles, ArrowLeftRight, Clock } from 'lucide-react'
import { MODEL_PROFILES } from '@shared/modelProfiles'
import type { DiffusionModelId, GenerationResult } from '@shared/types'
import { ModelSidebar } from './ModelSidebar'

export function RecreateTab() {
  const { status, loras, models, refreshLoras, addToHistory } = useSessionStore()

  const [selectedModel, setSelectedModel] = useState<DiffusionModelId>('anima')
  const [selectedCheckpoint, setSelectedCheckpoint] = useState('')
  const [selectedLora, setSelectedLora] = useState<string | null>(null)
  const [loraStrengthModel, setLoraStrengthModel] = useState(0.5)
  const [loraStrengthClip, setLoraStrengthClip] = useState(0.5)
  const [denoise, setDenoise] = useState(0.85)
  const [originalSrc, setOriginalSrc] = useState<string | null>(null)
  const [resultSrc, setResultSrc] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [captioning, setCaptioning] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [showingResult, setShowingResult] = useState(true)
  const [progress, setProgress] = useState<{ current: number; max: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [eta, setEta] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const startTimeRef = useRef(0)
  const progressTimerRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    const compatible = models.filter((model) => {
      const name = model.name.toLowerCase()
      if (selectedModel === 'anima') return name.includes('anima')
      if (selectedModel === 'krea2') return name.includes('krea') || name.includes('krea2')
      if (selectedModel === 'z-image') return name.includes('z-image') || name.includes('z_image')
      return true
    })
    if (compatible.length > 0 && !compatible.some(m => m.name === selectedCheckpoint)) {
      setSelectedCheckpoint(compatible[0].name)
    }
  }, [models, selectedModel, selectedCheckpoint])

  useEffect(() => {
    setSelectedLora(null)
    const folder = MODEL_PROFILES[selectedModel].loraFolder
    window.electronAPI.loras.list(folder).then((newLoras) => {
      useSessionStore.getState().setLoras(newLoras)
    }).catch(() => {})
  }, [selectedModel])

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setOriginalSrc(e.target?.result as string)
      setResultSrc(null)
      setCaption('')
      setError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) handleFile(file)
        break
      }
    }
  }, [handleFile])

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const clearImage = useCallback(() => {
    setOriginalSrc(null)
    setResultSrc(null)
    setCaption('')
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const doRecreate = useCallback(async (captionText: string) => {
    if (!originalSrc || !captionText.trim()) return
    setGenerating(true)
    setError(null)
    setResultSrc(null)
    setShowingResult(true)
    setProgress(null)
    setElapsed(0)
    setEta(null)
    startTimeRef.current = Date.now()

    const prof = MODEL_PROFILES[selectedModel]

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
      const result = await window.electronAPI.comfyui.generateImprove({
        diffusionModel: selectedModel,
        prompt: captionText,
        negativePrompt: '',
        seed: Math.floor(Math.random() * 2147483647),
        steps: prof.defaults.steps,
        cfg: prof.defaults.cfg,
        width: prof.defaults.width,
        height: prof.defaults.height,
        modelName: selectedCheckpoint,
        loraName: selectedLora,
        loraStrengthModel,
        loraStrengthClip,
        imageBase64: originalSrc,
        denoise,
        filenamePrefix: 'anima-recreate'
      })

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
            prompt: captionText,
            negativePrompt: '',
            seed: Math.floor(Math.random() * 2147483647),
            steps: prof.defaults.steps,
            cfg: prof.defaults.cfg,
            width: prof.defaults.width,
            height: prof.defaults.height,
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
      setError(err instanceof Error ? err.message : 'Erro ao recriar imagem')
    } finally {
      unsubProgress()
      clearInterval(progressTimerRef.current)
      setGenerating(false)
      setProgress(null)
    }
  }, [originalSrc, selectedModel, denoise, selectedCheckpoint, selectedLora, loraStrengthModel, loraStrengthClip, addToHistory])

  const handleRecreate = useCallback(async () => {
    if (!originalSrc) return

    if (!caption.trim()) {
      setCaptioning(true)
      setError(null)
      try {
        const result = await window.electronAPI.comfyui.captionImage({ imageBase64: originalSrc })
        if (result.text) {
          setCaption(result.text)
          await doRecreate(result.text)
        } else {
          setError('Não foi possível extrair descrição. Tente escrever manualmente.')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao gerar descrição')
      } finally {
        setCaptioning(false)
      }
    } else {
      await doRecreate(caption)
    }
  }, [originalSrc, caption, doRecreate])

  return (
    <div className="flex-1 flex gap-0 overflow-hidden">
      <main className="flex-1 flex flex-col items-center justify-center bg-surface overflow-hidden min-w-0 p-8">
        {!originalSrc ? (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`
              w-full max-w-lg aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center
              cursor-pointer transition-all duration-200
              ${dragOver
                ? 'border-accent bg-accent/5 scale-[1.02]'
                : 'border-border hover:border-text-muted hover:bg-surface-secondary'
              }
            `}
          >
            <Upload size={40} className="text-text-muted mb-3" />
            <span className="text-sm text-text-secondary font-medium">
              Clique, arraste ou cole uma imagem
            </span>
            <span className="text-xs text-text-muted mt-1">PNG, JPG ou WebP · Ctrl+V para colar</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
            />
          </div>
        ) : (
          <div className="w-full max-w-3xl flex flex-col items-center gap-4">
            <div className="relative w-full rounded-2xl overflow-hidden bg-surface-secondary shadow-2xl">
              <img
                src={resultSrc && showingResult ? resultSrc : originalSrc}
                alt="Preview"
                className="w-full h-auto max-h-[60vh] object-contain"
                draggable={false}
              />

              <div className={`absolute top-3 left-3 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider ${resultSrc && showingResult ? 'bg-success/90 text-white' : 'bg-surface/80 text-text-secondary backdrop-blur-sm'}`}>
                {resultSrc && showingResult ? 'Recriado' : 'Original'}
              </div>

              {resultSrc && (
                <button
                  onClick={() => setShowingResult(!showingResult)}
                  className="absolute top-3 right-3 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider bg-surface/80 text-text-secondary backdrop-blur-sm hover:bg-surface hover:text-text-primary transition-colors flex items-center gap-1"
                  title={showingResult ? 'Ver original' : 'Ver resultado'}
                >
                  <ArrowLeftRight size={12} />
                  {showingResult ? 'Ver Original' : 'Ver Resultado'}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={clearImage}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-tertiary hover:bg-border text-text-secondary hover:text-text-primary text-xs transition-colors"
              >
                <Trash2 size={14} />
                Remover
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-tertiary hover:bg-border text-text-secondary hover:text-text-primary text-xs transition-colors"
              >
                <Upload size={14} />
                Trocar
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                }}
              />
            </div>
          </div>
        )}
      </main>

      <aside className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-border bg-surface-secondary overflow-y-auto shrink-0 max-h-[40vh] lg:max-h-none">
        <div className="flex flex-col h-full">
          <div className="p-4 space-y-4 overflow-y-auto">
            <ModelSidebar
              diffusionModel={selectedModel}
              onDiffusionModelChange={setSelectedModel}
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

            {/* Caption textarea */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Descrição Extraída
              </label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder={originalSrc ? 'Clique em "Recriar Imagem" para extrair a descrição e recriar automaticamente, ou digite manualmente.' : 'Faça upload de uma imagem primeiro.'}
                rows={5}
                className="w-full bg-surface rounded-lg border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
                disabled={!originalSrc || generating}
              />
              {caption && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Sparkles size={10} className="text-accent shrink-0" />
                  <span className="text-[10px] text-text-muted">
                    Descrição extraída automaticamente. Edite se necessário.
                  </span>
                </div>
              )}
            </div>

            {/* Denoise */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">Força da Recriação</label>
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
                disabled={!originalSrc || generating}
              />
              <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
                <span>Sutil</span>
                <span>Intenso</span>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
                {error}
              </div>
            )}
          </div>

          <div className="mt-auto p-4 border-t border-border space-y-3">
            {resultSrc && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-success/10 border border-success/20">
                <Wand2 size={14} className="text-success shrink-0" />
                <span className="text-xs text-text-primary">
                  Imagem recriada com sucesso!
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
              onClick={handleRecreate}
              disabled={!originalSrc || generating || captioning || !status.online}
              className={`
                w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm
                transition-all duration-200
                ${(!originalSrc || generating || captioning || !status.online)
                  ? 'bg-accent-muted text-text-muted cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98] shadow-lg shadow-accent/20'
                }
              `}
            >
              {captioning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Gerando descrição...
                </>
              ) : generating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Recriando...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Recriar Imagem
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
