import { useState, useCallback } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Download, Trash2, ImageOff, Eye, EyeOff } from 'lucide-react'

export function PreviewPanel() {
  const { history, selectedId, selectImage } = useSessionStore()
  const selected = history.find((h) => h.id === selectedId)
  const [blurred, setBlurred] = useState(true)

  const handleDownload = useCallback(() => {
    if (!selected) return
    const link = document.createElement('a')
    link.href = selected.imageBase64
    link.download = selected.filename || `anima-${selected.id}.png`
    link.click()
  }, [selected])

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
    <div className="flex flex-col items-center justify-center w-full h-full p-6">
      <div className="relative max-w-full max-h-full flex flex-col items-center">
        <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-surface-secondary group">
          <img
            src={selected.imageBase64}
            alt="Generated"
            className={`max-w-[85vh] max-h-[70vh] object-contain transition-all duration-300 ${blurred ? 'blur-[40px] scale-105' : ''}`}
          />
          {blurred && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <EyeOff size={32} className="mx-auto mb-2 text-text-muted" />
                <p className="text-sm text-text-muted">Imagem oculta por segurança</p>
                <p className="text-xs text-text-muted/60 mt-1">Clique no olho para revelar</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-4">
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

        <div className="mt-4 p-3 rounded-xl bg-surface-secondary/80 border border-border/50 text-xs w-full max-w-md">
          <div className="font-medium text-text-secondary mb-2">Metadados</div>
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
