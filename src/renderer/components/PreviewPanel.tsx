import { useState, useCallback, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Download, Trash2, ImageOff, Eye, EyeOff } from 'lucide-react'

export function PreviewPanel() {
  const { history, selectedId, selectImage } = useSessionStore()
  const selected = history.find((h) => h.id === selectedId)
  const [blurred, setBlurred] = useState(true)
  const [imgSrc, setImgSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!selected) { setImgSrc(null); return }
    if (selected.imageBase64) {
      setImgSrc(selected.imageBase64)
    } else if (selected.filePath) {
      window.electronAPI.file.readImage(selected.filePath).then(setImgSrc)
    }
  }, [selected])

  const handleDownload = useCallback(() => {
    if (!selected || !imgSrc) return
    const link = document.createElement('a')
    link.href = imgSrc
    link.download = selected.filename || `anima-${selected.id}.png`
    link.click()
  }, [selected, imgSrc])

  if (!selected) {
    return (
      <div className="flex flex-col items-center justify-center text-text-muted p-8">
        <ImageOff size={48} className="mb-3 opacity-30" />
        <span className="text-sm font-medium">Selecione uma imagem</span>
        <span className="text-xs mt-1">Clique em uma imagem no histórico para visualizar</span>
      </div>
    )
  }

  const loadMetadata = (item: typeof selected) => [
    { label: 'Modelo', value: item.params.modelName.replace(/\.(safetensors|ckpt)$/, '').split('/').pop() ?? item.params.modelName },
    { label: 'Seed', value: item.params.seed },
    { label: 'Steps', value: item.params.steps },
    { label: 'CFG', value: item.params.cfg },
    { label: 'Resolução', value: `${item.params.width}×${item.params.height}` },
    ...(item.params.loraName
      ? [
          { label: 'LoRA', value: item.params.loraName.replace(/\.(safetensors|ckpt)$/, '').split('/').pop() ?? item.params.loraName },
          { label: 'LoRA Model', value: item.params.loraStrengthModel.toFixed(2) },
          { label: 'LoRA CLIP', value: item.params.loraStrengthClip.toFixed(2) }
        ]
      : [])
  ]

  return (
    <div className="flex w-full h-full p-6 gap-6 overflow-hidden">
      <div className="flex-1 flex items-center justify-center h-full min-w-0 overflow-hidden">
        <div className="relative h-full flex items-center justify-center rounded-2xl overflow-hidden shadow-2xl bg-surface-secondary group" style={{ aspectRatio: `${selected.params.width}/${selected.params.height}`, maxHeight: '100%' }}>
          <img
            src={imgSrc ?? ''}
            alt="Generated"
            className={`absolute inset-0 w-full h-full object-contain transition-all duration-300 ${blurred ? 'blur-[40px] scale-105' : ''}`}
          />
          {blurred && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="text-center">
                <EyeOff size={32} className="mx-auto mb-2 text-text-muted" />
                <p className="text-sm text-text-muted">Imagem oculta por segurança</p>
                <p className="text-xs text-text-muted/60 mt-1">Clique no olho para revelar</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setBlurred(!blurred)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-tertiary hover:bg-border text-text-secondary hover:text-text-primary text-xs transition-colors"
            title={blurred ? 'Revelar imagem' : 'Ocultar imagem'}
          >
            {blurred ? <Eye size={14} /> : <EyeOff size={14} />}
            {blurred ? 'Revelar' : 'Ocultar'}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-tertiary hover:bg-border text-text-secondary hover:text-text-primary text-xs transition-colors"
          >
            <Download size={14} />
            Download
          </button>
          <button
            onClick={() => selectImage(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-tertiary hover:bg-border text-text-secondary hover:text-text-primary text-xs transition-colors"
          >
            <Trash2 size={14} />
            Limpar
          </button>
        </div>

        <div className="p-3 rounded-xl bg-surface-secondary/80 border border-border/50 text-xs space-y-3">
          <div className="font-medium text-text-secondary">Metadados</div>

          <div>
            <span className="text-text-muted">Prompt</span>
            <p className="text-text-primary mt-0.5 leading-relaxed break-words">{selected.params.prompt}</p>
          </div>

          {selected.params.negativePrompt && (
            <div>
              <span className="text-text-muted">Prompt Negativo</span>
              <p className="text-text-primary mt-0.5 leading-relaxed break-words">{selected.params.negativePrompt}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {loadMetadata(selected).map((m) => (
              <div key={m.label} className="flex justify-between">
                <span className="text-text-muted">{m.label}</span>
                <span className="text-text-primary font-mono">{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
