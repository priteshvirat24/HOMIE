/**
 * FirstPersonController — WASD + touch joystick first-person camera.
 * Uses Rapier physics for collision detection.
 */

import { useRef, useEffect, useCallback } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RigidBody, CapsuleCollider } from '@react-three/rapier'
import * as THREE from 'three'
import { useViewerStore } from '../store/viewer'

const MOVE_SPEED = 4
const LOOK_SENSITIVITY = 0.003
const JOYSTICK_LOOK_SPEED = 2.5
const CHARACTER_HEIGHT = 1.7
const CHARACTER_RADIUS = 0.3
const CAPSULE_HALF = CHARACTER_HEIGHT / 2 - CHARACTER_RADIUS

const _forward = new THREE.Vector3()
const _right = new THREE.Vector3()
const _move = new THREE.Vector3()
const _euler = new THREE.Euler(0, 0, 0, 'YXZ')

interface Props {
  spawnPosition?: [number, number, number]
}

export function FirstPersonController({ spawnPosition = [0, 1.7, 0] }: Props) {
  const bodyRef = useRef<any>(null)
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
  const yaw = useRef(0)
  const pitch = useRef(0)

  const movementInput = useViewerStore((s) => s.movementInput)
  const lookInput = useViewerStore((s) => s.lookInput)

  // Initialize camera
  useEffect(() => {
    camera.position.set(...spawnPosition)
    camera.rotation.set(0, 0, 0)
  }, [camera, spawnPosition])

  // Keyboard input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keys.current.add(e.code)
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // Mouse look (pointer lock)
  useEffect(() => {
    const canvas = gl.domElement

    const onClick = () => {
      canvas.requestPointerLock?.()
    }

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      yaw.current -= e.movementX * LOOK_SENSITIVITY
      pitch.current -= e.movementY * LOOK_SENSITIVITY
      pitch.current = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, pitch.current))
    }

    canvas.addEventListener('click', onClick)
    document.addEventListener('mousemove', onMouseMove)
    return () => {
      canvas.removeEventListener('click', onClick)
      document.removeEventListener('mousemove', onMouseMove)
    }
  }, [gl])

  // Frame update: movement + camera
  useFrame((_, delta) => {
    const body = bodyRef.current
    if (!body) return

    const dt = Math.min(delta, 0.1)

    // Apply joystick look input
    if (lookInput.x !== 0 || lookInput.y !== 0) {
      yaw.current -= lookInput.x * JOYSTICK_LOOK_SPEED * dt
      pitch.current -= lookInput.y * JOYSTICK_LOOK_SPEED * dt
      pitch.current = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, pitch.current))
    }

    // Update camera rotation
    _euler.set(pitch.current, yaw.current, 0)
    camera.quaternion.setFromEuler(_euler)

    // Calculate movement direction
    _forward.set(0, 0, -1).applyQuaternion(camera.quaternion)
    _forward.y = 0
    _forward.normalize()

    _right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    _right.y = 0
    _right.normalize()

    _move.set(0, 0, 0)

    // Keyboard movement
    const k = keys.current
    if (k.has('KeyW') || k.has('ArrowUp')) _move.add(_forward)
    if (k.has('KeyS') || k.has('ArrowDown')) _move.sub(_forward)
    if (k.has('KeyD') || k.has('ArrowRight')) _move.add(_right)
    if (k.has('KeyA') || k.has('ArrowLeft')) _move.sub(_right)

    // Joystick movement
    if (movementInput.x !== 0 || movementInput.y !== 0) {
      _move.addScaledVector(_right, movementInput.x)
      _move.addScaledVector(_forward, -movementInput.y)
    }

    if (_move.lengthSq() > 0) {
      _move.normalize().multiplyScalar(MOVE_SPEED)
    }

    // Apply velocity via Rapier
    const currentVel = body.linvel()
    body.setLinvel({ x: _move.x, y: currentVel.y, z: _move.z }, true)

    // Update camera position from physics body
    const pos = body.translation()
    camera.position.set(pos.x, pos.y + CHARACTER_HEIGHT / 2, pos.z)
  })

  return (
    <RigidBody
      ref={bodyRef}
      position={spawnPosition}
      enabledRotations={[false, false, false]}
      linearDamping={0.5}
      mass={70}
      type="dynamic"
      lockRotations
    >
      <CapsuleCollider args={[CAPSULE_HALF, CHARACTER_RADIUS]} />
    </RigidBody>
  )
}
