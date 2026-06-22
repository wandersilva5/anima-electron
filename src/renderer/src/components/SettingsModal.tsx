import { useState, useEffect } from 'react'
import { X, FolderOpen, HardDrive, Save } from 'lucide-react'
import type { AppSettings } from '@shared/types'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings>({
    comfyUIPath: '',
    modelsPath: '',
    lorasPath: ''
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      window.electronAPI.settings.get().then(setSettings)
    }
  }, [open])

  if (!open) return null

  const handleSelectDir = async (key: keyof AppSettings) => {
    const path = await window.electronAPI.settings.selectDir()
    if (path) {
      setSettings(prev => ({ ...prev, [key]: path }))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.electronAPI.settings.set(settings)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const fields: { key: keyof AppSettings; label: string; icon: typeof HardDrive; placeholder: string }[] = [
    { key: 'comfyUIPath', label: 'Pasta do ComfyUI', icon: HardDrive, placeholder: 'D:\\ComfyUI_windows_portable' },
    { key: 'modelsPath', label: 'Pasta de Modelos', icon: HardDrive, placeholder: '(derivado do ComfyUI)' },
    { key: 'lorasPath', label: 'Pasta de LoRAs', icon: HardDrive, placeholder: '(derivado do ComfyUI)' }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface-secondary rounded-2xl border border-border shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Configurações</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-tertiary text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {fields.map(({ key, label, icon: Icon, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 bg-surface rounded-lg border border-border px-3 py-2">
                  <Icon size={14} className="text-text-muted shrink-0" />
                  <input
                    type="text"
                    value={settings[key]}
                    onChange={e => setSettings(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="flex-1 bg-transparent text-xs text-text-primary font-mono outline-none placeholder:text-text-muted/50"
                  />
                </div>
                <button
                  onClick={() => handleSelectDir(key)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-tertiary hover:bg-border text-text-secondary hover:text-text-primary text-xs transition-colors"
                  title="Selecionar pasta"
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-xs hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
