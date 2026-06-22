import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AppSettings } from '@shared/types'

const DEFAULTS: AppSettings = {
  comfyUIPath: 'D:\\ComfyUI_windows_portable',
  modelsPath: '',
  lorasPath: ''
}

export class SettingsManager {
  private settings: AppSettings
  private filePath: string

  constructor() {
    const userDataPath = app.getPath('userData')
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }
    this.filePath = join(userDataPath, 'settings.json')
    this.settings = this.load()
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
