/**
 * SceneViewer — Renders the 3D scene with splat, collider, and character controller.
 */

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useViewerStore, type SceneManifest } from '../store/viewer'
import { FirstPersonController } from './FirstPersonController'

interface Props {
  sceneUrl: string
  manifest: SceneManifest | null
}

export function SceneViewer({ sceneUrl, manifest }: Props) {
  const setLoading = useViewerStore((s) => s.setLoading)
  const { scene } = useThree()

  const settings = manifest?.viewerSettings ?? {
    metricScaleFactor: 1,
    groundPlaneOffset: 0,
    flipY: true,
  }

  useEffect(() => {
    // Scene loaded
    setLoading(false)
  }, [sceneUrl, setLoading])

  return (
    <>
      {/* Environment lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />

      {/* Ground plane for physics */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, settings.groundPlaneOffset ?? 0, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#1a1a1a" transparent opacity={0.3} />
      </mesh>

      {/* First-person character controller */}
      <FirstPersonController
        spawnPosition={[0, (settings.groundPlaneOffset ?? 0) + 1.7, 0]}
      />

      {/* TODO: SplatRenderer integration once SparkJS is installed */}
      {/* TODO: WorldCollider GLB loading */}
    </>
  )
}
