import { existsSync } from 'fs'
import { join } from 'path'

export function findPreview(
  filename: string,
  dir: string,
  extraBase?: string
): string | undefined {
  const baseName = filename.replace(/\.(safetensors|ckpt|gguf)$/, '')
  const exts = ['.png', '.jpg', '.jpeg', '.webp']
  const paths = [
    ...exts.map(e => join(dir, 'previews', `${baseName}${e}`)),
    ...exts.map(e => join(dir, `${baseName}${e}`))
  ]
  if (extraBase) {
    paths.push(...exts.map(e => join(extraBase, 'previews', `${baseName}${e}`)))
  }
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return undefined
}
