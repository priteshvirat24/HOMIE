/**
 * Invisible collision mesh from World Labs, so you can't walk through walls and furniture.
 * Adapted from image-blaster (app/src/modules/collider/WorldCollider.tsx, MIT, (c) 2026 Neilson Koerner-Safrata):
 * same transform as the splat, trimesh collider, render/debug materials removed.
 */
import { useMemo } from 'react'
import { RigidBody } from '@react-three/rapier'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

interface Props {
  url: string
  flipY: boolean
  groundPlaneOffset: number
  metricScaleFactor: number
}

const hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
const ignoreRaycast: THREE.Object3D['raycast'] = () => {}

export function WorldCollider({ url, flipY, groundPlaneOffset, metricScaleFactor }: Props) {
  const { scene: raw } = useGLTF(url)
  const scene = useMemo(() => {
    const s = raw.clone(true)
    s.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = hidden
        child.raycast = ignoreRaycast
      }
    })
    return s
  }, [raw])

  return (
    <RigidBody
      key={`${url}:${flipY}:${groundPlaneOffset}:${metricScaleFactor}`}
      type="fixed"
      colliders="trimesh"
      rotation={[flipY ? Math.PI : 0, 0, 0]}
      position={[0, groundPlaneOffset, 0]}
      scale={[metricScaleFactor, metricScaleFactor, metricScaleFactor]}
    >
      <primitive object={scene} />
    </RigidBody>
  )
}
