import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Upload, Wand2, Trash2, Sparkles, ArrowLeftRight, Clock, Eye, EyeOff, Copy, Check, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { MODEL_PROFILES } from '@shared/modelProfiles'
import type { DiffusionModelId, GenerationResult, LoraInfo, RegionalLoraSlot } from '@shared/types'
import { ModelSidebar } from './ModelSidebar'
import { useGenerationProgress } from '../hooks/useGenerationProgress'
import { useAutoSelectModel } from '../hooks/useAutoSelectModel'
import { useLoraSelection } from '../hooks/useLoraSelection'
import { resizeImageForModel } from '../utils/imageResize'
import { loadTabSettings, saveTabSettings, type RegionalSettings } from '../utils/tabSettings'
import { SafeImage } from './SafeImage'

const TAB_KEY = 'recreate'

export function RecreateTab() {
  const { status, models, refreshLoras, addToHistory } = useSessionStore()

  const savedSettings = useRef(loadTabSettings(TAB_KEY)).current
  const [selectedModel, setSelectedModel] = useState<DiffusionModelId>(savedSettings.diffusionModel ?? 'anima')
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(savedSettings.checkpoint ?? '')
  const { selectedLoras, setSelectedLoras, toggleLora, clearLoras, setLoraStrength } = useLoraSelection(savedSettings.loras ?? [])
  const [denoise, setDenoise] = useState(savedSettings.denoise ?? 0.65)
  const [regional, setRegional] = useState<RegionalSettings>(
    savedSettings.regional ?? { enabled: false, face: null, breasts: null }
  )
  const [regionalOpen, setRegionalOpen] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
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
      captionMode,
      regional
    })
  }, [selectedModel, selectedCheckpoint, selectedLoras, caption, denoise, captionMode, regional])

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
    setNotice(null)
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

      // LoRAs por região (teste): descarta slots de pastas que já não existem
      const validSlot = (slot: RegionalLoraSlot | null): RegionalLoraSlot | null =>
        slot && loras.some(l => l.name === slot.name) ? slot : null
      const regionalFace = validSlot(regional.face)
      const regionalBreasts = validSlot(regional.breasts)
      const regionalParam = regional.enabled && (regionalFace || regionalBreasts)
        ? { face: regionalFace, breasts: regionalBreasts }
        : undefined

      const result = await window.electronAPI.comfyui.generateImprove({
        diffusionModel: selectedModel,
        prompt: captionText,
        negativePrompt: 'worst quality, low quality, lowres, score_1, score_2, score_3, score_4, blurry, jpeg artifacts, cropped, long fingers, sepia, bad anatomy, missing fingers, artist name, random objects, props, furniture, text, logo, watermark, signature, distorted body, deformed hands, extra arms, extra legs, extra fingers, low resolution, low detail, bad anatomy, bad proportions, gore, large breasts, extra-large breasts, huge breasts',
        seed,
        steps: prof.defaults.steps,
        cfg: prof.defaults.cfg,
        width: prof.defaults.width,
        height: prof.defaults.height,
        modelName: selectedCheckpoint,
        loras: selectedLoras,
        imageBase64,
        denoise,
        filenamePrefix: 'anima-recreate',
        regional: regionalParam
      })

      if (result.warning) {
        setNotice(result.warning)
      }

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
  }, [originalSrc, selectedModel, denoise, selectedCheckpoint, selectedLoras, regional, loras, startProgress, addToHistory])

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

            {/* LoRAs por região (teste — apenas modelo anima) */}
            {selectedModel === 'anima' && (
              <div className="p-3 rounded-lg border border-border bg-surface space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setRegionalOpen(o => !o)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider hover:text-text-primary text-left transition-colors flex-1"
                  >
                    {regionalOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    <span>LoRAs por Região</span>
                    <span className="text-[9px] uppercase tracking-wider text-accent font-semibold normal-case px-1 py-0.5 rounded bg-accent/10">teste</span>
                    {regional.enabled && (
                      <span className="text-[10px] text-accent font-normal normal-case">
                        ({[regional.face ? 'rosto' : null, regional.breasts ? 'seios' : null].filter(Boolean).join(', ') || 'ativo'})
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={regional.enabled}
                    disabled={generating}
                    onClick={() => setRegional(r => ({ ...r, enabled: !r.enabled }))}
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border transition-colors shrink-0 ${
                      generating
                        ? 'opacity-40 cursor-not-allowed bg-surface-tertiary text-text-muted border-border'
                        : regional.enabled
                          ? 'bg-accent text-white border-accent'
                          : 'bg-surface-tertiary text-text-muted border-border hover:text-text-primary'
                    }`}
                  >
                    {regional.enabled ? 'Ativo' : 'Off'}
                  </button>
                </div>

                {regionalOpen && (
                  <div className="space-y-3 pt-1 border-t border-border/50">
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      Um LoRA aplicado só ao rosto e outro só aos seios, com máscaras detectadas
                      automaticamente na imagem de entrada.
                    </p>
                    <RegionalSlotRow
                      label="Rosto"
                      value={regional.face}
                      loras={loras}
                      disabled={generating}
                      onChange={(slot) => setRegional(r => ({ ...r, face: slot }))}
                    />
                    <RegionalSlotRow
                      label="Seios"
                      value={regional.breasts}
                      loras={loras}
                      disabled={generating}
                      onChange={(slot) => setRegional(r => ({ ...r, breasts: slot }))}
                    />
                  </div>
                )}
              </div>
            )}

            {notice && (
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs">
                {notice}
              </div>
            )}

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

/** Uma linha do seletor regional: miniatura + LoRA (dropdown) + força (slider único model/clip). */
function RegionalSlotRow({
  label,
  value,
  loras,
  disabled,
  onChange
}: {
  label: string
  value: RegionalLoraSlot | null
  loras: LoraInfo[]
  disabled: boolean
  onChange: (slot: RegionalLoraSlot | null) => void
}) {
  const selected = value ? loras.find((l) => l.name === value.name) : undefined
  const shortName = selected ? shortLoraName(selected.name) : ''
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Foca no campo de busca ao abrir ou limpa a busca ao fechar
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    } else {
      setSearch('')
    }
  }, [open])

  const filteredLoras = useMemo(() => {
    if (!search.trim()) return loras
    const q = search.trim().toLowerCase()
    return loras.filter((l) => {
      const name = l.name.toLowerCase()
      const short = shortLoraName(l.name).toLowerCase()
      return name.includes(q) || short.includes(q)
    })
  }, [loras, search])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">{label}</span>
        <span className="text-[10px] text-text-muted font-mono">
          {value ? value.strengthModel.toFixed(2) : '—'}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <div className="w-11 h-11 shrink-0 rounded-lg border border-border overflow-hidden bg-surface-tertiary flex items-center justify-center">
          {selected?.previewUrl ? (
            <SafeImage
              path={selected.previewUrl}
              alt={shortName}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-[8px] text-text-muted text-center px-1 leading-tight break-all">
              {shortName ? shortName.slice(0, 18) : label}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="relative" ref={containerRef}>
            <button
              type="button"
              disabled={disabled || loras.length === 0}
              onClick={() => setOpen((o) => !o)}
              className="w-full flex items-center gap-2 bg-surface rounded-lg border border-border px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60 text-left"
            >
              <span className="flex-1 min-w-0 truncate">
                {shortName || (loras.length === 0 ? 'Nenhum LoRA disponível' : 'Nenhum LoRA')}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </button>
            {open && (
              <div className="absolute left-0 right-0 top-full mt-1 max-h-60 z-30 rounded-lg border border-border bg-surface shadow-xl flex flex-col overflow-hidden">
                {/* Campo de pesquisa digitando */}
                <div className="p-1.5 border-b border-border bg-surface shrink-0">
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Pesquisar LoRA..."
                      className="w-full bg-surface-tertiary rounded border border-border pl-6 pr-6 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSearch('')
                          searchInputRef.current?.focus()
                        }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-[10px] w-4 h-4 flex items-center justify-center rounded"
                        title="Limpar busca"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Lista rolável de opções */}
                <div className="flex-1 overflow-y-auto custom-scroll">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(null)
                      setOpen(false)
                    }}
                    className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-surface-tertiary transition-colors border-b border-border/40 ${
                      value ? 'text-text-muted' : 'text-accent font-medium'
                    }`}
                  >
                    Nenhum LoRA
                  </button>

                  {filteredLoras.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[11px] text-text-muted">
                      Nenhum LoRA encontrado
                    </div>
                  ) : (
                    filteredLoras.map((l) => {
                      const name = shortLoraName(l.name)
                      const isSelected = value?.name === l.name
                      return (
                        <button
                          key={l.name}
                          type="button"
                          title={l.name}
                          onClick={() => {
                            const strength = value?.strengthModel ?? 0.8
                            onChange({ name: l.name, strengthModel: strength, strengthClip: strength })
                            setOpen(false)
                          }}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-tertiary transition-colors ${
                            isSelected ? 'bg-accent/10' : ''
                          }`}
                        >
                          <span className="w-8 h-8 shrink-0 rounded overflow-hidden bg-surface-tertiary border border-border flex items-center justify-center">
                            {l.previewUrl ? (
                              <SafeImage path={l.previewUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[7px] text-text-muted text-center px-0.5 leading-tight break-all">
                                {name.slice(0, 10)}
                              </span>
                            )}
                          </span>
                          <span
                            className={`flex-1 min-w-0 text-[11px] leading-tight break-all ${
                              isSelected ? 'text-accent font-medium' : 'text-text-primary'
                            }`}
                          >
                            {name}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          {value && (
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={value.strengthModel}
              disabled={disabled}
              onChange={(e) => {
                const v = Number(e.target.value)
                onChange({ ...value, strengthModel: v, strengthClip: v })
              }}
              className="w-full"
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** Nome curto do LoRA (sem caminho nem extensão). */
function shortLoraName(name: string): string {
  return name.replace(/\.(safetensors|ckpt|gguf)$/, '').split(/[/\\]/).pop() ?? name
}
