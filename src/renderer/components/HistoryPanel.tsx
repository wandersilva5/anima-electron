import { useSessionStore } from '../stores/sessionStore'
import { Image, Clock } from 'lucide-react'

export function HistoryPanel() {
  const { history, selectedId, selectImage } = useSessionStore()

  if (history.length === 0) {
    return (
      <div className="p-4">
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
          Histórico
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-text-muted">
          <Image size={32} className="mb-2 opacity-40" />
          <span className="text-sm">Nenhuma imagem gerada</span>
          <span className="text-xs mt-1">Suas criações aparecerão aqui</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock size={14} className="text-text-muted" />
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          Histórico
        </span>
        <span className="text-xs text-text-muted ml-auto">{history.length}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {history.map((item) => (
          <button
            key={item.id}
            onClick={() => selectImage(item.id === selectedId ? null : item.id)}
            className={`
              relative aspect-[9/16] rounded-lg overflow-hidden
              border-2 transition-all duration-200 group
              ${item.id === selectedId
                ? 'border-accent ring-1 ring-accent'
                : 'border-transparent hover:border-border'
              }
            `}
          >
            <img
              src={item.imageBase64}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />

            {item.params.loraName && (
              <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/80 to-transparent">
                <span className="text-[10px] text-white/80 truncate block">
                  LoRA: {item.params.loraName.replace(/\.(safetensors|ckpt)$/, '').slice(0, 20)}
                </span>
              </div>
            )}

            {item.id === selectedId && (
              <div className="absolute inset-0 ring-1 ring-accent/30 rounded-lg pointer-events-none" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
