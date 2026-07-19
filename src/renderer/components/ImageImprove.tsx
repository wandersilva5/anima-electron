import { useState, useCallback, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Upload, Wand2, Trash2 } from 'lucide-react'
import { MODEL_PROFILES, MODEL_IDS } from '../../shared/modelProfiles'
import type { DiffusionModelId } from '@shared/types'

export function ImageImprove() {
  const { status } = useSessionStore()

  const [selectedModel, setSelectedModel] = useState<DiffusionModelId>('anima')
  const [prompt, setPrompt] = useState('')
  const [denoise, setDenoise] = useState(0.7)
  const [originalSrc, setOriginalSrc] = useState<string | null>(null)
  const [originalFilePath, setOriginalFilePath] = useState<string | null>(null)
  const [resultSrc, setResultSrc] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setOriginalSrc(e.target?.result as string)
      setResultSrc(null)
      setError(null)
    }
    reader.readAsDataURL(file)
    setOriginalFilePath((file as any).path || file.name)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const clearImage = useCallback(() => {
    setOriginalSrc(null)
    setOriginalFilePath(null)
    setResultSrc(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleImprove = useCallback(async () => {
    if (!originalFilePath || !prompt.trim()) return
    setGenerating(true)
    setError(null)
    setResultSrc(null)

    try {
      const result = await window.electronAPI.comfyui.generateImprove({
        diffusionModel: selectedModel,
        prompt,
        negativePrompt: '',
        seed: Math.floor(Math.random() * 2147483647),
        steps: 20,
        cfg: 5,
        width: 1024,
        height: 1024,
        modelName: '',
        loraName: null,
        loraStrengthModel: 0.5,
        loraStrengthClip: 0.5,
        imagePath: originalFilePath,
        denoise,
        filenamePrefix: 'anima-improve'
      })

      const image = result.images?.[0]
      if (image) {
        setResultSrc(`data:image/png;base64,${image.data}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao melhorar imagem')
    } finally {
      setGenerating(false)
    }
  }, [originalFilePath, prompt, selectedModel, denoise])

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
                src={resultSrc || originalSrc}
                alt="Preview"
                className="w-full h-auto max-h-[60vh] object-contain"
              />
              <div className={`absolute top-3 left-3 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider ${resultSrc ? 'bg-success/90 text-white' : 'bg-surface/80 text-text-secondary backdrop-blur-sm'}`}>
                {resultSrc ? 'Melhorado' : 'Original'}
              </div>
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
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Modelo de Difusão
              </label>
              <div className="grid grid-cols-3 gap-2">
                {MODEL_IDS.map((id) => {
                  const prof = MODEL_PROFILES[id]
                  const isSelected = selectedModel === id
                  return (
                    <button
                      key={id}
                      onClick={() => setSelectedModel(id)}
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
                O que deseja modificar?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Descreva a melhoria desejada. Ex: deixe mais nítido, melhore as cores, adicione detalhes..."
                rows={4}
                className="w-full bg-surface rounded-lg border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
                disabled={!originalSrc || generating}
              />
            </div>

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
                  Melhorar Imagem
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
