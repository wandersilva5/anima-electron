import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'

export interface BrushCanvasHandle {
  getMaskBase64: () => string | null
  clearMask: () => void
  setBrushSize: (size: number) => void
  setIsErasing: (erasing: boolean) => void
}

interface BrushCanvasProps {
  imageSrc: string
  imageWidth: number
  imageHeight: number
  visible: boolean
}

export const BrushCanvas = forwardRef<BrushCanvasHandle, BrushCanvasProps>(
  ({ imageSrc, imageWidth, imageHeight, visible }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const maskCanvasRef = useRef<HTMLCanvasElement>(null)
    const [brushSize, setBrushSize] = useState(30)
    const [isErasing, setIsErasing] = useState(false)
    const isDrawingRef = useRef(false)
    const lastPosRef = useRef<{ x: number; y: number } | null>(null)

    useImperativeHandle(ref, () => ({
      getMaskBase64: () => {
        const maskCanvas = maskCanvasRef.current
        if (!maskCanvas) return null
        const ctx = maskCanvas.getContext('2d')
        if (!ctx) return null
        const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
        const hasPixels = imageData.data.some((v, i) => i % 4 === 3 && v > 0)
        if (!hasPixels) return null

        const exportCanvas = document.createElement('canvas')
        exportCanvas.width = maskCanvas.width
        exportCanvas.height = maskCanvas.height
        const exportCtx = exportCanvas.getContext('2d')
        if (!exportCtx) return null

        exportCtx.fillStyle = '#000000'
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
        exportCtx.drawImage(maskCanvas, 0, 0)

        const exportData = exportCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height)
        for (let i = 0; i < exportData.data.length; i += 4) {
          if (exportData.data[i + 3] > 0) {
            exportData.data[i] = 255
            exportData.data[i + 1] = 255
            exportData.data[i + 2] = 255
            exportData.data[i + 3] = 255
          }
        }
        exportCtx.putImageData(exportData, 0, 0)

        return exportCanvas.toDataURL('image/png')
      },
      clearMask: () => {
        const maskCanvas = maskCanvasRef.current
        if (!maskCanvas) return
        const ctx = maskCanvas.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
        renderOverlay()
      },
      setBrushSize,
      setIsErasing,
    }))

    const renderOverlay = useCallback(() => {
      const canvas = canvasRef.current
      const maskCanvas = maskCanvasRef.current
      if (!canvas || !maskCanvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height)
      ctx.globalCompositeOperation = 'source-over'

      ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height)
    }, [])

    useEffect(() => {
      const canvas = canvasRef.current
      const maskCanvas = maskCanvasRef.current
      if (!canvas || !maskCanvas) return

      canvas.width = imageWidth
      canvas.height = imageHeight
      maskCanvas.width = imageWidth
      maskCanvas.height = imageHeight

      const maskCtx = maskCanvas.getContext('2d')
      if (maskCtx) {
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
      }

      renderOverlay()
    }, [imageSrc, imageWidth, imageHeight, renderOverlay])

    const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      }
    }, [])

    const drawBrushStroke = useCallback((x: number, y: number) => {
      const maskCanvas = maskCanvasRef.current
      if (!maskCanvas) return
      const ctx = maskCanvas.getContext('2d')
      if (!ctx) return

      const radius = brushSize / 2

      if (isErasing) {
        ctx.globalCompositeOperation = 'destination-out'
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
        gradient.addColorStop(0, 'rgba(0,0,0,1)')
        gradient.addColorStop(0.6, 'rgba(0,0,0,0.8)')
        gradient.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalCompositeOperation = 'source-over'
      } else {
        ctx.globalCompositeOperation = 'source-over'
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
        gradient.addColorStop(0, 'rgba(255, 50, 50, 0.95)')
        gradient.addColorStop(0.5, 'rgba(255, 50, 50, 0.7)')
        gradient.addColorStop(1, 'rgba(255, 50, 50, 0)')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }

      if (lastPosRef.current) {
        ctx.lineWidth = brushSize
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        if (isErasing) {
          ctx.globalCompositeOperation = 'destination-out'
          ctx.strokeStyle = 'rgba(0,0,0,1)'
        } else {
          ctx.globalCompositeOperation = 'source-over'
          ctx.strokeStyle = 'rgba(255, 50, 50, 0.9)'
        }

        ctx.beginPath()
        ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
        ctx.lineTo(x, y)
        ctx.stroke()
        ctx.globalCompositeOperation = 'source-over'
      }

      lastPosRef.current = { x, y }
      renderOverlay()
    }, [brushSize, isErasing, renderOverlay])

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      isDrawingRef.current = true
      const coords = getCanvasCoords(e)
      if (coords) drawBrushStroke(coords.x, coords.y)
    }, [getCanvasCoords, drawBrushStroke])

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return
      const coords = getCanvasCoords(e)
      if (coords) drawBrushStroke(coords.x, coords.y)
    }, [getCanvasCoords, drawBrushStroke])

    const handleMouseUp = useCallback(() => {
      isDrawingRef.current = false
      lastPosRef.current = null
    }, [])

    const handleMouseLeave = useCallback(() => {
      isDrawingRef.current = false
      lastPosRef.current = null
    }, [])

    const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      isDrawingRef.current = true
      const touch = e.touches[0]
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = (touch.clientX - rect.left) * (canvas.width / rect.width)
      const y = (touch.clientY - rect.top) * (canvas.height / rect.height)
      drawBrushStroke(x, y)
    }, [drawBrushStroke])

    const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      if (!isDrawingRef.current) return
      const touch = e.touches[0]
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = (touch.clientX - rect.left) * (canvas.width / rect.width)
      const y = (touch.clientY - rect.top) * (canvas.height / rect.height)
      drawBrushStroke(x, y)
    }, [drawBrushStroke])

    if (!visible) return null

    return (
      <div className="absolute inset-0 z-10">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          style={{ touchAction: 'none' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUp}
        />
        <canvas ref={maskCanvasRef} className="hidden" />
      </div>
    )
  }
)

BrushCanvas.displayName = 'BrushCanvas'
