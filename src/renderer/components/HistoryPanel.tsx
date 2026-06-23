import { useState, useEffect, useCallback } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import type { GenerationResult } from '@shared/types'
import { Image, Clock, Trash2, X, CheckSquare, Square } from 'lucide-react'

function HistoryItem({
  item,
  selected,
  deleteMode,
  deleteSelected,
  onToggleSelect,
  onSelect,
  onDelete
}: {
  item: GenerationResult
  selected: boolean
  deleteMode: boolean
  deleteSelected: boolean
  onToggleSelect: () => void
  onSelect: () => void
  onDelete: () => void
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(item.imageBase64)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (item.imageBase64) {
      setImgSrc(item.imageBase64)
      setLoaded(true)
    } else if (item.filePath && !loaded) {
      window.electronAPI.file.readImage(item.filePath).then((data) => {
        if (data) {
          setImgSrc(data)
          setLoaded(true)
        }
      })
    }
  }, [item.imageBase64, item.filePath, loaded])

  const handleClick = useCallback(() => {
    if (deleteMode) {
      onToggleSelect()
    } else {
      onSelect()
    }
  }, [deleteMode, onToggleSelect, onSelect])

  return (
    <button
      onClick={handleClick}
      className={`
        relative aspect-[9/16] rounded-lg overflow-hidden
        border-2 transition-all duration-200 group
        ${selected && !deleteMode
          ? 'border-accent ring-1 ring-accent'
          : selected && deleteMode
            ? 'border-error ring-1 ring-error'
            : deleteMode
              ? 'border-border hover:border-text-muted'
              : 'border-transparent hover:border-border'
        }
      `}
    >
      {imgSrc ? (
        <img
          src={imgSrc}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full bg-surface-tertiary flex items-center justify-center">
          <Image size={20} className="text-text-muted opacity-40" />
        </div>
      )}

      {item.params.loraName && (
        <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/80 to-transparent">
          <span className="text-[10px] text-white/80 truncate block">
            LoRA: {item.params.loraName.replace(/\.(safetensors|ckpt)$/, '').slice(0, 20)}
          </span>
        </div>
      )}

      {!deleteMode && (
        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-1 rounded bg-black/60 hover:bg-error/80 text-white/80 hover:text-white transition-colors"
            title="Excluir"
          >
            <Trash2 size={12} />
          </div>
        </div>
      )}

      {deleteMode && (
        <div className="absolute top-1.5 left-1.5">
          <div className={`p-0.5 rounded ${deleteSelected ? 'bg-error text-white' : 'bg-black/50 text-white/60'}`}>
            {deleteSelected ? <CheckSquare size={14} /> : <Square size={14} />}
          </div>
        </div>
      )}

      {selected && !deleteMode && (
        <div className="absolute inset-0 ring-1 ring-accent/30 rounded-lg pointer-events-none" />
      )}
    </button>
  )
}

export function HistoryPanel() {
  const { history, selectedId, selectImage, deleteHistory } = useSessionStore()
  const [deleteMode, setDeleteMode] = useState(false)
  const [deleteIds, setDeleteIds] = useState<Set<string>>(new Set())

  const handleDelete = useCallback(async (items: { id: string; filePath: string | null }[]) => {
    if (items.length === 0) return
    await window.electronAPI.file.deleteHistoryItems(
      items.map(({ id, filePath }) => ({ id, filePath: filePath ?? '' }))
    )
    deleteHistory(items.map((i) => i.id))
  }, [deleteHistory])

  const toggleDelete = useCallback((id: string) => {
    setDeleteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleDeleteSelected = useCallback(async () => {
    if (deleteIds.size === 0) return
    const items = history.filter((h) => deleteIds.has(h.id)).map((h) => ({ id: h.id, filePath: h.filePath }))
    await handleDelete(items)
    setDeleteIds(new Set())
    setDeleteMode(false)
  }, [deleteIds, history, handleDelete])

  const handleIndividualDelete = useCallback(async (id: string, filePath: string | null) => {
    await handleDelete([{ id, filePath }])
  }, [handleDelete])

  const cancelDelete = useCallback(() => {
    setDeleteIds(new Set())
    setDeleteMode(false)
  }, [])

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
        {!deleteMode ? (
          <button
            onClick={() => setDeleteMode(true)}
            className="p-1 rounded hover:bg-surface-tertiary text-text-muted hover:text-error transition-colors"
            title="Selecionar para excluir"
          >
            <Trash2 size={12} />
          </button>
        ) : (
          <button
            onClick={cancelDelete}
            className="p-1 rounded hover:bg-surface-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Cancelar"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {deleteMode && deleteIds.size > 0 && (
        <div className="mb-2">
          <button
            onClick={handleDeleteSelected}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-error/20 text-error hover:bg-error/30 text-xs font-medium transition-colors"
          >
            <Trash2 size={12} />
            Excluir {deleteIds.size} item(ns)
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {history.map((item) => (
          <HistoryItem
            key={item.id}
            item={item}
            selected={deleteMode ? deleteIds.has(item.id) : item.id === selectedId}
            deleteMode={deleteMode}
            deleteSelected={deleteIds.has(item.id)}
            onToggleSelect={() => toggleDelete(item.id)}
            onSelect={() => selectImage(item.id === selectedId ? null : item.id)}
            onDelete={() => handleIndividualDelete(item.id, item.filePath)}
          />
        ))}
      </div>
    </div>
  )
}
