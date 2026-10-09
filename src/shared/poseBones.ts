export type PoseRotations = Record<string, [number, number, number]>

export const D2R = Math.PI / 180
export const R2D = 180 / Math.PI

export interface PoseBoneDef {
  name: string
  parent: string | null
  label: string
  /** Offset local (metros, Y up) do pai até o início do filho. */
  offset: [number, number, number]
  /** Limites de rotação em graus por eixo (X, Y, Z). */
  limit: { x: [number, number]; y: [number, number]; z: [number, number] }
}

/**
 * Rig com nomes VNCCS/Unreal (`pelvis`, `lowerarm_*`), iguais aos usados
 * nas pose libraries reais do projeto.
 */
export const POSE_BONE_DEFS: PoseBoneDef[] = [
  { name: 'pelvis', parent: null, label: 'Quadril', offset: [0, 1.0, 0], limit: { x: [-35, 35], y: [-50, 50], z: [-25, 25] } },
  { name: 'spine_01', parent: 'pelvis', label: 'Coluna 01', offset: [0, 0.16, 0], limit: { x: [-35, 35], y: [-45, 45], z: [-35, 35] } },
  { name: 'spine_02', parent: 'spine_01', label: 'Coluna 02', offset: [0, 0.16, 0], limit: { x: [-40, 40], y: [-45, 45], z: [-35, 35] } },
  { name: 'spine_03', parent: 'spine_02', label: 'Coluna 03', offset: [0, 0.15, 0], limit: { x: [-40, 40], y: [-45, 45], z: [-35, 35] } },
  { name: 'neck_01', parent: 'spine_03', label: 'Pescoço', offset: [0, 0.13, 0], limit: { x: [-45, 35], y: [-65, 65], z: [-35, 35] } },
  { name: 'head', parent: 'neck_01', label: 'Cabeça', offset: [0, 0.11, 0], limit: { x: [-40, 35], y: [-75, 75], z: [-45, 45] } },

  { name: 'clavicle_l', parent: 'spine_03', label: 'Clavícula E', offset: [0.08, 0.09, 0], limit: { x: [-25, 25], y: [-25, 25], z: [-35, 35] } },
  { name: 'upperarm_l', parent: 'clavicle_l', label: 'Braço E', offset: [0.16, 0, 0], limit: { x: [-175, 25], y: [-90, 90], z: [-95, 95] } },
  { name: 'lowerarm_l', parent: 'upperarm_l', label: 'Antebraço E', offset: [0, -0.28, 0], limit: { x: [-145, 5], y: [-85, 85], z: [-95, 95] } },
  { name: 'hand_l', parent: 'lowerarm_l', label: 'Mão E', offset: [0, -0.26, 0], limit: { x: [-75, 75], y: [-35, 35], z: [-90, 90] } },

  { name: 'clavicle_r', parent: 'spine_03', label: 'Clavícula D', offset: [-0.08, 0.09, 0], limit: { x: [-25, 25], y: [-25, 25], z: [-35, 35] } },
  { name: 'upperarm_r', parent: 'clavicle_r', label: 'Braço D', offset: [-0.16, 0, 0], limit: { x: [-175, 25], y: [-90, 90], z: [-95, 95] } },
  { name: 'lowerarm_r', parent: 'upperarm_r', label: 'Antebraço D', offset: [0, -0.28, 0], limit: { x: [-145, 5], y: [-85, 85], z: [-95, 95] } },
  { name: 'hand_r', parent: 'lowerarm_r', label: 'Mão D', offset: [0, -0.26, 0], limit: { x: [-75, 75], y: [-35, 35], z: [-90, 90] } },

  { name: 'thigh_l', parent: 'pelvis', label: 'Coxa E', offset: [0.1, -0.09, 0], limit: { x: [-130, 35], y: [-50, 50], z: [-45, 45] } },
  { name: 'calf_l', parent: 'thigh_l', label: 'Panturrilha E', offset: [0, -0.42, 0], limit: { x: [-5, 150], y: [-35, 35], z: [-25, 25] } },
  { name: 'foot_l', parent: 'calf_l', label: 'Pé E', offset: [0, -0.42, 0], limit: { x: [-45, 45], y: [-30, 30], z: [-25, 25] } },
  { name: 'toe_l', parent: 'foot_l', label: 'Dedos do pé E', offset: [0, -0.06, 0.14], limit: { x: [-35, 35], y: [-20, 20], z: [-10, 10] } },

  { name: 'thigh_r', parent: 'pelvis', label: 'Coxa D', offset: [-0.1, -0.09, 0], limit: { x: [-130, 35], y: [-50, 50], z: [-45, 45] } },
  { name: 'calf_r', parent: 'thigh_r', label: 'Panturrilha D', offset: [0, -0.42, 0], limit: { x: [-5, 150], y: [-35, 35], z: [-25, 25] } },
  { name: 'foot_r', parent: 'calf_r', label: 'Pé D', offset: [0, -0.42, 0], limit: { x: [-45, 45], y: [-30, 30], z: [-25, 25] } },
  { name: 'toe_r', parent: 'foot_r', label: 'Dedos do pé D', offset: [0, -0.06, 0.14], limit: { x: [-35, 35], y: [-20, 20], z: [-10, 10] } }
]

