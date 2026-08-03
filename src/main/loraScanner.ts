import { readdirSync, existsSync } from 'fs'
import { join, sep } from 'path'
import type { LoraInfo } from '@shared/types'
import type { SettingsManager } from './settings'
import { findPreview } from './previewFinder'

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
        const subPrefix = prefix ? `${prefix}${sep}${entry.name}` : entry.name
        results.push(...this.scanRecursive(fullPath, subPrefix, subfolder))
      } else if (entry.name.endsWith('.safetensors') || entry.name.endsWith('.ckpt') || entry.name.endsWith('.gguf')) {
        const relativeName = prefix ? `${prefix}${sep}${entry.name}` : entry.name
        const loraName = subfolder ? `${subfolder}${sep}${relativeName}` : relativeName
        results.push({
          name: loraName,
          path: fullPath,
          previewUrl: findPreview(entry.name, dir, this.settingsManager.resolvedLorasPath)
        })
      }
    }

    return results
  }
}
