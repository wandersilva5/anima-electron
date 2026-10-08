import { useState, useCallback, useRef, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Upload, Wand2, Trash2, Paintbrush, X, ArrowLeftRight, Clock, ImagePlus } from 'lucide-react'
import type { DiffusionModelId, GenerationResult, ImproveEditMode } from '@shared/types'
import { MODEL_PROFILES } from '@shared/modelProfiles'
import { BrushCanvas, type BrushCanvasHandle } from './BrushCanvas'
import { ModelSidebar } from './ModelSidebar'
import { useGenerationProgress } from '../hooks/useGenerationProgress'
import { useFilterModels } from '../hooks/useFilterModels'
import { useLoraSelection } from '../hooks/useLoraSelection'
import { resizeImageForModel } from '../utils/imageResize'
import { loadTabSettings, saveTabSettings } from '../utils/tabSettings'

const TAB_KEY = 'improve'
const DIFFUSION_MODEL: DiffusionModelId = 'qwen-image'
const PROFILE = MODEL_PROFILES[DIFFUSION_MODEL]

const MODES: { id: ImproveEditMode; label: string; hint: string }[] = [
  { id: 'edit', label: 'Edição', hint: 'Instrução nativa 2.1' },
  { id: 'refine', label: 'Refinar', hint: 'Força controlável' },
  { id: 'inpaint', label: 'Área', hint: 'Pincel + máscara' }
]

const PRESETS: { label: string; text: string; needsRef?: boolean }[] = [
  { label: 'Nitidez', text: 'aumente a nitidez e o detalhamento, mantendo o conteúdo, enquadramento e estilo originais' },
  { label: 'Remover fundo', text: 'remova o fundo e deixe o fundo totalmente transparente' },
  { label: 'Iluminação', text: 'melhore a iluminação e o contraste, com cores vibrantes e naturais, sem alterar o conteúdo da cena' },
  { label: 'Restaurar', text: 'restaure a imagem: remova ruído, arranhões, manchas e artefatos, preservando os detalhes originais' },
  { label: 'Rosto', text: 'melhore o rosto: pele natural e suave, olhos nítidos, preservando identidade, expressão e iluminação originais' },
  { label: 'Roupa pela referência', needsRef: true, text: 'mantenha <image1> exatamente como está e vista a pessoa com a roupa da <image2>, preservando rosto, cabelo, pose, corpo e fundo' }
]

