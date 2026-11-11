/**
 * First-person walker: capsule rigid body + camera at eye height.
 * Adapted from image-blaster (app/src/modules/character/CharacterController.tsx + spawn.ts,
 * MIT, (c) 2026 Neilson Koerner-Safrata). Touch input comes from the on-screen joystick (store.touchInput)
 * instead of half-screen splits; mouse drag / pointer lock and WASD on desktop.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { touchInput } from '../store'

export const CHARACTER_HEIGHT = 1.6
const CAMERA_EYE_OFFSET = CHARACTER_HEIGHT / 2
const RADIUS = 0.25
const HALF_SEGMENT = CHARACTER_HEIGHT / 2 - RADIUS
const SPEED = 2.2 // walking pace indoors, m/s
const LOOK_SENSITIVITY = 0.0035
const SMOOTHING = 0.18

export interface CharacterHandle {
  reset: () => void
}

const _forward = new THREE.Vector3()
const _right = new THREE.Vector3()
const _move = new THREE.Vector3()
const _euler = new THREE.Euler(0, 0, 0, 'YXZ')

// The splat is shifted by World Labs' ground_plane_offset so the room's floor sits at y = 0.
const SPAWN = { x: 0, y: CHARACTER_HEIGHT / 2 + 0.25, z: -0.5 }

export const CharacterController = forwardRef<CharacterHandle>(function CharacterController(_, ref) {
  const body = useRef<RapierRigidBody>(null)
  const { camera, gl } = useThree()
  const keys = useRef(new Set<string>())
  const yaw = useRef(0)
  const pitch = useRef(0)
  const smoothYaw = useRef(0)
  const smoothPitch = useRef(0)

  useImperativeHandle(ref, () => ({
    reset: () => {
      body.current?.setTranslation(SPAWN, true)
      body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true)
      yaw.current = pitch.current = smoothYaw.current = smoothPitch.current = 0
    },
  }))

  useEffect(() => {
    const el = gl.domElement
    const onKey = (e: KeyboardEvent) => {
      if (e.type === 'keydown') keys.current.add(e.code)
      else keys.current.delete(e.code)
    }
    let dragging = false
    let last = { x: 0, y: 0 }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return // touch look is handled by the overlay
      dragging = true
      last = { x: e.clientX, y: e.clientY }
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const locked = document.pointerLockElement === el
      if (!dragging && !locked) return
      const dx = locked ? e.movementX : e.clientX - last.x
      const dy = locked ? e.movementY : e.clientY - last.y
      last = { x: e.clientX, y: e.clientY }
      touchInput.lookDelta.x += dx
      touchInput.lookDelta.y += dy
    }
    const onUp = () => (dragging = false)
    const onDbl = () => el.requestPointerLock?.()
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('dblclick', onDbl)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('dblclick', onDbl)
    }
  }, [gl.domElement])

  useFrame((_, delta) => {
    const b = body.current
    if (!b) return

    yaw.current -= touchInput.lookDelta.x * LOOK_SENSITIVITY
    pitch.current -= touchInput.lookDelta.y * LOOK_SENSITIVITY
    pitch.current = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch.current))
    touchInput.lookDelta.x = touchInput.lookDelta.y = 0

    const k = 1 - Math.pow(1 - SMOOTHING, delta * 60)
    smoothYaw.current += (yaw.current - smoothYaw.current) * k
    smoothPitch.current += (pitch.current - smoothPitch.current) * k
    camera.quaternion.setFromEuler(_euler.set(smoothPitch.current, smoothYaw.current, 0))

    let fwd = touchInput.move.y
    let strafe = touchInput.move.x
    const kk = keys.current
    if (kk.has('KeyW') || kk.has('ArrowUp')) fwd += 1
    if (kk.has('KeyS') || kk.has('ArrowDown')) fwd -= 1
    if (kk.has('KeyA') || kk.has('ArrowLeft')) strafe -= 1
    if (kk.has('KeyD') || kk.has('ArrowRight')) strafe += 1

    _forward.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize()
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize()
    _move.set(0, 0, 0).addScaledVector(_forward, fwd).addScaledVector(_right, strafe)
    if (_move.lengthSq() > 1) _move.normalize()

    const v = b.linvel()
    b.setLinvel({ x: _move.x * SPEED, y: v.y, z: _move.z * SPEED }, true)

    const p = b.translation()
    if (p.y < -5) {
      // fell through a hole in the collider — put the visitor back
      b.setTranslation(SPAWN, true)
      b.setLinvel({ x: 0, y: 0, z: 0 }, true)
    }
    camera.position.set(p.x, p.y + CAMERA_EYE_OFFSET, p.z)
  })

  return (
    <RigidBody ref={body} position={[SPAWN.x, SPAWN.y, SPAWN.z]} enabledRotations={[false, false, false]} linearDamping={0}>
      <CapsuleCollider args={[HALF_SEGMENT, RADIUS]} />
    </RigidBody>
  )
})