export const POSE_BONE_GROUPS: Array<{ id: string; label: string; bones: string[] }> = [
  { id: 'torso', label: 'Tronco', bones: ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r'] },
  { id: 'arms', label: 'Braços', bones: ['upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r'] },
  { id: 'legs', label: 'Pernas', bones: ['thigh_l', 'calf_l', 'foot_l', 'toe_l', 'thigh_r', 'calf_r', 'foot_r', 'toe_r'] }
]

export interface PosePreset {
  id: string
  label: string
  icon?: string
  pose: PoseRotations
}

export const POSE_PRESETS: PosePreset[] = [
  {
    id: 'natural',
    label: 'Natural (Em Pé)',
    pose: {
      spine_01: [2, 0, 0],
      spine_02: [-2, 0, 0],
      spine_03: [2, 0, 0],
      neck_01: [-2, 0, 0],
      head: [2, 0, 0],
      upperarm_l: [-8, 0, 12],
      lowerarm_l: [-15, 0, -5],
      hand_l: [5, 0, 0],
      upperarm_r: [-8, 0, -12],
      lowerarm_r: [-15, 0, 5],
      hand_r: [5, 0, 0],
      thigh_l: [0, 0, 3],
      calf_l: [0, 0, -3],
      thigh_r: [0, 0, -3],
      calf_r: [0, 0, 3]
    }
  },
  {
    id: 'hands_on_hips',
    label: 'Mãos na Cintura',
    pose: {
      spine_03: [4, 0, 0],
      upperarm_l: [-15, 20, 42],
      lowerarm_l: [-85, -10, -15],
      hand_l: [35, 10, 10],
      upperarm_r: [-15, -20, -42],
      lowerarm_r: [-85, 10, 15],
      hand_r: [35, -10, -10],
      thigh_l: [0, 0, 5],
      calf_l: [0, 0, -5],
      thigh_r: [0, 0, -5],
      calf_r: [0, 0, 5]
    }
  },
  {
    id: 'crossed_arms',
    label: 'Braços Cruzados',
    pose: {
      spine_02: [4, 0, 0],
      spine_03: [6, 0, 0],
      upperarm_l: [-40, 30, 25],
      lowerarm_l: [-100, 35, 25],
      hand_l: [-10, 10, 0],
      upperarm_r: [-45, -25, -25],
      lowerarm_r: [-105, -30, -25],
      hand_r: [-10, -10, 0],
      head: [-4, 0, 0]
    }
  },
  {
    id: 'waving',
    label: 'Acenando',
    pose: {
      upperarm_r: [-30, 0, -125],
      lowerarm_r: [-90, -20, 20],
      hand_r: [0, 25, 20],
      upperarm_l: [-8, 0, 12],
      lowerarm_l: [-15, 0, 0],
      head: [0, 15, -5]
    }
  },
  {
    id: 'thinking',
    label: 'Pensativo',
    pose: {
      upperarm_r: [-45, -20, -30],
      lowerarm_r: [-115, -15, 20],
      hand_r: [-20, 20, 10],
      upperarm_l: [-30, 20, 20],
      lowerarm_l: [-70, 20, 10],
      head: [10, 15, 8]
    }
  },
  {
    id: 'walking',
    label: 'Caminhando',
    pose: {
      pelvis: [0, -5, 0],
      thigh_l: [-28, 0, 2],
      calf_l: [15, 0, 0],
      foot_l: [-10, 0, 0],
      thigh_r: [22, 0, -2],
      calf_r: [35, 0, 0],
      foot_r: [15, 0, 0],
      upperarm_l: [25, 0, 8],
      lowerarm_l: [-25, 0, 0],
      upperarm_r: [-32, 0, -8],
      lowerarm_r: [-40, 0, 0],
      spine_01: [0, 5, 0],
      spine_02: [0, 5, 0]
    }
  },
  {
    id: 'sitting',
    label: 'Sentado',
    pose: {
      pelvis: [-8, 0, 0],
      thigh_l: [-85, 0, 6],
      calf_l: [90, 0, -6],
      foot_l: [-5, 0, 0],
      thigh_r: [-85, 0, -6],
      calf_r: [90, 0, 6],
      foot_r: [-5, 0, 0],
      upperarm_l: [-15, 10, 18],
      lowerarm_l: [-60, 0, 0],
      upperarm_r: [-15, -10, -18],
      lowerarm_r: [-60, 0, 0],
      spine_01: [8, 0, 0],
      spine_02: [5, 0, 0],
      spine_03: [-4, 0, 0]
    }
  },
  {
    id: 'tpose',
    label: 'T-Pose',
    pose: {
      upperarm_l: [0, 0, 90],
      upperarm_r: [0, 0, -90]
    }
  }
]

export function mirrorPose(pose: PoseRotations): PoseRotations {
  const mirrored: PoseRotations = {}
  for (const [name, [x, y, z]] of Object.entries(pose)) {
    if (name.endsWith('_l')) {
      const opp = name.replace(/_l$/, '_r')
      mirrored[opp] = [x, -y, -z]
    } else if (name.endsWith('_r')) {
      const opp = name.replace(/_r$/, '_l')
      mirrored[opp] = [x, -y, -z]
    } else {
      mirrored[name] = [x, -y, -z]
    }
  }
  return mirrored
}