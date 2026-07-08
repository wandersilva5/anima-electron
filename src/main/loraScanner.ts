import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { LoraInfo } from '@shared/types'
import type { SettingsManager } from './settings'

export class LoraScanner {
  private settingsManager: SettingsManager

  constructor(settingsManager: SettingsManager) {
    this.settingsManager = settingsManager
  }

  updatePath(settingsManager: SettingsManager): void {
    this.settingsManager = settingsManager
  }

  scan(subfolder?: string): LoraInfo[] {
    const baseLoraDir = this.settingsManager.resolvedLorasPath
    const scanDir = subfolder ? join(baseLoraDir, subfolder) : baseLoraDir
    try {
      if (!existsSync(scanDir)) return []
      return this.scanRecursive(scanDir, '', subfolder || '')
    } catch {
      return []
    }
  }

  private scanRecursive(dir: string, prefix: string, subfolder: string): LoraInfo[] {
    const entries = readdirSync(dir, { withFileTypes: true })
    const results: LoraInfo[] = []

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        const subPrefix = prefix ? `${prefix}\\${entry.name}` : entry.name
        results.push(...this.scanRecursive(fullPath, subPrefix, subfolder))
      } else if (entry.name.endsWith('.safetensors') || entry.name.endsWith('.ckpt')) {
        const relativeName = prefix ? `${prefix}\\${entry.name}` : entry.name
        const loraName = subfolder ? `${subfolder}\\${relativeName}` : relativeName
        results.push({
          name: loraName,
          path: fullPath,
          previewUrl: this.findPreview(entry.name, dir)
        })
      }
    }

    return results
  }

  private findPreview(filename: string, dir: string): string | undefined {
    const baseName = filename.replace(/\.(safetensors|ckpt)$/, '')
    const exts = ['.png', '.jpg', '.jpeg', '.webp']
    const loraDir = this.settingsManager.resolvedLorasPath
    const paths = [
      ...exts.map(e => join(dir, 'previews', `${baseName}${e}`)),
      ...exts.map(e => join(dir, `${baseName}${e}`)),
      ...exts.map(e => join(loraDir, 'previews', `${baseName}${e}`))
    ]
    for (const p of paths) {
      if (existsSync(p)) return p
    }
    return undefined
  }
}
