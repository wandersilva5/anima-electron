import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import {
  POSE_BONE_DEFS,
  POSE_BONE_GROUPS,
  POSE_PRESETS,
  mirrorPose,
  D2R,
  type PoseRotations,
  type PosePreset
} from '@shared/poseBones'
import {
  RotateCcw,
  Sparkles,
  FlipHorizontal,
  Crosshair,
  ChevronDown
} from 'lucide-react'

export interface PoseMannequinHandle {
  exportPNG: () => string
  getPose: () => PoseRotations
  setPose: (pose: PoseRotations) => void
}

interface Props {
  onPoseChange?: () => void
}

const CLAY_COLOR = 0xd0d0d0
const JOINT_COLOR = 0xa8a8a8
const SELECTED_COLOR = 0xf97316
const HOVERED_COLOR = 0x38bdf8
const BG_COLOR = 0x181a20
const EXPORT_BG_COLOR = 0xffffff

export const PoseMannequin3D = forwardRef<PoseMannequinHandle, Props>(
  function PoseMannequin3D({ onPoseChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
    const sceneRef = useRef<THREE.Scene | null>(null)
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
    const controlsRef = useRef<OrbitControls | null>(null)
    const transformControlsRef = useRef<TransformControls | null>(null)
    const bonesRef = useRef<Map<string, THREE.Group>>(new Map())
    const pickablesRef = useRef<THREE.Mesh[]>([])
    const groundRef = useRef<THREE.Mesh | null>(null)
    const raycasterRef = useRef(new THREE.Raycaster())
    const pointerRef = useRef(new THREE.Vector2())
    const onPoseChangeRef = useRef(onPoseChange)
    onPoseChangeRef.current = onPoseChange

    const isDraggingGizmoRef = useRef(false)
    const selectedRef = useRef<string>('upperarm_l')

    const [selected, setSelected] = useState<string>('upperarm_l')
    const [hovered, setHovered] = useState<string | null>(null)
    const [axes, setAxes] = useState<PoseRotations>({})
    const [activePreset, setActivePreset] = useState<string | null>(null)
    const [gizmoSpace, setGizmoSpace] = useState<'local' | 'world'>('local')

    // Materiais compartilhados
    const materialsRef = useRef<{
      clay: THREE.MeshStandardMaterial
      joint: THREE.MeshStandardMaterial
      selected: THREE.MeshStandardMaterial
      hovered: THREE.MeshStandardMaterial
    } | null>(null)

    // Atualiza ref do osso selecionado
    useEffect(() => {
      selectedRef.current = selected
    }, [selected])

    // ── 1. Construção da Cena, Rig e Controles ─────────────
    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(BG_COLOR)
      sceneRef.current = scene

      const width = container.clientWidth || 600
      const height = container.clientHeight || 500
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
      renderer.setSize(width, height)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      container.appendChild(renderer.domElement)
      rendererRef.current = renderer

      const camera = new THREE.PerspectiveCamera(34, width / height, 0.05, 100)
      camera.position.set(0, 1.25, 3.4)
      cameraRef.current = camera

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.05
      controls.target.set(0, 1.0, 0)
      controls.maxPolarAngle = Math.PI / 2 + 0.1
      controls.minDistance = 0.8
      controls.maxDistance = 6.0
      controls.update()
      controlsRef.current = controls

      // Iluminação de estúdio
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.7)
      scene.add(ambientLight)

      const keyLight = new THREE.DirectionalLight(0xffffff, 1.2)
      keyLight.position.set(2.5, 4.5, 3.5)
      scene.add(keyLight)

      const fillLight = new THREE.DirectionalLight(0xbad2e8, 0.5)
      fillLight.position.set(-3.5, 2.5, -2.5)
      scene.add(fillLight)

      const rimLight = new THREE.DirectionalLight(0xffffff, 0.45)
      rimLight.position.set(0, 3.5, -3.5)
      scene.add(rimLight)

      // Chão de estúdio com círculo suave
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(2.4, 48),
        new THREE.MeshStandardMaterial({
          color: 0x222630,
          roughness: 0.95,
          metalness: 0.05
        })
      )
      ground.rotation.x = -Math.PI / 2
      ground.position.y = -0.005
      scene.add(ground)
      groundRef.current = ground

      // Materiais anatômicos
      const clay = new THREE.MeshStandardMaterial({
        color: CLAY_COLOR,
        roughness: 0.52,
        metalness: 0.04
      })
      const joint = new THREE.MeshStandardMaterial({
        color: JOINT_COLOR,
        roughness: 0.42,
        metalness: 0.08
      })
      const selectedMat = new THREE.MeshStandardMaterial({
        color: SELECTED_COLOR,
        roughness: 0.35,
        metalness: 0.1,
        emissive: 0x5a2300
      })
      const hoveredMat = new THREE.MeshStandardMaterial({
        color: HOVERED_COLOR,
        roughness: 0.35,
        metalness: 0.06,
        emissive: 0x073b5c
      })
      materialsRef.current = { clay, joint, selected: selectedMat, hovered: hoveredMat }

      // ── Rig Esquelético (Grupos Hierárquicos) ──────────────
      const boneMap = new Map<string, THREE.Group>()
      for (const def of POSE_BONE_DEFS) {
        const g = new THREE.Group()
        g.name = def.name
        g.position.set(def.offset[0], def.offset[1], def.offset[2])
        g.userData['boneName'] = def.name
        boneMap.set(def.name, g)
      }
      for (const def of POSE_BONE_DEFS) {
        const g = boneMap.get(def.name)!
        if (def.parent) {
          boneMap.get(def.parent)!.add(g)
        } else {
          scene.add(g)
        }
      }
      bonesRef.current = boneMap

      // ── Malha Anatômica Estilo Manequim de Arte ───────────
      const pickables: THREE.Mesh[] = []
      const addPick = (mesh: THREE.Mesh, boneName: string, isJoint = false): void => {
        mesh.userData['boneName'] = boneName
        mesh.userData['isJoint'] = isJoint
        pickables.push(mesh)
      }

      // 1. Pelvis
      const pelvisGroup = boneMap.get('pelvis')!
      const pelvisBlock = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.095, 0.14, 20), clay)
      pelvisBlock.scale.set(1.05, 1, 0.72)
      pelvisBlock.position.set(0, -0.01, 0)
      pelvisGroup.add(pelvisBlock)
      addPick(pelvisBlock, 'pelvis')

      const hipJointL = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 12), joint)
      hipJointL.position.set(0.1, -0.09, 0)
      pelvisGroup.add(hipJointL)
      addPick(hipJointL, 'pelvis', true)

      const hipJointR = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 12), joint)
      hipJointR.position.set(-0.1, -0.09, 0)
      pelvisGroup.add(hipJointR)
      addPick(hipJointR, 'pelvis', true)

      const waistJoint = new THREE.Mesh(new THREE.SphereGeometry(0.060, 16, 12), joint)
      waistJoint.position.set(0, 0.07, 0)
      pelvisGroup.add(waistJoint)
      addPick(waistJoint, 'pelvis', true)

      // 2. Coluna 01 (Lombar)
      const spine1Group = boneMap.get('spine_01')!
      const spine1Disc = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.082, 0.12, 18), clay)
      spine1Disc.scale.set(1.02, 1, 0.74)
      spine1Disc.position.set(0, -0.06, 0)
      spine1Group.add(spine1Disc)
      addPick(spine1Disc, 'spine_01')

      const spine1Joint = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), joint)
      spine1Group.add(spine1Joint)
      addPick(spine1Joint, 'spine_01', true)

      // 3. Coluna 02 (Abdômen Médio)
      const spine2Group = boneMap.get('spine_02')!
      const spine2Disc = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.092, 0.12, 18), clay)
      spine2Disc.scale.set(1.06, 1, 0.75)
      spine2Disc.position.set(0, -0.06, 0)
      spine2Group.add(spine2Disc)
      addPick(spine2Disc, 'spine_02')

      const spine2Joint = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12), joint)
      spine2Group.add(spine2Joint)
      addPick(spine2Joint, 'spine_02', true)

      // 4. Coluna 03 (Tórax / Caixa Torácica)
      const spine3Group = boneMap.get('spine_03')!
      const ribcage = new THREE.Mesh(new THREE.CylinderGeometry(0.144, 0.112, 0.18, 20), clay)
      ribcage.scale.set(1.15, 1, 0.78)
      ribcage.position.set(0, 0.06, 0)
      spine3Group.add(ribcage)
      addPick(ribcage, 'spine_03')

      // Peitoral
      const pecL = new THREE.Mesh(new THREE.SphereGeometry(0.054, 14, 10), clay)
      pecL.scale.set(1.0, 0.8, 0.45)
      pecL.position.set(0.065, 0.07, 0.065)
      spine3Group.add(pecL)
      addPick(pecL, 'spine_03')

      const pecR = new THREE.Mesh(new THREE.SphereGeometry(0.054, 14, 10), clay)
      pecR.scale.set(1.0, 0.8, 0.45)
      pecR.position.set(-0.065, 0.07, 0.065)
      spine3Group.add(pecR)
      addPick(pecR, 'spine_03')

      const spine3Joint = new THREE.Mesh(new THREE.SphereGeometry(0.060, 16, 12), joint)
      spine3Group.add(spine3Joint)
      addPick(spine3Joint, 'spine_03', true)

      // 5. Pescoço
      const neckGroup = boneMap.get('neck_01')!
      const neckJoint = new THREE.Mesh(new THREE.SphereGeometry(0.040, 14, 10), joint)
      neckGroup.add(neckJoint)
      addPick(neckJoint, 'neck_01', true)

      const neckCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.040, 0.044, 0.11, 16), clay)
      neckCylinder.position.set(0, 0.055, 0)
      neckGroup.add(neckCylinder)
      addPick(neckCylinder, 'neck_01')

      // 6. Cabeça Estilizada (com direção facial clara)
      const headGroup = boneMap.get('head')!
      const headJoint = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 10), joint)
      headGroup.add(headJoint)
      addPick(headJoint, 'head', true)

      const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.10, 24, 18), clay)
      cranium.scale.set(0.96, 1.15, 1.10)
      cranium.position.set(0, 0.10, -0.01)
      headGroup.add(cranium)
      addPick(cranium, 'head')

      const jaw = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.038, 0.09, 16), clay)
      jaw.scale.set(0.95, 1, 0.80)
      jaw.position.set(0, 0.045, 0.032)
      jaw.rotation.x = 0.18
      headGroup.add(jaw)
      addPick(jaw, 'head')

      // Nariz sutil de mannequin (orientação facial em +Z)
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.048, 4), clay)
      nose.rotation.set(-Math.PI / 2, 0, Math.PI / 4)
      nose.position.set(0, 0.085, 0.098)
      headGroup.add(nose)
      addPick(nose, 'head')

      // Orelhas
      for (const sign of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), clay)
        ear.scale.set(0.4, 1.2, 0.8)
        ear.position.set(sign * 0.098, 0.09, -0.01)
        headGroup.add(ear)
        addPick(ear, 'head')
      }

      // 7. Clavículas
      for (const side of ['l', 'r'] as const) {
        const clavi = boneMap.get(`clavicle_${side}`)!
        const sign = side === 'l' ? 1 : -1
        const claviMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.16, 14), clay)
        claviMesh.position.set(sign * 0.08, 0, 0)
        claviMesh.rotation.z = sign * (Math.PI / 2)
        clavi.add(claviMesh)
        addPick(claviMesh, `clavicle_${side}`)
      }

      // 8. Braços (Ombro -> Cotovelo)
      for (const side of ['l', 'r'] as const) {
        const ua = boneMap.get(`upperarm_${side}`)!
        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.054, 16, 12), joint)
        ua.add(shoulder)
        addPick(shoulder, `upperarm_${side}`, true)

        const bicep = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.038, 0.28, 16), clay)
        bicep.position.set(0, -0.14, 0)
        ua.add(bicep)
        addPick(bicep, `upperarm_${side}`)
      }

      // 9. Antebraços (Cotovelo -> Pulso)
      for (const side of ['l', 'r'] as const) {
        const la = boneMap.get(`lowerarm_${side}`)!
        const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), joint)
        la.add(elbow)
        addPick(elbow, `lowerarm_${side}`, true)

        const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.030, 0.26, 16), clay)
        forearm.position.set(0, -0.13, 0)
        la.add(forearm)
        addPick(forearm, `lowerarm_${side}`)
      }

      // 10. Mãos (Palma + Dedos + Polegar)
      for (const side of ['l', 'r'] as const) {
        const hand = boneMap.get(`hand_${side}`)!
        const sign = side === 'l' ? 1 : -1
        const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 10), joint)
        hand.add(wrist)
        addPick(wrist, `hand_${side}`, true)

        const palm = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.075, 0.020), clay)
        palm.position.set(0, -0.045, 0)
        hand.add(palm)
        addPick(palm, `hand_${side}`)

        const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.055, 0.016), clay)
        fingers.position.set(0, -0.105, 0)
        hand.add(fingers)
        addPick(fingers, `hand_${side}`)

        const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.010, 0.045, 10), clay)
        thumb.position.set(sign * 0.034, -0.038, 0.012)
        thumb.rotation.z = sign * -0.45
        hand.add(thumb)
        addPick(thumb, `hand_${side}`)
      }

      // 11. Coxas (Quadril -> Joelho)
      for (const side of ['l', 'r'] as const) {
        const thigh = boneMap.get(`thigh_${side}`)!
        const hip = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12), joint)
        thigh.add(hip)
        addPick(hip, `thigh_${side}`, true)

        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.048, 0.42, 18), clay)
        leg.position.set(0, -0.21, 0)
        thigh.add(leg)
        addPick(leg, `thigh_${side}`)
      }

      // 12. Panturrilhas / Canelas (Joelho -> Tornozelo)
      for (const side of ['l', 'r'] as const) {
        const calf = boneMap.get(`calf_${side}`)!
        const knee = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 12), joint)
        calf.add(knee)
        addPick(knee, `calf_${side}`, true)

        const kneecap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), clay)
        kneecap.scale.set(1, 1, 0.45)
        kneecap.position.set(0, 0, 0.035)
        calf.add(kneecap)
        addPick(kneecap, `calf_${side}`)

        const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.036, 0.42, 18), clay)
        shin.position.set(0, -0.21, 0)
        calf.add(shin)
        addPick(shin, `calf_${side}`)
      }

      // 13. Pés (Tornozelo + Calcanhar + Peito do Pé)
      for (const side of ['l', 'r'] as const) {
        const foot = boneMap.get(`foot_${side}`)!
        const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), joint)
        foot.add(ankle)
        addPick(ankle, `foot_${side}`, true)

        const heel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), clay)
        heel.position.set(0, -0.035, -0.04)
        foot.add(heel)
        addPick(heel, `foot_${side}`)

        const instep = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.050, 0.13), clay)
        instep.position.set(0, -0.035, 0.045)
        foot.add(instep)
        addPick(instep, `foot_${side}`)
      }

      // 14. Dedos dos Pés
      for (const side of ['l', 'r'] as const) {
        const toe = boneMap.get(`toe_${side}`)!
        const toeBox = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.032, 0.065), clay)
        toeBox.position.set(0, 0.005, 0.03)
        toe.add(toeBox)
        addPick(toeBox, `toe_${side}`)
      }

      pickablesRef.current = pickables

      // ── TransformControls (Gizmo de Rotação Interativo) ──
      const tc = new TransformControls(camera, renderer.domElement)
      tc.setMode('rotate')
      tc.setSpace('local')
      tc.setSize(0.75)
      const tcHelper = tc.getHelper()
      scene.add(tcHelper)
      transformControlsRef.current = tc

      tc.addEventListener('dragging-changed', (event) => {
        const dragging = Boolean(event.value)
        isDraggingGizmoRef.current = dragging
        if (controlsRef.current) {
          controlsRef.current.enabled = !dragging
        }
      })

      tc.addEventListener('change', () => {
        if (!isDraggingGizmoRef.current) return
        const activeName = selectedRef.current
        const g = bonesRef.current.get(activeName)
        if (!g) return

        const rx = +(g.rotation.x / D2R).toFixed(1)
        const ry = +(g.rotation.y / D2R).toFixed(1)
        const rz = +(g.rotation.z / D2R).toFixed(1)

        setAxes((prev) => ({
          ...prev,
          [activeName]: [rx, ry, rz]
        }))
        setActivePreset(null)
        onPoseChangeRef.current?.()
      })

      // Conecta o osso selecionado inicial
      const initialBone = boneMap.get(selectedRef.current)
      if (initialBone) {
        tc.attach(initialBone)
      }

      // ── Seleção e Hover com o Mouse ───────────────────────
      const onPointerDown = (ev: PointerEvent): void => {
        if (isDraggingGizmoRef.current) return
        if (ev.button !== 0) return // apenas botão esquerdo

        const rect = renderer.domElement.getBoundingClientRect()
        pointerRef.current.set(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1
        )
        raycasterRef.current.setFromCamera(pointerRef.current, camera)
        const hits = raycasterRef.current.intersectObjects(pickablesRef.current, false)
        if (hits.length > 0) {
          const name = hits[0].object.userData['boneName'] as string | undefined
          if (name) {
            setSelected(name)
          }
        }
      }

      const onPointerMove = (ev: PointerEvent): void => {
        if (isDraggingGizmoRef.current) return
        const rect = renderer.domElement.getBoundingClientRect()
        pointerRef.current.set(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1
        )
        raycasterRef.current.setFromCamera(pointerRef.current, camera)
        const hits = raycasterRef.current.intersectObjects(pickablesRef.current, false)
        if (hits.length > 0) {
          const name = hits[0].object.userData['boneName'] as string | undefined
          if (name) {
            setHovered(name)
            renderer.domElement.style.cursor = 'pointer'
            return
          }
        }
        setHovered(null)
        renderer.domElement.style.cursor = 'default'
      }

      renderer.domElement.addEventListener('pointerdown', onPointerDown)
      renderer.domElement.addEventListener('pointermove', onPointerMove)

      // ── Resize ─────────────────────────────────────────
      const ro = new ResizeObserver(() => {
        const w = container.clientWidth
        const h = container.clientHeight
        if (w === 0 || h === 0) return
        renderer.setSize(w, h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      })
      ro.observe(container)

      // ── Loop de Render ─────────────────────────────────
      let raf = 0
      const animate = (): void => {
        raf = requestAnimationFrame(animate)
        controls.update()
        renderer.render(scene, camera)
      }
      animate()

      return () => {
        cancelAnimationFrame(raf)
        ro.disconnect()
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('pointermove', onPointerMove)
        tc.dispose()
        controls.dispose()
        renderer.dispose()
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement)
        }
      }
    }, [])

    // ── Atualização do Gizmo e Materiais ao Mudar Seleção/Hover ──
    useEffect(() => {
      const tc = transformControlsRef.current
      const bone = bonesRef.current.get(selected)
      if (tc && bone) {
        tc.attach(bone)
      }

      // Atualiza cores dos materiais nos meshes
      const mats = materialsRef.current
      if (!mats) return

      for (const mesh of pickablesRef.current) {
        const name = mesh.userData['boneName'] as string | undefined
        const isJoint = Boolean(mesh.userData['isJoint'])
        if (name === selected) {
          mesh.material = mats.selected
        } else if (name === hovered) {
          mesh.material = mats.hovered
        } else {
          mesh.material = isJoint ? mats.joint : mats.clay
        }
      }

      // Inicializa eixos do osso selecionado caso não estejam no state
      if (bone && !axes[selected]) {
        setAxes((prev) => ({
          ...prev,
          [selected]: [
            Math.round(bone.rotation.x / D2R),
            Math.round(bone.rotation.y / D2R),
            Math.round(bone.rotation.z / D2R)
          ]
        }))
      }
    }, [selected, hovered, axes])

    // Alternar espaço local/world no gizmo
    const toggleGizmoSpace = useCallback(() => {
      const next = gizmoSpace === 'local' ? 'world' : 'local'
      setGizmoSpace(next)
      if (transformControlsRef.current) {
        transformControlsRef.current.setSpace(next)
      }
    }, [gizmoSpace])

    // ── Aplicação de Rotações ────────────────────────────
    const applyRotation = (boneName: string, axis: 0 | 1 | 2, value: number): void => {
      const def = POSE_BONE_DEFS.find((d) => d.name === boneName)
      const g = bonesRef.current.get(boneName)
      if (!def || !g) return
      const axisName = (['x', 'y', 'z'] as const)[axis]
      const [min, max] = def.limit[axisName]
      const clamped = Math.min(max, Math.max(min, value))
      g.rotation[axisName] = clamped * D2R
      setAxes((prev) => {
        const cur = (prev[boneName] ?? [0, 0, 0]).slice() as [number, number, number]
        cur[axis] = clamped
        return { ...prev, [boneName]: cur }
      })
      setActivePreset(null)
      onPoseChangeRef.current?.()
    }

    const resetBone = (boneName: string): void => {
      const g = bonesRef.current.get(boneName)
      if (!g) return
      g.rotation.set(0, 0, 0)
      setAxes((prev) => ({
        ...prev,
        [boneName]: [0, 0, 0]
      }))
      setActivePreset(null)
      onPoseChangeRef.current?.()
    }

    const resetPose = (): void => {
      for (const g of bonesRef.current.values()) g.rotation.set(0, 0, 0)
      setAxes({})
      setActivePreset(null)
      onPoseChangeRef.current?.()
    }

    const applyPreset = (preset: PosePreset): void => {
      for (const g of bonesRef.current.values()) g.rotation.set(0, 0, 0)
      const next: PoseRotations = {}
      for (const [name, [rx, ry, rz]] of Object.entries(preset.pose)) {
        const g = bonesRef.current.get(name)
        if (!g) continue
        g.rotation.set(rx * D2R, ry * D2R, rz * D2R)
        next[name] = [rx, ry, rz]
      }
      setAxes(next)
      setActivePreset(preset.id)
      onPoseChangeRef.current?.()
    }

    const handleMirror = (): void => {
      const current = getPose()
      const mirrored = mirrorPose(current)
      setPose(mirrored)
      setActivePreset(null)
    }

    const setCameraView = (view: 'front' | 'side' | 'back' | 'focus'): void => {
      const camera = cameraRef.current
      const controls = controlsRef.current
      if (!camera || !controls) return

      if (view === 'front') {
        camera.position.set(0, 1.25, 3.4)
        controls.target.set(0, 1.0, 0)
      } else if (view === 'side') {
        camera.position.set(3.4, 1.25, 0)
        controls.target.set(0, 1.0, 0)
      } else if (view === 'back') {
        camera.position.set(0, 1.25, -3.4)
        controls.target.set(0, 1.0, 0)
      } else if (view === 'focus') {
        const g = bonesRef.current.get(selected)
        if (g) {
          const worldPos = new THREE.Vector3()
          g.getWorldPosition(worldPos)
          controls.target.copy(worldPos)
        }
      }
      controls.update()
    }

    const getPose = (): PoseRotations => {
      const out: PoseRotations = {}
      for (const [name, g] of bonesRef.current) {
        const r: [number, number, number] = [
          +(g.rotation.x / D2R).toFixed(1),
          +(g.rotation.y / D2R).toFixed(1),
          +(g.rotation.z / D2R).toFixed(1)
        ]
        if (r[0] !== 0 || r[1] !== 0 || r[2] !== 0) out[name] = r
      }
      return out
    }

    const setPose = (pose: PoseRotations): void => {
      for (const [, g] of bonesRef.current) g.rotation.set(0, 0, 0)
      const next: PoseRotations = {}
      for (const [name, r] of Object.entries(pose)) {
        const g = bonesRef.current.get(name)
        if (!g) continue
        g.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R)
        next[name] = r
      }
      setAxes(next)
      onPoseChangeRef.current?.()
    }

    const exportPNG = (): string => {
      const renderer = rendererRef.current
      const scene = sceneRef.current
      const camera = cameraRef.current
      const tc = transformControlsRef.current
      const ground = groundRef.current
      const mats = materialsRef.current
      if (!renderer || !scene || !camera || !mats) return ''

      const controls = controlsRef.current
      if (controls) controls.enabled = false

      // 1. Esconde o Gizmo e o chão do render de exportação
      const tcHelper = tc?.getHelper()
      if (tcHelper) tcHelper.visible = false
      if (ground) ground.visible = false

      // 2. Uniformiza todos os materiais para CLAY neutro (sem laranja do osso selecionado)
      for (const mesh of pickablesRef.current) {
        const isJoint = Boolean(mesh.userData['isJoint'])
        mesh.material = isJoint ? mats.joint : mats.clay
      }

      // 3. Salva estado anterior de tela
      const prevBackground = scene.background
      const prevColor = renderer.getClearColor(new THREE.Color())
      const prevAlpha = renderer.getClearAlpha()
      const prevSize = new THREE.Vector2()
      renderer.getSize(prevSize)
      const prevPixelRatio = renderer.getPixelRatio()

      // 4. Configura renderização de captura limpa estilo VNCCS (1024x1024 no branco)
      scene.background = new THREE.Color(EXPORT_BG_COLOR)
      renderer.setClearColor(0xffffff, 1)
      const size = 1024
      renderer.setPixelRatio(1)
      renderer.setSize(size, size, false)
      camera.aspect = 1
      camera.updateProjectionMatrix()

      const prevPos = camera.position.clone()
      const prevTarget = controls ? controls.target.clone() : null
      camera.position.set(0, 0.95, 3.45)
      camera.lookAt(0, 0.95, 0)
      if (controls) controls.target.set(0, 0.95, 0)

      renderer.render(scene, camera)
      const data = renderer.domElement.toDataURL('image/png')

      // 5. Restaura tudo ao estado interativo
      if (tcHelper) tcHelper.visible = true
      if (ground) ground.visible = true

      // Restaura highlight do osso selecionado
      for (const mesh of pickablesRef.current) {
        const name = mesh.userData['boneName'] as string | undefined
        const isJoint = Boolean(mesh.userData['isJoint'])
        if (name === selected) {
          mesh.material = mats.selected
        } else {
          mesh.material = isJoint ? mats.joint : mats.clay
        }
      }

      scene.background = prevBackground
      renderer.setClearColor(prevColor, prevAlpha)
      renderer.setPixelRatio(prevPixelRatio)
      renderer.setSize(prevSize.x, prevSize.y, false)
      camera.aspect = prevSize.x / prevSize.y
      camera.position.copy(prevPos)
      if (controls && prevTarget) {
        controls.target.copy(prevTarget)
        controls.enabled = true
        controls.update()
      }
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)

      return data
    }

    useImperativeHandle(ref, () => ({ exportPNG, getPose, setPose }), [
      exportPNG,
      getPose,
      setPose
    ])

    const def = POSE_BONE_DEFS.find((d) => d.name === selected)
    const current = axes[selected] ?? [0, 0, 0]
    const limit = def?.limit ?? { x: [-180, 180], y: [-180, 180], z: [-180, 180] }
    const axisMeta: Array<keyof typeof limit> = ['x', 'y', 'z']
    const axisLabels = { x: 'Pitch (Curvar)', y: 'Yaw (Girar)', z: 'Roll (Inclinar)' }

    return (
      <div className="flex flex-col h-full gap-2 min-h-0 select-none">
        {/* Barra superior de Presets Rápidos */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted px-1 shrink-0 flex items-center gap-1">
            <Sparkles size={11} className="text-accent" /> Presets:
          </span>
          {POSE_PRESETS.map((p) => {
            const isSelected = activePreset === p.id
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className={`
                  px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all duration-150 shrink-0
                  ${
                    isSelected
                      ? 'bg-accent text-white shadow-sm shadow-accent/30 font-semibold'
                      : 'bg-surface-secondary hover:bg-surface-tertiary text-text-secondary hover:text-text-primary border border-border/60'
                  }
                `}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        {/* Viewport 3D do Tridimensional com Overlays */}
        <div className="relative flex-1 min-h-0 rounded-2xl overflow-hidden bg-surface border border-border shadow-inner">
          <div ref={containerRef} className="w-full h-full" />

          {/* Overlay Superior Esquerdo: Informação do Osso Selecionado */}
          <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface/85 backdrop-blur-md border border-border/70 text-xs shadow-md pointer-events-auto">
              <span className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse" />
              <span className="text-text-muted text-[11px]">Selecionado:</span>
              <span className="font-semibold text-text-primary text-[12px]">
                {def?.label ?? selected}
              </span>
            </div>
          </div>

          {/* Overlay Superior Direito: Controles de Câmera e Gizmo */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-surface/85 backdrop-blur-md border border-border/70 rounded-xl p-1 shadow-md">
            <button
              onClick={() => setCameraView('front')}
              className="px-2 py-1 rounded-lg text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
              title="Visão Frontal"
            >
              Frente
            </button>
            <button
              onClick={() => setCameraView('side')}
              className="px-2 py-1 rounded-lg text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
              title="Visão Lateral"
            >
              Lado
            </button>
            <button
              onClick={() => setCameraView('back')}
              className="px-2 py-1 rounded-lg text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
              title="Visão de Costas"
            >
              Costas
            </button>
            <div className="w-[1px] h-4 bg-border/80 mx-0.5" />
            <button
              onClick={() => setCameraView('focus')}
              className="p-1.5 rounded-lg text-text-secondary hover:text-accent hover:bg-surface transition-colors"
              title="Focar no osso selecionado"
            >
              <Crosshair size={13} />
            </button>
            <button
              onClick={toggleGizmoSpace}
              className={`px-2 py-1 rounded-lg text-[10px] uppercase font-bold tracking-wider transition-colors ${
                gizmoSpace === 'local'
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'bg-surface-tertiary text-text-muted'
              }`}
              title="Alternar entre rotação Local e Global"
            >
              {gizmoSpace}
            </button>
          </div>

          {/* Dica Flutuante Inferior */}
          <div className="absolute bottom-3 left-3 right-3 pointer-events-none flex justify-center">
            <div className="px-3 py-1 rounded-full bg-surface/80 backdrop-blur-md border border-border/50 text-[10px] text-text-muted text-center shadow-sm">
              🖱️ <strong className="text-text-secondary">Clique no osso</strong> para selecionar ·{' '}
              <strong className="text-text-secondary">Arraste os anéis coloridos</strong> para girar
              em 3D · <strong className="text-text-secondary">Arraste o fundo</strong> para orbitar
            </div>
          </div>
        </div>

        {/* Painel Inferior de Ajuste Fino */}
        <div className="rounded-2xl border border-border bg-surface-secondary p-3 space-y-3 shrink-0 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            {/* Seletor dropdown do osso */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">Ajustar osso:</span>
              <div className="relative">
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="appearance-none bg-surface border border-border rounded-xl px-3 py-1.5 pr-8 text-xs font-semibold text-text-primary focus:outline-none focus:border-accent cursor-pointer shadow-sm"
                >
                  {POSE_BONE_GROUPS.map((group) => (
                    <optgroup key={group.id} label={group.label}>
                      {group.bones.map((bName) => {
                        const boneDef = POSE_BONE_DEFS.find((d) => d.name === bName)
                        return (
                          <option key={bName} value={bName}>
                            {boneDef?.label ?? bName}
                          </option>
                        )
                      })}
                    </optgroup>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                />
              </div>
            </div>

            {/* Ações Rápidas */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleMirror}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-surface text-text-secondary hover:text-text-primary hover:border-text-muted border border-border transition-colors shadow-sm"
                title="Espelhar rotações entre lado esquerdo e direito"
              >
                <FlipHorizontal size={12} />
                <span>Espelhar E ↔ D</span>
              </button>
              <button
                onClick={() => resetBone(selected)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-surface text-text-secondary hover:text-text-primary hover:border-text-muted border border-border transition-colors shadow-sm"
                title="Resetar rotações do osso selecionado"
              >
                <RotateCcw size={12} />
                <span>Zerar osso</span>
              </button>
              <button
                onClick={resetPose}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-surface text-text-secondary hover:text-error hover:border-error/40 border border-border transition-colors shadow-sm"
                title="Zerar todos os ossos e voltar para pose padrão"
              >
                <span>Resetar pose</span>
              </button>
            </div>
          </div>

          {/* Sliders X, Y, Z com botões de passo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 border-t border-border/60">
            {axisMeta.map((axis, i) => {
              const [min, max] = limit[axis]
              const value = current[i]
              const axisColor =
                axis === 'x'
                  ? 'text-rose-400 accent-rose-500'
                  : axis === 'y'
                  ? 'text-emerald-400 accent-emerald-500'
                  : 'text-sky-400 accent-sky-500'

              return (
                <div
                  key={axis}
                  className="flex flex-col gap-1.5 p-2 rounded-xl bg-surface/60 border border-border/50"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 font-bold uppercase tracking-wider text-[11px]">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          axis === 'x'
                            ? 'bg-rose-500'
                            : axis === 'y'
                            ? 'bg-emerald-500'
                            : 'bg-sky-500'
                        }`}
                      />
                      <span className={axisColor}>{axis.toUpperCase()}</span>
                      <span className="text-[10px] text-text-muted font-normal lowercase">
                        ({axisLabels[axis].split(' ')[0]})
                      </span>
                    </span>
                    <span className="font-mono text-xs font-semibold text-text-primary px-1.5 py-0.5 rounded bg-surface border border-border/60">
                      {Math.round(value)}°
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => applyRotation(selected, i as 0 | 1 | 2, value - 5)}
                      className="w-6 h-6 rounded-lg bg-surface hover:bg-surface-tertiary text-text-secondary hover:text-text-primary text-[10px] font-bold flex items-center justify-center border border-border transition-colors"
                      title="Diminuir 5°"
                    >
                      -5°
                    </button>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={1}
                      value={value}
                      onChange={(e) =>
                        applyRotation(selected, i as 0 | 1 | 2, Number(e.target.value))
                      }
                      className={`flex-1 cursor-pointer h-1.5 bg-surface-tertiary rounded-lg ${axisColor}`}
                    />
                    <button
                      onClick={() => applyRotation(selected, i as 0 | 1 | 2, value + 5)}
                      className="w-6 h-6 rounded-lg bg-surface hover:bg-surface-tertiary text-text-secondary hover:text-text-primary text-[10px] font-bold flex items-center justify-center border border-border transition-colors"
                      title="Aumentar 5°"
                    >
                      +5°
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }
)