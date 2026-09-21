import { useState, useCallback, useRef, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Upload, Wand2, Trash2, Sparkles, ArrowLeftRight, Clock, Eye, EyeOff, Copy, Check } from 'lucide-react'
import { MODEL_PROFILES } from '@shared/modelProfiles'
import type { DiffusionModelId, GenerationResult } from '@shared/types'
import { ModelSidebar } from './ModelSidebar'
import { useGenerationProgress } from '../hooks/useGenerationProgress'
import { useAutoSelectModel } from '../hooks/useAutoSelectModel'
import { useLoraSelection } from '../hooks/useLoraSelection'
import { resizeImageForModel } from '../utils/imageResize'
import { loadTabSettings, saveTabSettings } from '../utils/tabSettings'

const TAB_KEY = 'recreate'

export function RecreateTab() {
  const { status, models, refreshLoras, addToHistory } = useSessionStore()

  const savedSettings = useRef(loadTabSettings(TAB_KEY)).current
  const [selectedModel, setSelectedModel] = useState<DiffusionModelId>(savedSettings.diffusionModel ?? 'anima')
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(savedSettings.checkpoint ?? '')
  const { selectedLoras, setSelectedLoras, toggleLora, clearLoras, setLoraStrength } = useLoraSelection(savedSettings.loras ?? [])
  const [denoise, setDenoise] = useState(savedSettings.denoise ?? 0.65)
  const [originalSrc, setOriginalSrc] = useState<string | null>(null)
  const [resultSrc, setResultSrc] = useState<string | null>(null)
  const [caption, setCaption] = useState(savedSettings.prompt ?? '')
  const [captionMode, setCaptionMode] = useState<'descriptive' | 'tags'>(savedSettings.captionMode ?? 'descriptive')
  const [captioning, setCaptioning] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [showingResult, setShowingResult] = useState(true)
  const [blurred, setBlurred] = useState(false)
  const { progress, elapsed, eta, startProgress } = useGenerationProgress()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loras = useSessionStore((s) => s.tabLoras)

  useAutoSelectModel(models, selectedModel, selectedCheckpoint, setSelectedCheckpoint)

  // Carrega a lista de LoRAs do modelo selecionado (mantém a seleção restaurada se ainda válida)
  useEffect(() => {
    const folder = MODEL_PROFILES[selectedModel].loraFolder
    window.electronAPI.loras.list(folder).then((newLoras) => {
      useSessionStore.getState().setTabLoras(newLoras)
      setSelectedLoras((prev) => prev.filter((sel) => newLoras.some((l) => l.name === sel.name)))
    }).catch(() => { })
  }, [selectedModel, setSelectedLoras])

  // Persiste as configurações da aba sempre que mudam
  useEffect(() => {
    saveTabSettings(TAB_KEY, {
      diffusionModel: selectedModel,
      checkpoint: selectedCheckpoint,
      loras: selectedLoras,
      prompt: caption,
      denoise,
      captionMode
    })
  }, [selectedModel, selectedCheckpoint, selectedLoras, caption, denoise, captionMode])

  // Imagem escolhida no histórico (sidebar) vira a imagem de origem
  const pendingPick = useSessionStore((s) => s.pendingHistoryPick)
  const requestHistoryPick = useSessionStore((s) => s.requestHistoryPick)
  useEffect(() => {
    if (!pendingPick) return
    const picked = pendingPick
    requestHistoryPick(null)
    const apply = (src: string) => {
      setOriginalSrc(src)
      setResultSrc(null)
      setCaption('')
      setError(null)
      setBlurred(false)
      setShowingResult(true)
    }
    if (picked.imageBase64) {
      apply(picked.imageBase64)
    } else if (picked.filePath) {
      window.electronAPI.file.readImage(picked.filePath).then((data) => {
        if (data) apply(data)
      })
    }
  }, [pendingPick, requestHistoryPick])

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setOriginalSrc(e.target?.result as string)
      setResultSrc(null)
      setCaption('')
      setError(null)
      setBlurred(false)
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
    setBlurred(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const doRecreate = useCallback(async (captionText: string) => {
    if (!originalSrc || !captionText.trim()) return
    setGenerating(true)
    setError(null)
    setResultSrc(null)
    setShowingResult(true)

    const stopProgress = startProgress()
    const prof = MODEL_PROFILES[selectedModel]

    try {
      let imageBase64 = originalSrc
      try {
        imageBase64 = await resizeImageForModel(originalSrc, selectedModel)
      } catch {
        console.warn('[Anima] Redimensionamento falhou, usando imagem original')
      }

      const seed = Math.floor(Math.random() * 2147483647)

      const result = await window.electronAPI.comfyui.generateImprove({
        diffusionModel: selectedModel,
        prompt: captionText,
        negativePrompt: 'worst quality, low quality, lowres, score_1, score_2, score_3, score_4, blurry, jpeg artifacts, cropped, long fingers, sepia, bad anatomy, missing fingers, artist name, random objects, props, furniture, text, logo, watermark, signature, distorted body, deformed hands, extra arms, extra legs, extra fingers, low resolution, low detail, bad anatomy, bad proportions, gore',
        seed,
        steps: prof.defaults.steps,
        cfg: prof.defaults.cfg,
        width: prof.defaults.width,
        height: prof.defaults.height,
        modelName: selectedCheckpoint,
        loras: selectedLoras,
        imageBase64,
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
            seed,
            steps: prof.defaults.steps,
            cfg: prof.defaults.cfg,
            width: prof.defaults.width,
            height: prof.defaults.height,
            modelName: selectedCheckpoint,
            loras: selectedLoras,
          },
          timestamp: Date.now()
        }
        addToHistory(entry)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao recriar imagem')
    } finally {
      stopProgress()
      setGenerating(false)
    }
  }, [originalSrc, selectedModel, denoise, selectedCheckpoint, selectedLoras, startProgress, addToHistory])

  const handleExtractCaption = useCallback(async () => {
    if (!originalSrc) return
    setCaptioning(true)
    setError(null)
    try {
      const result = await window.electronAPI.comfyui.captionImage({
        imageBase64: originalSrc,
        mode: captionMode
      })
      if (result.text) {
        setCaption(result.text)
      } else {
        setError('Não foi possível extrair a descrição. Tente escrever manualmente.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar descrição')
    } finally {
      setCaptioning(false)
    }
  }, [originalSrc, captionMode])

  const handleCopyCaption = useCallback(() => {
    if (!caption) return
    navigator.clipboard.writeText(caption)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [caption])

  const handleRecreate = useCallback(async () => {
    if (!originalSrc) return

    if (!caption.trim()) {
      setCaptioning(true)
      setError(null)
      try {
        const result = await window.electronAPI.comfyui.captionImage({
          imageBase64: originalSrc,
          mode: captionMode
        })
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
  }, [originalSrc, caption, captionMode, doRecreate])

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
                className={`w-full h-auto max-h-[60vh] object-contain transition-all duration-300 ${blurred ? 'blur-[200px] scale-105' : ''}`}
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
                onClick={() => setBlurred(!blurred)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${blurred ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-surface-tertiary hover:bg-border text-text-secondary hover:text-text-primary'}`}
                title={blurred ? 'Mostrar imagem nítida' : 'Desfocar imagem'}
              >
                {blurred ? <Eye size={14} /> : <EyeOff size={14} />}
                {blurred ? 'Nitidar' : 'Desfocar'}
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
              loras={loras}
              selectedLoras={selectedLoras}
              onToggleLora={toggleLora}
              onClearLoras={clearLoras}
              onLoraStrengthChange={setLoraStrength}
              refreshLorasFn={refreshLoras}
            />

            {/* Caption textarea */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Descrição da Imagem
                </label>

                {/* Seletor de Formato: Descritivo vs Tags */}
                <div className="flex items-center bg-surface p-0.5 rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setCaptionMode('descriptive')}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors ${captionMode === 'descriptive'
                        ? 'bg-accent text-white shadow-xs'
                        : 'text-text-muted hover:text-text-primary'
                      }`}
                    title="Gera uma descrição rica e estruturada em prosa natural"
                  >
                    Descritivo
                  </button>
                  <button
                    type="button"
                    onClick={() => setCaptionMode('tags')}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors ${captionMode === 'tags'
                        ? 'bg-accent text-white shadow-xs'
                        : 'text-text-muted hover:text-text-primary'
                      }`}
                    title="Gera lista de tags organizadas (formato Danbooru)"
                  >
                    Tags
                  </button>
                </div>
              </div>

              <div className="relative">
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={
                    originalSrc
                      ? 'Clique em "Extrair Descrição" ou "Recriar Imagem" para descrever a imagem, ou digite aqui.'
                      : 'Faça upload de uma imagem primeiro.'
                  }
                  rows={8}
                  className="w-full bg-surface rounded-lg border border-border px-3 py-2.5 text-xs leading-relaxed text-text-primary placeholder:text-text-muted resize-y min-h-[140px] focus:outline-none focus:ring-1 focus:ring-accent transition-colors font-sans"
                  disabled={!originalSrc || generating}
                />
              </div>

              {/* Ações de Extração e Cópia */}
              <div className="flex items-center justify-between mt-2">
                <button
                  type="button"
                  onClick={handleExtractCaption}
                  disabled={!originalSrc || captioning || generating || !status.online}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${!originalSrc || captioning || generating || !status.online
                      ? 'bg-surface-tertiary text-text-muted cursor-not-allowed opacity-60'
                      : 'bg-accent/15 text-accent hover:bg-accent/25 border border-accent/30'
                    }`}
                  title="Extrai a descrição da imagem no formato selecionado sem iniciar geração"
                >
                  {captioning ? (
                    <>
                      <div className="w-3 h-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                      <span>Extraindo...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} />
                      <span>{caption ? 'Reextrair Descrição' : 'Extrair Descrição'}</span>
                    </>
                  )}
                </button>

                {caption && (
                  <button
                    type="button"
                    onClick={handleCopyCaption}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-tertiary hover:bg-border text-text-secondary hover:text-text-primary transition-colors"
                    title="Copiar descrição para a área de transferência"
                  >
                    {copied ? (
                      <>
                        <Check size={13} className="text-success" />
                        <span className="text-success">Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} />
                        <span>Copiar</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {caption && (
                <div className="flex items-center gap-1.5 mt-2">
                  <Sparkles size={10} className="text-accent shrink-0" />
                  <span className="text-[10px] text-text-muted">
                    {captionMode === 'descriptive'
                      ? 'Confira o "Subject Count" (solo = 1 personagem). Ajuste se a quantidade estiver errada.'
                      : 'Confira se começa com "solo" (1 personagem) ou a contagem certa. Ajuste se necessário.'}
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
