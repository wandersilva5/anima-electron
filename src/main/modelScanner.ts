import { readdirSync, existsSync } from 'fs'
import { join, sep } from 'path'
import type { ModelInfo } from '@shared/types'
import type { SettingsManager } from './settings'
import { findPreview } from './previewFinder'

export class ModelScanner {
  private settingsManager: SettingsManager

  constructor(settingsManager: SettingsManager) {
    this.settingsManager = settingsManager
  }

  updatePath(settingsManager: SettingsManager): void {
    this.settingsManager = settingsManager
  }

  scan(): ModelInfo[] {
    const baseDir = this.settingsManager.resolvedModelsPath
    const modelDirs: { dir: string; type: ModelInfo['type'] }[] = [
      { dir: 'diffusion_models', type: 'diffusion_models' },
      { dir: 'unet', type: 'unet' }
    ]

    const results: ModelInfo[] = []

    for (const { dir: subdir, type } of modelDirs) {
      const fullPath = join(baseDir, subdir)
      if (!existsSync(fullPath)) continue
      results.push(...this.scanRecursive(fullPath, type, subdir, baseDir))
    }

    return results
  }

  private scanRecursive(dir: string, type: ModelInfo['type'], typeDir: string, baseDir: string): ModelInfo[] {
    const results: ModelInfo[] = []

    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...this.scanRecursive(fullPath, type, typeDir, baseDir))
        } else if (entry.name.endsWith('.safetensors') || entry.name.endsWith('.ckpt') || entry.name.endsWith('.gguf')) {
          const typePath = join(baseDir, typeDir)
          const relative = dir === typePath ? entry.name : join(dir.replace(typePath + sep, ''), entry.name)
          const name = relative
          results.push({
            name,
            path: fullPath,
            type,
            previewUrl: findPreview(entry.name, dir, baseDir)
          })
        }
      }
    } catch {
      // skip directories we can't read
    }

    return results
  }
}
