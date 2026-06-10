'use client'

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'

// LinkedIn palette
const LI       = '#0a66c2'  // LinkedIn blue
const LI_LIGHT = '#70b5f9'
const LI_HOT   = '#378fe9'

// A decorative neural-network "brain" — a cloud of interconnected nodes that
// gently drifts and rotates. Purely visual, label-free, no data dependency.
function Network() {
  const group = useRef()

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
        <lineBasicMaterial color={LI_LIGHT} transparent opacity={0.25} />
      </lineSegments>
      {nodes.map((p, i) => {
        const isHot = hot.has(i)
        return (
          <mesh key={i} position={p}>
            <icosahedronGeometry args={[isHot ? 0.085 : 0.052, 1]} />
            <meshStandardMaterial
              color={isHot ? LI_HOT : LI}
              emissive={isHot ? LI_LIGHT : LI}
              emissiveIntensity={isHot ? 1.5 : 0.6}
              roughness={0.35} metalness={0.1}
            />
          </mesh>
        )
      })}
    </group>
  )
}

function Pulse() {
  const ref = useRef()
  useFrame((s) => { if (ref.current) ref.current.intensity = 0.65 + Math.sin(s.clock.elapsedTime * 1.2) * 0.2 })
  return <pointLight ref={ref} position={[3, 2, 4]} color={LI_LIGHT} />
}

function LinkedInMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.74v20.52C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.74V1.74C24 .78 23.2 0 22.22 0z"/></svg>
  )
}

export default function BrainViz() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [0, 0, 8.5], fov: 48 }} dpr={[1, 2]} style={{ touchAction: 'none' }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.9} />
        <Pulse />
        <pointLight position={[-4, -3, -4]} intensity={0.4} color={LI_LIGHT} />
        <Network />
        <OrbitControls enablePan={false} enableZoom autoRotate autoRotateSpeed={0.5} minDistance={5} maxDistance={13} />
      </Canvas>
      {/* clean floating label */}
      <div style={{
        position: 'absolute', top: 12, left: 12, display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '5px 11px 5px 9px', borderRadius: 20, pointerEvents: 'none',
        background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(10,102,194,0.18)', color: LI, fontWeight: 600, fontSize: 12,
        boxShadow: '0 4px 16px -8px rgba(10,102,194,0.4)',
      }}>
        <LinkedInMark /> LinkedIn Brain
      </div>
      <div style={{ position: 'absolute', bottom: 10, right: 12, fontSize: 10.5, color: 'rgba(20,24,30,0.35)', pointerEvents: 'none' }}>drag to orbit</div>
    </div>
  )
}
