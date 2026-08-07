import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { app } from 'electron'
import type { AppSettings } from '@shared/types'

const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'

function getProjectDataDir(): string {
  const projectRoot = resolve(dirname(__dirname), '..')
  return join(projectRoot, 'data')
}

function detectComfyUIPath(): string {
  const candidates = [
    join(process.env.LOCALAPPDATA || '', 'ComfyUI_windows_portable'),
    'C:\\ComfyUI_windows_portable',
    'D:\\ComfyUI_windows_portable',
    join(process.env.USERPROFILE || '', 'ComfyUI_windows_portable')
  ]
  for (const p of candidates) {
    if (existsSync(join(p, 'ComfyUI'))) return p
  }
  return ''
}

const DEFAULTS: AppSettings = {
  comfyUIPath: detectComfyUIPath(),
  modelsPath: '',
  lorasPath: '',
  comfyUrl: DEFAULT_COMFY_URL
}

export class SettingsManager {
  private settings: AppSettings
  private filePath: string

  constructor() {
    const dataDir = app.getPath('userData')
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }
    this.filePath = join(dataDir, 'settings.json')
    this.migrateLegacySettings()
    this.settings = this.load()
  }

  // Migração única: versões antigas gravavam em {projeto}/data/settings.json
  private migrateLegacySettings(): void {
    try {
      if (existsSync(this.filePath)) return
      const legacyPath = join(getProjectDataDir(), 'settings.json')
      if (!existsSync(legacyPath)) return
      copyFileSync(legacyPath, this.filePath)
      console.log('[Settings] Configurações antigas migradas para:', this.filePath)
    } catch (err) {
      console.warn('[Settings] Falha ao migrar configurações antigas:', err)
    }
  }

  private load(): AppSettings {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        return { ...DEFAULTS, ...JSON.parse(raw) }
      }
    } catch {
      // fallback to defaults
    }
    return { ...DEFAULTS }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Settings] Failed to save:', err)
    }
  }

  get(): AppSettings {
    return { ...this.settings }
  }

  set(partial: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...partial }
    this.save()
    return this.get()
  }

  get resolvedModelsPath(): string {
    return this.settings.modelsPath || join(this.settings.comfyUIPath, 'ComfyUI', 'models')
  }

  get resolvedLorasPath(): string {
    return this.settings.lorasPath || join(this.settings.comfyUIPath, 'ComfyUI', 'models', 'loras')
  }
}