export function ImageImprove() {
  const { status, models, refreshLoras, addToHistory } = useSessionStore()

  const savedSettings = useRef(loadTabSettings(TAB_KEY)).current
  const [editMode, setEditMode] = useState<ImproveEditMode>(savedSettings.editMode ?? 'edit')
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(savedSettings.checkpoint ?? '')
  const { selectedLoras, setSelectedLoras, toggleLora, clearLoras, setLoraStrength, reorderLoras } = useLoraSelection(savedSettings.loras ?? [])
  const [prompt, setPrompt] = useState(savedSettings.prompt ?? '')
  const [denoise, setDenoise] = useState(savedSettings.denoise ?? 0.55)
  const [originalSrc, setOriginalSrc] = useState<string | null>(null)
  const [refSrc, setRefSrc] = useState<string | null>(null)
  const [resultSrc, setResultSrc] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [showingResult, setShowingResult] = useState(true)
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const refFileInputRef = useRef<HTMLInputElement>(null)
  const brushRef = useRef<BrushCanvasHandle>(null)
  const loras = useSessionStore((s) => s.tabLoras)
  const { progress, elapsed, eta, startProgress } = useGenerationProgress()

  // Checkpoint compatível com o Qwen Image 2.1 (preferindo os pesos 2.1 nativos)
  const compatibleModels = useFilterModels(models, DIFFUSION_MODEL)
  useEffect(() => {
    if (compatibleModels.length === 0) return
    if (compatibleModels.some(m => m.name === selectedCheckpoint)) return
    const preferred = compatibleModels.find(m => m.name.includes('qwen_image_2.1') && !m.name.toLowerCase().endsWith('.gguf'))
    setSelectedCheckpoint((preferred ?? compatibleModels[0]).name)
  }, [compatibleModels, selectedCheckpoint])

  // Carrega a lista de LoRAs do modelo selecionado (mantém a seleção restaurada se ainda válida)
  useEffect(() => {
    const folder = PROFILE.loraFolder
    window.electronAPI.loras.list(folder).then((newLoras) => {
      useSessionStore.getState().setTabLoras(newLoras)
      setSelectedLoras((prev) => prev.filter((sel) => newLoras.some((l) => l.name === sel.name)))
    }).catch(() => { })
  }, [setSelectedLoras])

  // Persiste as configurações da aba sempre que mudam
  useEffect(() => {
    saveTabSettings(TAB_KEY, {
      diffusionModel: DIFFUSION_MODEL,
      checkpoint: selectedCheckpoint,
      loras: selectedLoras,
      prompt,
      denoise,
      editMode
    })
  }, [selectedCheckpoint, selectedLoras, prompt, denoise, editMode])

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
      setError(null)
      setNotice(null)
      setShowingResult(true)
      brushRef.current?.clearMask()
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
      setError(null)
      setNotice(null)
      setShowingResult(true)
      brushRef.current?.clearMask()
    }
    reader.readAsDataURL(file)
  }, [])

  const handleRefFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => setRefSrc(e.target?.result as string)
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
    setNotice(null)
    setShowingResult(true)
    setImageDimensions({ width: 0, height: 0 })
    brushRef.current?.clearMask()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const changeMode = useCallback((mode: ImproveEditMode) => {
    setEditMode(mode)
    setDenoise(mode === 'inpaint' ? 0.85 : 0.55)
    if (mode !== 'inpaint') brushRef.current?.clearMask()
    setError(null)
  }, [])

  const applyPreset = useCallback((text: string) => {
    setPrompt((prev) => {
      if (prev.includes(text)) return prev
      return prev.trim() ? `${prev.trim()}\n${text}` : text
    })
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
    setError(null)
    setNotice(null)

    let maskBase64: string | undefined
    if (editMode === 'inpaint') {
      const mask = brushRef.current?.getMaskBase64() ?? null
      if (!mask) {
        setError('Pinte a área que deseja modificar antes de gerar.')
        return
      }
      maskBase64 = mask
    }

    setGenerating(true)
    setResultSrc(null)
    setShowingResult(true)
    const stopProgress = startProgress()

    try {
      const imageBase64 = await resizeImageForModel(originalSrc, DIFFUSION_MODEL)
      if (maskBase64) {
        maskBase64 = await resizeImageForModel(maskBase64, DIFFUSION_MODEL)
      }
      const refImageBase64 = refSrc ? await resizeImageForModel(refSrc, DIFFUSION_MODEL) : undefined

      const seed = Math.floor(Math.random() * 2147483647)
      // LoRA de 8 steps (p_qwen_image_2.1_8step) roda mais rápido com 8 passos
      const uses8StepLora = selectedLoras.some(l => /8step/i.test(l.name))
      const steps = uses8StepLora ? 8 : PROFILE.defaults.steps

      const result = await window.electronAPI.comfyui.generateImprove({
        diffusionModel: DIFFUSION_MODEL,
        editMode,
        prompt,
        negativePrompt: '',
        seed,
        steps,
        cfg: PROFILE.defaults.cfg,
        width: PROFILE.defaults.width,
        height: PROFILE.defaults.height,
        modelName: selectedCheckpoint,
        loras: selectedLoras,
        imageBase64,
        refImageBase64,
        denoise: editMode === 'edit' ? 1 : denoise,
        filenamePrefix: 'anima-improve',
        maskBase64
      })

      if (result.warning) setNotice(result.warning)

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
            diffusionModel: DIFFUSION_MODEL,
            prompt,
            negativePrompt: '',
            seed,
            steps,
            cfg: PROFILE.defaults.cfg,
            width: PROFILE.defaults.width,
            height: PROFILE.defaults.height,
            modelName: selectedCheckpoint,
            loras: selectedLoras,
            editMode
          },
          timestamp: Date.now()
        }
        addToHistory(entry)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao melhorar imagem')
    } finally {
      stopProgress()
      setGenerating(false)
    }
  }, [originalSrc, prompt, editMode, denoise, refSrc, selectedCheckpoint, selectedLoras, startProgress, addToHistory])

  const canGenerate = !!originalSrc && !!prompt.trim() && !generating && !!status.online
  // Pincel: montado enquanto estiver no modo inpaint (a máscara sobrevive aos
  // toggles de comparação); visível só olhando o original, fora da geração.
  const showBrush = editMode === 'inpaint' && !generating && (!resultSrc || !showingResult)

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
            <span className="text-xs text-text-muted mt-1">PNG, JPG ou WebP · Qwen Image 2.1</span>
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

              {editMode === 'inpaint' && originalSrc && imageDimensions.width > 0 && (
                <BrushCanvas
                  ref={brushRef}
                  imageSrc={originalSrc}
                  imageWidth={imageDimensions.width}
                  imageHeight={imageDimensions.height}
                  visible={showBrush}
                />
              )}

              <div className={`absolute top-3 left-3 z-20 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider ${resultSrc && showingResult ? 'bg-success/90 text-white' : editMode === 'inpaint' ? 'bg-accent/90 text-white' : 'bg-surface/80 text-text-secondary backdrop-blur-sm'}`}>
                {resultSrc && showingResult
                  ? 'Melhorado'
                  : editMode === 'inpaint'
                    ? 'Modo Pincel'
                    : editMode === 'refine'
                      ? 'Original · Refinar'
                      : 'Original'}
              </div>

              {/* Compare toggle */}
              {resultSrc && (
                <button
                  onClick={() => setShowingResult(!showingResult)}
                  className="absolute top-3 right-3 z-20 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider bg-surface/80 text-text-secondary backdrop-blur-sm hover:bg-surface hover:text-text-primary transition-colors flex items-center gap-1"
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

            {/* Brush controls below image */}
            {showBrush && (
              <div className="flex items-center gap-2 bg-surface-secondary border border-border rounded-xl px-4 py-2.5 shadow-sm">
                <Paintbrush size={14} className="text-accent" />
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
              diffusionModel={DIFFUSION_MODEL}
              onDiffusionModelChange={() => {}}
              hideDiffusionSelector
              modelName={selectedCheckpoint}
              onModelChange={setSelectedCheckpoint}
              models={models}
              loras={loras}
              selectedLoras={selectedLoras}
              onToggleLora={toggleLora}
              onClearLoras={clearLoras}
              onLoraStrengthChange={setLoraStrength}
              onReorderLoras={reorderLoras}
              refreshLorasFn={refreshLoras}
            />

            {/* Modo de edição */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Modo de Edição
              </label>
              <div className="grid grid-cols-3 gap-2">
                {MODES.map((mode) => {
                  const isSelected = editMode === mode.id
                  return (
                    <button
                      key={mode.id}
                      onClick={() => changeMode(mode.id)}
                      disabled={generating}
                      className={`
                        flex flex-col items-center justify-center p-2.5 rounded-xl border-2 text-center transition-all
                        ${isSelected
                          ? 'border-accent bg-accent/5 text-text-primary shadow-lg shadow-accent/5'
                          : 'border-border bg-surface hover:border-text-muted text-text-secondary'
                        }
                      `}
                    >
                      <span className={`text-xs font-bold ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                        {mode.label}
                      </span>
                      <span className="text-[9px] text-text-muted mt-0.5 leading-tight">
                        {mode.hint}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Imagem de referência (<image2>) */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Referência <span className="font-normal normal-case text-text-muted">(opcional · &lt;image2&gt;)</span>
              </label>
              <div className="flex items-center gap-3">
                {refSrc ? (
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border bg-surface shrink-0">
                    <img src={refSrc} alt="Referência" className="w-full h-full object-cover" draggable={false} />
                    <button
                      onClick={() => { setRefSrc(null); if (refFileInputRef.current) refFileInputRef.current.value = '' }}
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-surface/90 text-text-secondary hover:text-error flex items-center justify-center"
                      title="Remover referência"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => refFileInputRef.current?.click()}
                    className="w-16 h-16 rounded-lg border-2 border-dashed border-border hover:border-text-muted bg-surface flex flex-col items-center justify-center text-text-muted hover:text-text-secondary transition-colors shrink-0"
                    title="Adicionar imagem de referência"
                  >
                    <ImagePlus size={16} />
                    <span className="text-[8px] mt-0.5">Adicionar</span>
                  </button>
                )}
                <div className="text-[11px] text-text-muted leading-snug">
                  {refSrc
                    ? 'A referência entra como <image2> no prompt: use-a para roupa, estilo, objeto ou cenário.'
                    : 'Segunda imagem para o prompt: vista a pessoa com a roupa da <image2>, use o cenário da <image2>...'}
                </div>
              </div>
              <input
                ref={refFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleRefFile(file)
                }}
              />
            </div>

            {/* Presets de instrução */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Ações rápidas
              </label>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.filter(p => !p.needsRef || refSrc).map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset.text)}
                    disabled={generating || !originalSrc}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-surface border border-border text-text-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                {editMode === 'edit'
                  ? 'Instrução de edição'
                  : editMode === 'refine'
                    ? 'O que melhorar?'
                    : 'O que deseja na área marcada?'}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={editMode === 'edit'
                  ? 'Descreva a edição. Ex: mude a cor do vestido para vermelho, mantendo tudo o mais. Use <image1> para a imagem e <image2> para a referência.'
                  : editMode === 'refine'
                    ? 'Descreva o resultado desejado. A imagem de origem é mantida e a força controla quanto muda.'
                    : 'Descreva como a área marcada deve ficar. Ex: adicione flores, mude a cor para azul...'}
                rows={4}
                className="w-full bg-surface rounded-lg border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
                disabled={!originalSrc || generating}
              />
              <p className="text-[10px] text-text-muted mt-1">
                <span className="font-mono">&lt;image1&gt;</span> = imagem principal
                {refSrc && <> · <span className="font-mono">&lt;image2&gt;</span> = referência</>}
                {editMode !== 'edit' && ' · cfg 1 ignora prompt negativo'}
              </p>
            </div>

            {/* Denoise (refine/inpaint) */}
            {editMode !== 'edit' && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-text-secondary">
                    {editMode === 'inpaint' ? 'Força na Área Marcada' : 'Força da Modificação'}
                  </label>
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
                  Imagem melhorada!
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
              onClick={handleImprove}
              disabled={!canGenerate}
              className={`
                w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm
                transition-all duration-200
                ${!canGenerate
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
                  {editMode === 'inpaint' ? 'Aplicar na Área' : editMode === 'refine' ? 'Refinar Imagem' : 'Melhorar Imagem'}
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
