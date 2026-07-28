import { useState, useCallback, useRef, useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { Wand2, RefreshCw, Check, ChevronDown, ChevronUp, RotateCcw, Download, Play } from 'lucide-react'
import { MODEL_PROFILES, MODEL_IDS } from '../../shared/modelProfiles'
import type { DiffusionModelId, GenerationResult } from '@shared/types'
import { SafeImage } from './SafeImage'

// Canvas configuration (VNCCS standard)
const CANVAS_WIDTH = 512
const CANVAS_HEIGHT = 1536

// Default skeleton joints for OpenPose (VNCCS format - from skeleton_512x1536.py)
const DEFAULT_SKELETON: Record<string, [number, number]> = {
  nose: [256, 200],
  neck: [256, 280],
  r_shoulder: [320, 320],
  r_elbow: [350, 520],
  r_wrist: [360, 720],
  l_shoulder: [192, 320],
  l_elbow: [162, 520],
  l_wrist: [152, 720],
  r_hip: [290, 720],
  r_knee: [295, 1020],
  r_ankle: [300, 1320],
  l_hip: [222, 720],
  l_knee: [217, 1020],
  l_ankle: [212, 1320],
  r_eye: [270, 185],
  l_eye: [242, 185],
  r_ear: [285, 195],
  l_ear: [227, 195],
}

// OpenPose standard color palette (18 colors)
const OPENPOSE_COLORS = [
  [255, 0, 0],      // 0: Red
  [255, 85, 0],     // 1: Orange
  [255, 170, 0],    // 2: Dark orange
  [255, 255, 0],    // 3: Yellow
  [170, 255, 0],    // 4: Yellow-green
  [85, 255, 0],     // 5: Light green
  [0, 255, 0],      // 6: Green
  [0, 255, 85],     // 7: Green-cyan
  [0, 255, 170],    // 8: Cyan-green
  [0, 255, 255],    // 9: Cyan
  [0, 170, 255],    // 10: Cyan-blue
  [0, 85, 255],     // 11: Light blue
  [0, 0, 255],      // 12: Blue
  [85, 0, 255],     // 13: Purple-blue
  [170, 0, 255],    // 14: Purple
  [255, 0, 255],    // 15: Magenta
  [255, 0, 170],    // 16: Pink
  [255, 0, 85],     // 17: Hot pink
]

// Bone connections (VNCCS format)
const BONE_CONNECTIONS: [string, string][] = [
  ["nose", "neck"],
  ["neck", "r_shoulder"],
  ["r_shoulder", "r_elbow"],
  ["r_elbow", "r_wrist"],
  ["neck", "l_shoulder"],
  ["l_shoulder", "l_elbow"],
  ["l_elbow", "l_wrist"],
  ["neck", "r_hip"],
  ["neck", "l_hip"],
  ["r_hip", "r_knee"],
  ["r_knee", "r_ankle"],
  ["l_hip", "l_knee"],
  ["l_knee", "l_ankle"],
  ["nose", "r_eye"],
  ["r_eye", "r_ear"],
  ["nose", "l_eye"],
  ["l_eye", "l_ear"],
]

// Bone color palette (matching VNCCS bone_colors.py)
const BONE_COLOR_PALETTE = [
  OPENPOSE_COLORS[12],  // 0: nose->neck (Blue)
  OPENPOSE_COLORS[0],   // 1: neck->r_shoulder (Red)
  OPENPOSE_COLORS[2],   // 2: r_shoulder->r_elbow (Dark orange)
  OPENPOSE_COLORS[3],   // 3: r_elbow->r_wrist (Yellow)
  OPENPOSE_COLORS[2],   // 4: neck->l_shoulder (orange)
  OPENPOSE_COLORS[6],   // 5: l_shoulder->l_elbow (Green)
  OPENPOSE_COLORS[7],   // 6: l_elbow->l_wrist (Green-cyan)
  OPENPOSE_COLORS[6],   // 7: neck->r_hip (Green)
  OPENPOSE_COLORS[8],   // 8: neck->l_hip (Cyan)
  OPENPOSE_COLORS[5],   // 9: r_hip->r_knee (Light green)
  [2, 153, 102],        // 10: r_knee->r_ankle (Teal)
  OPENPOSE_COLORS[9],   // 11: l_hip->l_knee (Cyan)
  OPENPOSE_COLORS[12],  // 12: l_knee->l_ankle (Blue)
  OPENPOSE_COLORS[14],  // 13: nose->r_eye (Purple)
  OPENPOSE_COLORS[16],  // 14: r_eye->r_ear (Pink)
  OPENPOSE_COLORS[14],  // 15: nose->l_eye (Purple)
  OPENPOSE_COLORS[16],  // 16: l_eye->l_ear (Pink)
]

// Pose presets - using actual VNCCS preset positions from vnccs_poseset.json
const POSE_PRESETS: Record<string, Record<string, [number, number]>> = {
  // Default standing pose (from VNCCS skeleton_512x1536.py)
  standing: {
    ...DEFAULT_SKELETON,
  },
  // Pose 1 from vnccs_poseset.json
  pose1: {
    nose: [141.59, 250.41],
    neck: [244.51, 392.37],
    r_shoulder: [169.98, 390.00],
    r_elbow: [132.12, 593.48],
    r_wrist: [82.44, 742.54],
    l_shoulder: [319.04, 394.73],
    l_elbow: [368.72, 595.84],
    l_wrist: [406.58, 768.56],
    r_hip: [177.08, 744.90],
    r_knee: [179.44, 1073.78],
    r_ankle: [172.34, 1407.38],
    l_hip: [290.64, 740.17],
    l_knee: [321.40, 1069.04],
    l_ankle: [390.02, 1397.92],
    r_eye: [134.49, 224.38],
    l_eye: [167.61, 217.28],
    r_ear: [158.15, 238.58],
    l_ear: [257.52, 224.38],
  },
  // Pose 2 from vnccs_poseset.json
  pose2: {
    nose: [265.14, 255.83],
    neck: [260.54, 404.14],
    r_shoulder: [168.57, 405.29],
    r_elbow: [122.58, 577.74],
    r_wrist: [161.67, 697.30],
    l_shoulder: [352.51, 402.99],
    l_elbow: [398.50, 566.24],
    l_wrist: [380.10, 692.70],
    r_hip: [205.35, 773.18],
    r_knee: [214.55, 1067.49],
    r_ankle: [196.16, 1398.59],
    l_hip: [336.42, 766.28],
    l_knee: [324.92, 1067.49],
    l_ankle: [320.32, 1396.29],
    r_eye: [239.84, 235.14],
    l_eye: [290.43, 235.14],
    r_ear: [198.46, 253.53],
    l_ear: [322.62, 251.23],
  },
  // Pose 3 from vnccs_poseset.json
  pose3: {
    nose: [266.58, 245.92],
    neck: [268.89, 401.76],
    r_shoulder: [178.85, 407.53],
    r_elbow: [139.60, 580.68],
    r_wrist: [188.09, 580.68],
    l_shoulder: [358.93, 395.98],
    l_elbow: [405.11, 566.83],
    l_wrist: [361.24, 569.14],
    r_hip: [213.48, 742.29],
    r_knee: [218.10, 1058.59],
    r_ankle: [158.07, 1395.66],
    l_hip: [345.08, 737.68],
    l_knee: [342.77, 1051.66],
    l_ankle: [342.77, 1381.81],
    r_eye: [238.88, 229.76],
    l_eye: [289.67, 225.14],
    r_ear: [201.94, 255.15],
    l_ear: [324.30, 248.23],
  },
  // Pose 4 from vnccs_poseset.json
  pose4: {
    nose: [307.27, 251.74],
    neck: [293.14, 404.78],
    r_shoulder: [203.67, 404.78],
    r_elbow: [161.29, 583.71],
    r_wrist: [166.00, 727.33],
    l_shoulder: [382.61, 404.78],
    l_elbow: [422.64, 569.59],
    l_wrist: [394.38, 687.31],
    r_hip: [224.86, 772.07],
    r_knee: [229.57, 1078.15],
    r_ankle: [130.69, 1379.52],
    l_hip: [352.00, 767.36],
    l_knee: [328.46, 1078.15],
    l_ankle: [302.56, 1391.29],
    r_eye: [279.02, 228.19],
    l_eye: [330.81, 230.55],
    r_ear: [236.64, 249.38],
    l_ear: [363.77, 251.74],
  },
  // Pose 5 from vnccs_poseset.json
  pose5: {
    nose: [370.78, 250.45],
    neck: [277.09, 377.78],
    r_shoulder: [257.87, 370.57],
    r_elbow: [236.24, 565.18],
    r_wrist: [329.94, 704.52],
    l_shoulder: [296.31, 384.99],
    l_elbow: [298.71, 586.80],
    l_wrist: [334.74, 711.73],
    r_hip: [231.44, 738.15],
    r_knee: [257.87, 1072.10],
    r_ankle: [209.82, 1406.04],
    l_hip: [262.67, 738.15],
    l_knee: [289.10, 1067.29],
    l_ankle: [180.99, 1386.82],
    r_eye: [349.16, 219.22],
    l_eye: [370.78, 221.62],
    r_ear: [274.68, 226.43],
    l_ear: [325.13, 228.83],
  },
  // Pose 6 from vnccs_poseset.json
  pose6: {
    nose: [268.54, 240.92],
    neck: [265.05, 395.99],
    r_shoulder: [177.60, 394.83],
    r_elbow: [142.62, 562.72],
    r_wrist: [93.65, 709.63],
    l_shoulder: [352.49, 397.16],
    l_elbow: [394.47, 565.05],
    l_wrist: [445.77, 718.96],
    r_hip: [191.59, 737.62],
    r_knee: [198.59, 1045.43],
    r_ankle: [189.26, 1364.90],
    l_hip: [324.51, 737.62],
    l_knee: [317.51, 1043.10],
    l_ankle: [315.18, 1348.58],
    r_eye: [242.89, 217.60],
    l_eye: [298.86, 219.93],
    r_ear: [203.25, 243.25],
    l_ear: [336.20, 245.58],
  },
}

export function PoseStudio() {
  const { status, loras, models, refreshLoras, addToHistory } = useSessionStore()

  const [selectedModel, setSelectedModel] = useState<DiffusionModelId>('anima')
  const [selectedCheckpoint, setSelectedCheckpoint] = useState('')
  const [selectedLora, setSelectedLora] = useState<string | null>(null)
  const [loraStrengthModel, setLoraStrengthModel] = useState(0.5)
  const [loraStrengthClip, setLoraStrengthClip] = useState(0.5)
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [resultSrc, setResultSrc] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lorasOpen, setLorasOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [loraSearch, setLoraSearch] = useState('')
  const [refreshingLoras, setRefreshingLoras] = useState(false)
  const [lorasRefreshed, setLorasRefreshed] = useState(false)
  const loraRefreshTimer = useRef<ReturnType<typeof setTimeout>>()

  // Pose state
  const [currentPreset, setCurrentPreset] = useState('standing')
  const [joints, setJoints] = useState<Record<string, [number, number]>>({ ...DEFAULT_SKELETON })
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null)
  const [canvasScale, setCanvasScale] = useState(0.4)
  const [lineThickness, setLineThickness] = useState(3)
  const [safeZone, setSafeZone] = useState(100)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const profile = MODEL_PROFILES[selectedModel]

  const filteredModels = models.filter((model) => {
    const name = model.name.toLowerCase()
    if (selectedModel === 'anima') return name.includes('anima')
    if (selectedModel === 'krea2') return name.includes('krea') || name.includes('krea2')
    if (selectedModel === 'z-image') return name.includes('z-image') || name.includes('z_image')
    return true
  })

  const filteredLoras = loras.filter((lora) =>
    lora.name.toLowerCase().includes(loraSearch.toLowerCase())
  )

  useEffect(() => {
    if (filteredModels.length > 0 && !filteredModels.some(m => m.name === selectedCheckpoint)) {
      setSelectedCheckpoint(filteredModels[0].name)
    }
  }, [filteredModels, selectedCheckpoint])

  const handleRefreshLoras = useCallback(async () => {
    if (refreshingLoras) return
    setRefreshingLoras(true)
    try {
      await refreshLoras()
      setLorasRefreshed(true)
      clearTimeout(loraRefreshTimer.current)
      loraRefreshTimer.current = setTimeout(() => setLorasRefreshed(false), 1500)
    } finally {
      setRefreshingLoras(false)
    }
  }, [refreshLoras, refreshingLoras])

  // Apply preset
  const applyPreset = useCallback((presetName: string) => {
    setCurrentPreset(presetName)
    const preset = POSE_PRESETS[presetName]
    if (preset) {
      setJoints({ ...preset })
    }
  }, [])

  // Reset to default
  const resetPose = useCallback(() => {
    setJoints({ ...DEFAULT_SKELETON })
    setCurrentPreset('standing')
    setSelectedJoint(null)
  }, [])

  // Draw pose on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const displayWidth = CANVAS_WIDTH * canvasScale
    const displayHeight = CANVAS_HEIGHT * canvasScale

    canvas.width = displayWidth
    canvas.height = displayHeight

    // Clear canvas
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, displayWidth, displayHeight)

    // Draw grid
    ctx.strokeStyle = '#2a2a4e'
    ctx.lineWidth = 1
    const gridSize = 50 * canvasScale
    for (let x = 0; x < displayWidth; x += gridSize) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, displayHeight)
      ctx.stroke()
    }
    for (let y = 0; y < displayHeight; y += gridSize) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(displayWidth, y)
      ctx.stroke()
    }

    // Scale joints to display size
    const scaleJoint = (pos: [number, number]): [number, number] => [
      pos[0] * canvasScale,
      pos[1] * canvasScale,
    ]

    // Draw bones with OpenPose colors
    ctx.lineCap = 'round'

    for (let i = 0; i < BONE_CONNECTIONS.length; i++) {
      const [jointA, jointB] = BONE_CONNECTIONS[i]
      const posA = joints[jointA]
      const posB = joints[jointB]
      if (posA && posB) {
        const [ax, ay] = scaleJoint(posA)
        const [bx, by] = scaleJoint(posB)
        const color = BONE_COLOR_PALETTE[i]
        ctx.strokeStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`
        ctx.lineWidth = lineThickness * canvasScale
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }
    }

    // Draw joints
    const jointRadius = 6 * canvasScale
    for (const [name, pos] of Object.entries(joints)) {
      const [x, y] = scaleJoint(pos)
      const isSelected = name === selectedJoint

      ctx.beginPath()
      ctx.arc(x, y, jointRadius, 0, Math.PI * 2)
      ctx.fillStyle = isSelected ? '#ff6b6b' : '#00d4ff'
      ctx.fill()
      ctx.strokeStyle = isSelected ? '#ff0000' : '#0088aa'
      ctx.lineWidth = 2 * canvasScale
      ctx.stroke()

      // Draw joint name
      if (isSelected || canvasScale > 0.5) {
        ctx.fillStyle = '#ffffff'
        ctx.font = `${10 * canvasScale}px monospace`
        ctx.fillText(name, x + jointRadius + 4, y + 4)
      }
    }
  }, [joints, selectedJoint, canvasScale, lineThickness])

  // Handle canvas click to select/move joint
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / canvasScale
    const y = (e.clientY - rect.top) / canvasScale

    // Find closest joint
    let closestJoint: string | null = null
    let closestDist = Infinity

    for (const [name, pos] of Object.entries(joints)) {
      const dist = Math.sqrt((pos[0] - x) ** 2 + (pos[1] - y) ** 2)
      if (dist < closestDist && dist < 50) {
        closestDist = dist
        closestJoint = name
      }
    }

    if (closestJoint) {
      if (selectedJoint === closestJoint) {
        // Move joint to click position
        setJoints(prev => ({
          ...prev,
          [closestJoint!]: [Math.round(x), Math.round(y)]
        }))
      } else {
        setSelectedJoint(closestJoint)
      }
    } else {
      setSelectedJoint(null)
    }
  }, [joints, selectedJoint, canvasScale])

  // Handle joint dragging
  const handleCanvasDrag = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedJoint || !e.buttons) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(CANVAS_WIDTH, Math.round((e.clientX - rect.left) / canvasScale)))
    const y = Math.max(0, Math.min(CANVAS_HEIGHT, Math.round((e.clientY - rect.top) / canvasScale)))

    setJoints(prev => ({
      ...prev,
      [selectedJoint]: [x, y]
    }))
  }, [selectedJoint, canvasScale])

  // Export pose data as JSON (VNCCS format)
  const exportPose = useCallback(() => {
    const poseData = {
      canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      poses: [{ joints }]
    }
    const blob = new Blob([JSON.stringify(poseData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pose-${currentPreset}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [joints, currentPreset])

  // Generate image with pose
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return
    setGenerating(true)
    setError(null)
    setResultSrc(null)

    try {
      // Build pose data for VNCCS
      const poseData = {
        canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        poses: [{ joints }]
      }

      const result = await window.electronAPI.comfyui.generate({
        diffusionModel: selectedModel,
        prompt,
        negativePrompt,
        seed: Math.floor(Math.random() * 2147483647),
        steps: profile.defaults.steps,
        cfg: profile.defaults.cfg,
        width: profile.defaults.width,
        height: profile.defaults.height,
        modelName: selectedCheckpoint,
        loraName: selectedLora,
        loraStrengthModel,
        loraStrengthClip,
        filenamePrefix: 'anima-pose',
        poseData: JSON.stringify(poseData),
        lineThickness,
        safeZone,
      } as any)

      const image = result.images?.[0]
      if (image) {
        const src = `data:image/png;base64,${image.data}`
        setResultSrc(src)
        const entry: GenerationResult = {
          id: result.promptId,
          imageBase64: src,
          filePath: image.filePath,
          filename: image.filename,
          params: {
            diffusionModel: selectedModel,
            prompt,
            negativePrompt,
            seed: Math.floor(Math.random() * 2147483647),
            steps: profile.defaults.steps,
            cfg: profile.defaults.cfg,
            width: profile.defaults.width,
            height: profile.defaults.height,
            modelName: selectedCheckpoint,
            loraName: selectedLora,
            loraStrengthModel,
            loraStrengthClip,
          },
          timestamp: Date.now()
        }
        addToHistory(entry)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar com pose')
    } finally {
      setGenerating(false)
    }
  }, [prompt, negativePrompt, selectedModel, selectedCheckpoint, selectedLora, loraStrengthModel, loraStrengthClip, joints, profile, lineThickness, safeZone, addToHistory])

  return (
    <div className="flex-1 flex gap-0 overflow-hidden">
      {/* Canvas area */}
      <main className="flex-1 flex flex-col items-center justify-center bg-surface overflow-hidden min-w-0 p-4">
        <div className="w-full max-w-4xl flex flex-col items-center gap-4">
          {/* Pose presets */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
            {Object.keys(POSE_PRESETS).map((preset) => (
              <button
                key={preset}
                onClick={() => applyPreset(preset)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  currentPreset === preset
                    ? 'bg-accent text-white shadow-lg shadow-accent/20'
                    : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary hover:text-text-primary'
                }`}
              >
                {preset.charAt(0).toUpperCase() + preset.slice(1)}
              </button>
            ))}
            <div className="w-px h-6 bg-border mx-1" />
            <button
              onClick={resetPose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-secondary text-text-secondary hover:bg-surface-tertiary hover:text-text-primary transition-all flex items-center gap-1.5"
            >
              <RotateCcw size={12} />
              Resetar
            </button>
            <button
              onClick={exportPose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-secondary text-text-secondary hover:bg-surface-tertiary hover:text-text-primary transition-all flex items-center gap-1.5"
            >
              <Download size={12} />
              Exportar
            </button>
          </div>

          {/* Canvas */}
          <div
            ref={containerRef}
            className="relative rounded-2xl overflow-hidden bg-surface-secondary shadow-2xl border border-border"
          >
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasDrag}
              className="cursor-crosshair"
              style={{ display: 'block' }}
            />
            {selectedJoint && (
              <div className="absolute bottom-3 left-3 px-2 py-1 rounded-lg bg-surface/80 text-text-secondary text-[10px] font-mono backdrop-blur-sm">
                {selectedJoint}: [{joints[selectedJoint]?.[0]}, {joints[selectedJoint]?.[1]}]
              </div>
            )}
          </div>

          {/* Canvas controls */}
          <div className="flex items-center gap-4 text-xs text-text-secondary">
            <div className="flex items-center gap-2">
              <span className="text-text-muted">Zoom:</span>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={canvasScale}
                onChange={(e) => setCanvasScale(Number(e.target.value))}
                className="w-24"
              />
              <span className="font-mono w-10">{Math.round(canvasScale * 100)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted">Espessura:</span>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={lineThickness}
                onChange={(e) => setLineThickness(Number(e.target.value))}
                className="w-20"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted">Safe Zone:</span>
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={safeZone}
                onChange={(e) => setSafeZone(Number(e.target.value))}
                className="w-20"
              />
              <span className="font-mono w-8">{safeZone}%</span>
            </div>
          </div>

          {resultSrc && (
            <div className="w-full max-w-2xl">
              <div className="relative rounded-2xl overflow-hidden bg-surface-secondary shadow-2xl">
                <img
                  src={resultSrc}
                  alt="Resultado"
                  className="w-full h-auto max-h-[50vh] object-contain"
                  draggable={false}
                />
                <div className="absolute top-3 left-3 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider bg-success/90 text-white">
                  Gerado
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="w-full max-w-2xl p-3 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
              {error}
            </div>
          )}
        </div>
      </main>

      {/* Sidebar */}
      <aside className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-border bg-surface-secondary overflow-y-auto shrink-0 max-h-[40vh] lg:max-h-none">
        <div className="flex flex-col h-full">
          <div className="p-4 space-y-4 overflow-y-auto">
            {/* Diffusion model selector */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Modelo de Difusão
              </label>
              <div className="grid grid-cols-3 gap-2">
                {MODEL_IDS.map((id) => {
                  const prof = MODEL_PROFILES[id]
                  const isSelected = selectedModel === id
                  return (
                    <button
                      key={id}
                      onClick={() => setSelectedModel(id)}
                      className={`
                        flex flex-col items-center justify-center p-3 rounded-xl border-2 text-center transition-all duration-200 group
                        ${isSelected
                          ? 'border-accent bg-accent/5 text-text-primary shadow-lg shadow-accent/5'
                          : 'border-border bg-surface hover:border-text-muted text-text-secondary'
                        }
                      `}
                    >
                      <span className={`text-xs font-bold transition-colors ${isSelected ? 'text-accent' : 'text-text-primary group-hover:text-text-primary'}`}>
                        {prof.label}
                      </span>
                      <span className="text-[9px] text-text-muted mt-1 leading-tight line-clamp-2">
                        {id === 'anima' ? 'Anime HD' : id === 'krea2' ? 'Turbo Rápido' : 'GGUF Flux'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Checkpoint selector */}
            <div>
              <button
                onClick={() => setModelsOpen(!modelsOpen)}
                className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 w-full text-left"
              >
                {modelsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Checkpoint (UNET)
                {selectedCheckpoint && <span className="ml-1 text-accent font-normal normal-case">({selectedCheckpoint.split(/[/\\]/).pop()?.replace(/\.(safetensors|ckpt|gguf)$/, '')})</span>}
              </button>

              {modelsOpen && (
                <div>
                  {filteredModels.length === 0 ? (
                    <p className="text-xs text-text-muted">Nenhum checkpoint encontrado</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto custom-scroll">
                      <div className="grid grid-cols-3 gap-2">
                        {filteredModels.map((model) => {
                          const displayName = model.name.replace(/\.(safetensors|ckpt|gguf)$/, '').split(/[/\\]/).pop() ?? model.name
                          const isSelected = selectedCheckpoint === model.name
                          return (
                            <button
                              key={model.name}
                              onClick={() => setSelectedCheckpoint(model.name)}
                              title={displayName}
                              className={`
                                relative aspect-square rounded-xl border-2 overflow-hidden
                                transition-all
                                ${isSelected
                                  ? 'border-accent ring-1 ring-accent'
                                  : 'border-border hover:border-text-muted'
                                }
                              `}
                            >
                              {model.previewUrl ? (
                                <SafeImage
                                  path={model.previewUrl}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full bg-surface-tertiary flex items-center justify-center">
                                  <span className="text-[10px] text-text-muted text-center px-1 leading-tight">
                                    {displayName.slice(0, 18)}
                                  </span>
                                </div>
                              )}
                              {isSelected && (
                                <div className="absolute inset-x-0 bottom-0 h-1 bg-accent" />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* LoRA selector */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <button
                  onClick={() => setLorasOpen(!lorasOpen)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary uppercase tracking-wider text-left flex-1"
                >
                  {lorasOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  LoRA
                  {selectedLora && <span className="ml-1 text-accent font-normal normal-case">(ativo)</span>}
                </button>
                <button
                  onClick={handleRefreshLoras}
                  disabled={refreshingLoras}
                  className={`
                    p-1 rounded-lg shrink-0 transition-all duration-300
                    ${lorasRefreshed
                      ? 'bg-success/20 text-success'
                      : refreshingLoras
                        ? 'bg-accent/10 text-accent'
                        : 'hover:bg-surface-tertiary text-text-muted hover:text-text-primary'
                    }
                  `}
                  title="Atualizar lista de LoRAs"
                >
                  {lorasRefreshed ? (
                    <Check size={12} className="animate-[ping_0.3s_ease-out]" />
                  ) : (
                    <RefreshCw size={12} className={refreshingLoras ? 'animate-spin' : ''} />
                  )}
                </button>
              </div>

              {lorasOpen && (
                <div>
                  <div className="relative mb-2">
                    <input
                      type="text"
                      value={loraSearch}
                      onChange={(e) => setLoraSearch(e.target.value)}
                      placeholder="Buscar LoRA..."
                      className="w-full bg-surface rounded-lg border border-border px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
                    />
                  </div>
                  {filteredLoras.length === 0 ? (
                    <p className="text-xs text-text-muted">Nenhum LoRA encontrado</p>
                  ) : (
                    <div className="max-h-60 overflow-y-auto custom-scroll">
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          onClick={() => setSelectedLora(null)}
                          className={`
                            aspect-square rounded-xl border-2 flex items-center justify-center text-xs
                            transition-all
                            ${!selectedLora
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-border bg-surface-tertiary text-text-muted hover:border-text-muted'
                            }
                          `}
                        >
                          None
                        </button>
                        {filteredLoras.map((lora) => {
                          const displayName = lora.name.replace(/\.(safetensors|ckpt)$/, '').split('/').pop() ?? lora.name
                          return (
                            <button
                              key={lora.name}
                              onClick={() => setSelectedLora(lora.name)}
                              title={displayName}
                              className={`
                                relative aspect-square rounded-xl border-2 overflow-hidden
                                transition-all group
                                ${selectedLora === lora.name
                                  ? 'border-accent ring-1 ring-accent'
                                  : 'border-border hover:border-text-muted'
                                }
                              `}
                            >
                              {lora.previewUrl ? (
                                <SafeImage
                                  path={lora.previewUrl}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full bg-surface-tertiary flex items-center justify-center">
                                  <span className="text-[8px] text-text-muted text-center px-1 leading-tight">
                                    {displayName.slice(0, 15)}
                                  </span>
                                </div>
                              )}
                              {selectedLora === lora.name && (
                                <div className="absolute inset-x-0 bottom-0 h-1 bg-accent" />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {selectedLora && (
                    <div className="mt-3 space-y-2">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-text-muted">Model Strength</label>
                          <span className="text-xs text-text-secondary font-mono">{loraStrengthModel.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          value={loraStrengthModel}
                          min={0}
                          max={2}
                          step={0.05}
                          onChange={(e) => setLoraStrengthModel(Number(e.target.value))}
                          className="w-full"
                        />
                      </div>
                      {profile.hasLoraClipStrength && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <label className="text-xs text-text-muted">CLIP Strength</label>
                            <span className="text-xs text-text-secondary font-mono">{loraStrengthClip.toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            value={loraStrengthClip}
                            min={0}
                            max={2}
                            step={0.05}
                            onChange={(e) => setLoraStrengthClip(Number(e.target.value))}
                            className="w-full"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Prompt positivo
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Descreva a imagem desejada. Ex: 1girl, anime style, detailed face, blue eyes..."
                rows={3}
                className="w-full bg-surface rounded-lg border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
                disabled={generating}
              />
            </div>

            {/* Negative prompt */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Prompt negativo
              </label>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="O que evitar. Ex: bad quality, worst quality, blurry..."
                rows={2}
                className="w-full bg-surface rounded-lg border border-border px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent transition-colors"
                disabled={generating}
              />
            </div>

            {/* Joint info */}
            {selectedJoint && (
              <div className="p-3 rounded-lg bg-surface-tertiary border border-border">
                <div className="text-xs font-semibold text-text-secondary mb-2">
                  Junção selecionada: {selectedJoint}
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-text-muted">X</label>
                    <input
                      type="number"
                      value={joints[selectedJoint]?.[0] ?? 0}
                      onChange={(e) => {
                        const val = Math.max(0, Math.min(CANVAS_WIDTH, Number(e.target.value)))
                        setJoints(prev => ({ ...prev, [selectedJoint]: [val, prev[selectedJoint]?.[1] ?? 0] }))
                      }}
                      className="w-full bg-surface rounded border border-border px-2 py-1 text-xs text-text-primary"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-text-muted">Y</label>
                    <input
                      type="number"
                      value={joints[selectedJoint]?.[1] ?? 0}
                      onChange={(e) => {
                        const val = Math.max(0, Math.min(CANVAS_HEIGHT, Number(e.target.value)))
                        setJoints(prev => ({ ...prev, [selectedJoint]: [prev[selectedJoint]?.[0] ?? 0, val] }))
                      }}
                      className="w-full bg-surface rounded border border-border px-2 py-1 text-xs text-text-primary"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-text-muted mt-2">
                  Clique na junção para selecionar, depois clique novamente no canvas para mover.
                </p>
              </div>
            )}
          </div>

          <div className="mt-auto p-4 border-t border-border space-y-3">
            {resultSrc && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-success/10 border border-success/20">
                <Wand2 size={14} className="text-success shrink-0" />
                <span className="text-xs text-text-primary">
                  Imagem gerada com pose!
                </span>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || generating || !status.online}
              className={`
                w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm
                transition-all duration-200
                ${(!prompt.trim() || generating || !status.online)
                  ? 'bg-accent-muted text-text-muted cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98] shadow-lg shadow-accent/20'
                }
              `}
            >
              {generating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Gerando...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Gerar com Pose
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
