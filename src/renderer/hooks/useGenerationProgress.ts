import { useCallback, useRef, useState } from 'react'

interface GenerationProgress {
  current: number
  max: number
}

export function useGenerationProgress() {
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [eta, setEta] = useState<number | null>(null)
  const startTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  const startProgress = useCallback((): (() => void) => {
    setProgress(null)
    setElapsed(0)
    setEta(null)
    startTimeRef.current = Date.now()

    const unsub = window.electronAPI.comfyui.onProgress((data) => {
      setProgress(data)
      const now = Date.now()
      const elapsedSec = (now - startTimeRef.current) / 1000
      setElapsed(elapsedSec)
      if (data.current > 0) {
        const estimated = (elapsedSec / data.current) * data.max
        setEta(estimated - elapsedSec)
      }
    })

    timerRef.current = setInterval(() => {
      if (startTimeRef.current > 0) {
        setElapsed((Date.now() - startTimeRef.current) / 1000)
      }
    }, 1000)

    return () => {
      unsub()
      clearInterval(timerRef.current)
      setProgress(null)
    }
  }, [])

  return { progress, elapsed, eta, startProgress }
}
