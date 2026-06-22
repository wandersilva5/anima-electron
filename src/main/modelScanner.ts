import { readdirSync, existsSync } from 'fs'
import { join, sep } from 'path'
import type { ModelInfo } from '@shared/types'
import type { SettingsManager } from './settings'

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

    return results.filter(m => this.isAnimaModel(m.name))
  }

  private isAnimaModel(name: string): boolean {
    return /(?:^|[\\/])anima(?=$|[\\/])/i.test(name)
  }

  private scanRecursive(dir: string, type: ModelInfo['type'], typeDir: string, baseDir: string): ModelInfo[] {
    const results: ModelInfo[] = []

    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...this.scanRecursive(fullPath, type, typeDir, baseDir))
        } else if (entry.name.endsWith('.safetensors') || entry.name.endsWith('.ckpt')) {
          const typePath = join(baseDir, typeDir)
          const relative = dir === typePath ? entry.name : join(dir.replace(typePath + sep, ''), entry.name)
          const name = relative
          results.push({
            name,
            path: fullPath,
            type,
            previewUrl: this.findPreview(entry.name, dir, baseDir)
          })
        }
      }
    } catch {
      // skip directories we can't read
    }

    return results
  }

  private findPreview(filename: string, dir: string, baseDir: string): string | undefined {
    const baseName = filename.replace(/\.(safetensors|ckpt)$/, '')
    const exts = ['.png', '.jpg', '.jpeg', '.webp']
    const paths = [
      ...exts.map(e => join(dir, 'previews', `${baseName}${e}`)),
      ...exts.map(e => join(dir, `${baseName}${e}`)),
      ...exts.map(e => join(baseDir, 'previews', `${baseName}${e}`))
    ]
    for (const p of paths) {
      if (existsSync(p)) return p
    }
    return undefined
  }
}
