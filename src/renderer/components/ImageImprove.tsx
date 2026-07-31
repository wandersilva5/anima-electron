import { useState, useCallback, useRef, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Upload, Wand2, Trash2, Paintbrush, X, ArrowLeftRight } from 'lucide-react'
import type { DiffusionModelId, GenerationResult } from '@shared/types'
import { BrushCanvas, type BrushCanvasHandle } from './BrushCanvas'
import { ModelSidebar } from './ModelSidebar'

export function ImageImprove() {
  const { status, loras, models, refreshLoras, addToHistory } = useSessionStore()

  const [selectedModel, setSelectedModel] = useState<DiffusionModelId>('anima')
  const [selectedCheckpoint, setSelectedCheckpoint] = useState('')
  const [selectedLora, setSelectedLora] = useState<string | null>(null)
  const [loraStrengthModel, setLoraStrengthModel] = useState(0.5)
  const [loraStrengthClip, setLoraStrengthClip] = useState(0.5)
  const [prompt, setPrompt] = useState('')
  const [denoise, setDenoise] = useState(0.85)
  const [originalSrc, setOriginalSrc] = useState<string | null>(null)
  const [resultSrc, setResultSrc] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [brushMode, setBrushMode] = useState(false)
  const [showingResult, setShowingResult] = useState(true)
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const brushRef = useRef<BrushCanvasHandle>(null)

  // Auto-select first compatible model
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

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setOriginalSrc(e.target?.result as string)
      setResultSrc(null)
      setError(null)
      setBrushMode(false)
      setShowingResult(true)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const clearImage = useCallback(() => {
    setOriginalSrc(null)
    setResultSrc(null)
    setError(null)
    setBrushMode(false)
    setShowingResult(true)
    setImageDimensions({ width: 0, height: 0 })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  useEffect(() => {
    if (!originalSrc) return
    const img = new Image()
    img.onload = () => {
      setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = originalSrc
  }, [originalSrc])

  const handleImprove = useCallback(async () => {
    if (!originalSrc || !prompt.trim()) return
    setGenerating(true)
    setError(null)
    setResultSrc(null)
    setShowingResult(true)

    try {
      let maskBase64: string | undefined
      if (brushMode && brushRef.current) {
        const mask = brushRef.current.getMaskBase64()
        if (mask) {
          maskBase64 = mask
        }
      }

      const result = await window.electronAPI.comfyui.generateImprove({
        diffusionModel: selectedModel,
        prompt,
        negativePrompt: '',
        seed: Math.floor(Math.random() * 2147483647),
        steps: 20,
        cfg: 5,
        width: 1024,
        height: 1024,
        modelName: selectedCheckpoint,
        loraName: selectedLora,
        loraStrengthModel,
        loraStrengthClip,
        imageBase64: originalSrc,
        denoise,
        filenamePrefix: 'anima-improve',
        maskBase64
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
            prompt,
            negativePrompt: '',
            seed: Math.floor(Math.random() * 2147483647),
            steps: 20,
            cfg: 5,
            width: 1024,
            height: 1024,
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
      setError(err instanceof Error ? err.message : 'Erro ao melhorar imagem')
    } finally {
      setGenerating(false)
    }
  }, [originalSrc, prompt, selectedModel, denoise, brushMode, selectedCheckpoint, selectedLora, loraStrengthModel, loraStrengthClip, addToHistory])

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
              Clique ou arraste uma imagem
            </span>
            <span className="text-xs text-text-muted mt-1">PNG, JPG ou WebP</span>
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

              {!resultSrc && brushMode && originalSrc && imageDimensions.width > 0 && (
                <BrushCanvas
                  ref={brushRef}
                  imageSrc={originalSrc}
                  imageWidth={imageDimensions.width}
                  imageHeight={imageDimensions.height}
                  visible={true}
                />
              )}

              <div className={`absolute top-3 left-3 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider ${resultSrc && showingResult ? 'bg-success/90 text-white' : 'bg-surface/80 text-text-secondary backdrop-blur-sm'}`}>
                {resultSrc && showingResult ? 'Melhorado' : brushMode ? 'Modo Pincel' : 'Original'}
              </div>

              {/* Compare toggle */}
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

              {!resultSrc && (
                <button
                  onClick={() => {
                    setBrushMode(!brushMode)
                    if (brushMode) {
                      brushRef.current?.clearMask()
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                    brushMode
                      ? 'bg-accent/20 text-accent border border-accent/30'
                      : 'bg-surface-tertiary hover:bg-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {brushMode ? <X size={14} /> : <Paintbrush size={14} />}
                  {brushMode ? 'Sair do Pincel' : 'Marcar Área'}
                </button>
              )}

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

            {/* Brush controls below image */}
            {brushMode && !resultSrc && (
              <div className="flex items-center gap-2 bg-surface-secondary border border-border rounded-xl px-4 py-2.5 shadow-sm">
                <button
                  onClick={() => brushRef.current?.setIsErasing(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white transition-colors"
                >
                  Pincel
                </button>
                <button
                  onClick={() => brushRef.current?.setIsErasing(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-tertiary text-text-secondary hover:text-text-primary transition-colors"
                >
                  Borracha
                </button>

                <div className="w-px h-5 bg-border" />

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted">Tamanho</span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    defaultValue={30}
                    onChange={(e) => brushRef.current?.setBrushSize(Number(e.target.value))}
                    className="w-24 h-1"
                  />
                </div>

                <div className="w-px h-5 bg-border" />

                <span className="text-[11px] text-text-muted">Pinte sobre a área que deseja modificar</span>
              </div>
            )}
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

            {/* Prompt */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                {brushMode ? 'O que deseja na área marcada?' : 'O que deseja modificar?'}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={brushMode
                  ? 'Descreva como a área marcada deve ficar. Ex: adicione flores, mude a cor para azul...'
                  : 'Descreva a melhoria desejada. Ex: deixe mais nítido, melhore as cores, adicione detalhes...'
                }
                rows={4}
                className="w-full bg-surface rounded-lg border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
                disabled={!originalSrc || generating}
              />
            </div>

            {/* Denoise */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">Força da Modificação</label>
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
                  Imagem melhorada!
                </span>
              </div>
            )}

            <button
              onClick={handleImprove}
              disabled={!originalSrc || !prompt.trim() || generating || !status.online}
              className={`
                w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm
                transition-all duration-200
                ${(!originalSrc || !prompt.trim() || generating || !status.online)
                  ? 'bg-accent-muted text-text-muted cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98] shadow-lg shadow-accent/20'
                }
              `}
            >
              {generating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Melhorando...
                </>
              ) : (
                <>
                  <Wand2 size={16} />
                  {brushMode ? 'Aplicar na Área' : 'Melhorar Imagem'}
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
