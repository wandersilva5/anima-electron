import { useState, useEffect } from 'react'

export function SafeImage({ path, alt, className }: { path?: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!path) { setSrc(null); return }
    let cancelled = false
    window.electronAPI.app.readImage(path).then((data) => {
      if (!cancelled) setSrc(data)
    })
    return () => { cancelled = true }
  }, [path])

  if (!src) {
    return null
  }

  return <img src={src} alt={alt} className={className} />
}
