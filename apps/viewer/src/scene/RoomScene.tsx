/**
 * One room: splat + collider + floor + first-person walker + panorama backdrop.
 * Composition follows image-blaster's WorldViewer (MIT, (c) 2026 Neilson Koerner-Safrata).
 */
import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import type { SceneManifest } from '../types'
import { isTouchDevice, useViewerStore } from '../store'
import { SplatRenderer } from './SplatRenderer'
import { WorldCollider } from './WorldCollider'
import { CharacterController, type CharacterHandle } from './CharacterController'

class Optional extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn(`Skipping optional asset ${this.props.label}`, error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function Panorama({ url }: { url: string }) {
  const texture = useLoader(THREE.TextureLoader, url)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.SRGBColorSpace
    scene.background = texture
    scene.backgroundBlurriness = 0.6
    scene.backgroundIntensity = 0.6
    scene.backgroundRotation = new THREE.Euler(0, Math.PI / 2, 0)
    return () => {
      if (scene.background === texture) scene.background = null
    }
  }, [texture, scene])
  return null
}

function Floor() {
  return (
    <>
      <RigidBody type="fixed">
        <CuboidCollider args={[100, 0.05, 100]} position={[0, -0.05, 0]} />
      </RigidBody>
      <RigidBody type="fixed" position={[0, -10, 0]}>
        <CuboidCollider args={[100, 1, 100]} />
      </RigidBody>
    </>
  )
}

export function RoomScene({ scene, roomKey }: { scene: SceneManifest; roomKey: string }) {
  const character = useRef<CharacterHandle>(null)
  const resetToken = useViewerStore((s) => s.resetToken)
  const settings = scene.viewerSettings ?? {}
  const flipY = settings.flipY ?? true
  const groundPlaneOffset = settings.groundPlaneOffset ?? 0
  const metricScaleFactor = settings.metricScaleFactor ?? 1
  const splatUrl = (isTouchDevice() ? scene.urls.splat_mobile : null) ?? scene.urls.splat

  useEffect(() => {
    if (resetToken > 0) character.current?.reset()
  }, [resetToken])

  return (
    <>
      <Physics key={roomKey} gravity={[0, -9.81, 0]}>
        <CharacterController ref={character} />
        {scene.urls.collider && (
          <Optional label="collider">
            <Suspense fallback={null}>
              <WorldCollider
                url={scene.urls.collider}
                flipY={flipY}
                groundPlaneOffset={groundPlaneOffset}
                metricScaleFactor={metricScaleFactor}
              />
            </Suspense>
          </Optional>
        )}
        <Floor />
      </Physics>
      {splatUrl && (
        <SplatRenderer
          url={splatUrl}
          flipY={flipY}
          groundPlaneOffset={groundPlaneOffset}
          metricScaleFactor={metricScaleFactor}
        />
      )}
      {scene.urls.panorama && (
        <Optional label="panorama">
          <Suspense fallback={null}>
            <Panorama url={scene.urls.panorama} />
          </Suspense>
        </Optional>
      )}
    </>
  )
}
