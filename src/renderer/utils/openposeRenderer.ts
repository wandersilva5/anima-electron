export type Joints = Record<string, [number, number]>

export const BONE_CONNECTIONS: [string, string][] = [
  ['nose', 'neck'],
  ['neck', 'r_shoulder'],
  ['r_shoulder', 'r_elbow'],
  ['r_elbow', 'r_wrist'],
  ['neck', 'l_shoulder'],
  ['l_shoulder', 'l_elbow'],
  ['l_elbow', 'l_wrist'],
  ['neck', 'r_hip'],
  ['neck', 'l_hip'],
  ['r_hip', 'r_knee'],
  ['r_knee', 'r_ankle'],
  ['l_hip', 'l_knee'],
  ['l_knee', 'l_ankle'],
  ['nose', 'r_eye'],
  ['r_eye', 'r_ear'],
  ['nose', 'l_eye'],
  ['l_eye', 'l_ear'],
]

const BONE_PALETTE = [
  '#0000ff',
  '#ff0000',
  '#ffaa00',
  '#ffff00',
  '#ff5500',
  '#00ff00',
  '#00ff55',
  '#00ff00',
  '#00ffaa',
  '#55ff00',
  '#029966',
  '#00ffff',
  '#0000ff',
  '#aa00ff',
  '#ff00aa',
  '#aa00ff',
  '#ff00aa',
]

const JOINT_COLORS: Record<string, string> = {
  nose: '#0000ff',
  neck: '#0000ff',
  r_eye: '#aa00ff',
  l_eye: '#aa00ff',
  r_ear: '#ff00aa',
  l_ear: '#ff00aa',
  r_shoulder: '#ff5500',
  r_elbow: '#ffaa00',
  r_wrist: '#ffff00',
  l_shoulder: '#55ff00',
  l_elbow: '#00ff00',
  l_wrist: '#00ff55',
  r_hip: '#00ffaa',
  r_knee: '#55ff00',
  r_ankle: '#00ff00',
  l_hip: '#0055ff',
  l_knee: '#00ffff',
  l_ankle: '#00aaff',
}

export function renderOpenPose(
  joints: Joints,
  width: number,
  height: number,
  lineThickness = 3
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)

  const sx = width / 512
  const sy = height / 1536
  const scale = Math.min(sx, sy)
  const ox = (width - 512 * scale) / 2
  const oy = (height - 1536 * scale) / 2
  const tx = (p: [number, number]): [number, number] => [p[0] * scale + ox, p[1] * scale + oy]

  ctx.lineWidth = lineThickness
  ctx.lineCap = 'round'
  for (let i = 0; i < BONE_CONNECTIONS.length; i++) {
    const [j1, j2] = BONE_CONNECTIONS[i]
    const p1 = joints[j1]
    const p2 = joints[j2]
    if (!p1 || !p2) continue
    const [x1, y1] = tx(p1)
    const [x2, y2] = tx(p2)
    ctx.strokeStyle = BONE_PALETTE[i]
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  for (const [name, pos] of Object.entries(joints)) {
    const [x, y] = tx(pos)
    ctx.fillStyle = JOINT_COLORS[name] ?? '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  return canvas
}
