'use client'

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'

// Per-tab brand palettes. Each: [base, light, hot]. Pick by `theme` prop.
export const BRAIN_THEMES = {
  brand:     { c: ['#C79A2E', '#F1D27A', '#E7B43C'], label: 'Cadence Brain' }, // gold
  x:         { c: ['#15171A', '#6B7280', '#3A3F47'], label: 'X Brain' },        // ink
  linkedin:  { c: ['#0a66c2', '#70b5f9', '#378fe9'], label: 'LinkedIn Brain' }, // LI blue
  instagram: { c: ['#C13584', '#F58529', '#E1306C'], label: 'Instagram Brain' },// IG gradient
  tiktok:    { c: ['#0B8C8C', '#25F4EE', '#FE2C55'], label: 'TikTok Brain' },   // cyan/red
  campaigns: { c: ['#C79A2E', '#F1D27A', '#E7B43C'], label: 'Campaign Brain' }, // gold
}

// A decorative neural-network "brain" — a cloud of interconnected nodes that
// gently drifts and rotates. Purely visual, label-free, no data dependency.
function Network({ pal }) {
  const group = useRef()
  const [BASE, LIGHT, HOT] = pal

  const { nodes, edgeGeo, hot } = useMemo(() => {
    const N = 90
    const nodes = []
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random()
      const theta = u * Math.PI * 2, phi = Math.acos(2 * v - 1)
      const r = 2.0 + Math.random() * 0.9
      nodes.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * r * 1.25,
        Math.sin(phi) * Math.sin(theta) * r * 0.95,
        Math.cos(phi) * r * 1.0,
      ))
    }
    const positions = []
    const thresh = 1.5
    for (let i = 0; i < N; i++) {
      let links = 0
      for (let j = i + 1; j < N && links < 3; j++) {
        if (nodes[i].distanceTo(nodes[j]) < thresh) {
          positions.push(nodes[i].x, nodes[i].y, nodes[i].z, nodes[j].x, nodes[j].y, nodes[j].z)
          links++
        }
      }
    }
    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const hot = new Set()
    while (hot.size < 12) hot.add(Math.floor(Math.random() * N))
    return { nodes, edgeGeo, hot }
  }, [])

  useFrame((s) => {
    if (group.current) {
      group.current.rotation.y = s.clock.elapsedTime * 0.12
      group.current.rotation.x = Math.sin(s.clock.elapsedTime * 0.18) * 0.16
    }
  })

  return (
    <group ref={group}>
      <lineSegments geometry={edgeGeo}>
        <lineBasicMaterial color={LIGHT} transparent opacity={0.25} />
      </lineSegments>
      {nodes.map((p, i) => {
        const isHot = hot.has(i)
        return (
          <mesh key={i} position={p}>
            <icosahedronGeometry args={[isHot ? 0.085 : 0.052, 1]} />
            <meshStandardMaterial
              color={isHot ? HOT : BASE}
              emissive={isHot ? LIGHT : BASE}
              emissiveIntensity={isHot ? 1.5 : 0.6}
              roughness={0.35} metalness={0.1}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function Pulse({ color }) {
  const ref = useRef()
  useFrame((s) => { if (ref.current) ref.current.intensity = 0.65 + Math.sin(s.clock.elapsedTime * 1.2) * 0.2 })
  return <pointLight ref={ref} position={[3, 2, 4]} color={color} />
}

export default function BrainViz({ theme = 'linkedin' }) {
  const t = BRAIN_THEMES[theme] || BRAIN_THEMES.linkedin
  const [BASE, LIGHT] = t.c
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [0, 0, 8.5], fov: 48 }} dpr={[1, 2]} style={{ touchAction: 'none' }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.9} />
        <Pulse color={LIGHT} />
        <pointLight position={[-4, -3, -4]} intensity={0.4} color={LIGHT} />
        <Network pal={t.c} />
        <OrbitControls enablePan={false} enableZoom autoRotate autoRotateSpeed={0.5} minDistance={5} maxDistance={13} />
      </Canvas>
      {/* clean floating label, tinted to the tab */}
      <div style={{
        position: 'absolute', top: 12, left: 12, display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '5px 12px', borderRadius: 20, pointerEvents: 'none',
        background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(8px)',
        border: `1px solid ${BASE}2e`, color: BASE, fontWeight: 600, fontSize: 12,
        boxShadow: `0 4px 16px -8px ${BASE}66`,
      }}>
        {t.label}
      </div>
      <div style={{ position: 'absolute', bottom: 10, right: 12, fontSize: 10.5, color: 'rgba(20,24,30,0.35)', pointerEvents: 'none' }}>drag to orbit</div>
    </div>
  )
}
