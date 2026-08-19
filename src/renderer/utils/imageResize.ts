import { MODEL_PROFILES } from '@shared/modelProfiles'
import type { DiffusionModelId } from '@shared/types'

const MAX_MODEL_DIM = 1536

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Falha ao carregar a imagem para redimensionamento'))
    img.src = src
  })
}

function targetResolutionForModel(modelId: DiffusionModelId): number {
  const defaults = MODEL_PROFILES[modelId]?.defaults
  if (!defaults) return 1024
  return Math.max(defaults.width, defaults.height)
}

export async function resizeImageForModel(src: string, modelId: DiffusionModelId): Promise<string> {
  const img = await loadImage(src)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const longest = Math.max(w, h)
  const target = targetResolutionForModel(modelId)

  let scale = 1
  if (longest < target) {
    scale = target / longest
  } else if (longest > MAX_MODEL_DIM) {
    scale = MAX_MODEL_DIM / longest
  }
  if (Math.abs(scale - 1) < 0.02) return src

  const nw = Math.max(16, Math.round((w * scale) / 16) * 16)
  const nh = Math.max(16, Math.round((h * scale) / 16) * 16)
  const canvas = document.createElement('canvas')
  canvas.width = nw
  canvas.height = nh
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, nw, nh)
  return canvas.toDataURL('image/png')
}