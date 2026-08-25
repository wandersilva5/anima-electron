import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { nativeImage } from 'electron'

const THUMB_WIDTH = 256
const JPEG_QUALITY = 72

function thumbnailPath(filePath: string, cacheDir: string): string | null {
  try {
    const stat = statSync(filePath)
    const key = createHash('sha1').update(`${filePath}|${stat.size}|${stat.mtimeMs}`).digest('hex')
    return join(cacheDir, `${key}.jpg`)
  } catch {
    return null
  }
}

export function deleteThumbnail(filePath: string, cacheDir: string): void {
  const thumb = thumbnailPath(filePath, cacheDir)
  if (!thumb) return
  try {
    rmSync(thumb, { force: true })
  } catch { /* cleanup best-effort */ }
}

export function getThumbnailDataUrl(filePath: string, cacheDir: string): string | null {
  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true })
    }
    const cached = thumbnailPath(filePath, cacheDir)
    if (cached && existsSync(cached)) {
      return `data:image/jpeg;base64,${readFileSync(cached).toString('base64')}`
    }

    const img = nativeImage.createFromPath(filePath)
    if (img.isEmpty()) return null
    const { width } = img.getSize()
    const resized = width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH }) : img
    const jpeg = resized.toJPEG(JPEG_QUALITY)
    if (jpeg.length === 0) return null

    if (cached) writeFileSync(cached, jpeg)
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch {
    return null
  }
}
