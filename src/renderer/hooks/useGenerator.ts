import { useState, useCallback, useEffect, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import type { GenerationResult } from '@shared/types'

export function useGenerator() {
  const { params, setGenerating, setProgress, addToHistory, generateTrigger } = useSessionStore()
  const [error, setError] = useState<string | null>(null)
  const lastTriggerRef = useRef(generateTrigger)
  const generatingRef = useRef(false)

  const generate = useCallback(async () => {
    if (generatingRef.current) return
    setError(null)

    if (!params.modelName) {
      setError('Selecione um modelo antes de gerar a imagem.')
      return
    }

    const { models, loras } = useSessionStore.getState()
    if (models.length > 0 && !models.some((m) => m.name === params.modelName)) {
      setError(`Modelo "${params.modelName}" não encontrado. Selecione um modelo disponível.`)
      return
    }

    if (params.loraName && loras.length > 0 && !loras.some((l) => l.name === params.loraName)) {
      setError(`LoRA "${params.loraName}" não encontrado. Selecione um LoRA válido ou remova a seleção.`)
      return
    }

    generatingRef.current = true
    setGenerating(true)
    setProgress(null)

    const {
      setPrompt: _sp, setNegativePrompt: _snp, setSeed: _ss, setSteps: _sst,
      setCfg: _sc, setWidth: _sw, setHeight: _sh, setLora: _sl, setModel: _sm,
      randomizeSeed: _rs,
      ...dataParams
    } = params

    const unsubProgress = window.electronAPI.comfyui.onProgress((data) => {
      setProgress(data)
    })

    try {
      const result = await window.electronAPI.comfyui.generate(dataParams)
      const image = result.images?.[0]
      if (image) {
        const entry: GenerationResult = {
          id: result.promptId,
          imageBase64: `data:image/png;base64,${image.data}`,
          filePath: image.filePath,
          filename: image.filename,
          params: dataParams,
          timestamp: Date.now()
        }
        addToHistory(entry)
        useSessionStore.getState().selectImage(entry.id)
      }
      useSessionStore.getState().params.randomizeSeed()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar imagem')
    } finally {
      unsubProgress()
      generatingRef.current = false
      setProgress(null)
      setGenerating(false)
    }
  }, [params, setGenerating, setProgress, addToHistory])

  useEffect(() => {
    if (generateTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = generateTrigger
      generate()
    }
  }, [generateTrigger, generate])

  return { generate, error }
}
