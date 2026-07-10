/**
 * TouchControls — Dual virtual joysticks for mobile first-person navigation.
 * Left joystick: movement (forward/back/strafe)
 * Right joystick: camera look
 */

import { useCallback, useRef } from 'react'
import { useViewerStore } from '../store/viewer'

const JOYSTICK_SIZE = 120
const KNOB_SIZE = 48
const DEAD_ZONE = 0.15

interface JoystickState {
  active: boolean
  touchId: number | null
  centerX: number
  centerY: number
  knobX: number
  knobY: number
}

function useJoystick(onMove: (x: number, y: number) => void) {
  const state = useRef<JoystickState>({
    active: false,
    touchId: null,
    centerX: 0,
    centerY: 0,
    knobX: 0,
    knobY: 0,
  })

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (state.current.active) return
    const touch = e.changedTouches[0]
    if (!touch) return

    state.current.active = true
    state.current.touchId = touch.identifier
    state.current.centerX = touch.clientX
    state.current.centerY = touch.clientY
    state.current.knobX = 0
    state.current.knobY = 0
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!state.current.active) return

    const touch = Array.from(e.changedTouches).find(
      (t) => t.identifier === state.current.touchId
    )
    if (!touch) return

    const maxRadius = JOYSTICK_SIZE / 2 - KNOB_SIZE / 2
    let dx = touch.clientX - state.current.centerX
    let dy = touch.clientY - state.current.centerY
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius
      dy = (dy / dist) * maxRadius
    }

    state.current.knobX = dx
    state.current.knobY = dy

    // Normalize to -1..1
    let nx = dx / maxRadius
    let ny = dy / maxRadius

    // Apply dead zone
    const mag = Math.sqrt(nx * nx + ny * ny)
    if (mag < DEAD_ZONE) {
      nx = 0
      ny = 0
    }

    onMove(nx, ny)
  }, [onMove])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const touch = Array.from(e.changedTouches).find(
      (t) => t.identifier === state.current.touchId
    )
    if (!touch) return

    state.current.active = false
    state.current.touchId = null
    state.current.knobX = 0
    state.current.knobY = 0
    onMove(0, 0)
  }, [onMove])

  return { onTouchStart, onTouchMove, onTouchEnd }
}

export function TouchControls() {
  const setMovementInput = useViewerStore((s) => s.setMovementInput)
  const setLookInput = useViewerStore((s) => s.setLookInput)

  const leftJoystick = useJoystick(setMovementInput)
  const rightJoystick = useJoystick(setLookInput)

  const joystickStyle: React.CSSProperties = {
    width: JOYSTICK_SIZE,
    height: JOYSTICK_SIZE,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.08)',
    border: '2px solid rgba(255, 255, 255, 0.15)',
    position: 'relative',
    touchAction: 'none',
    backdropFilter: 'blur(4px)',
  }

  const knobStyle: React.CSSProperties = {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.25)',
    border: '2px solid rgba(255, 255, 255, 0.4)',
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'space-between',
        padding: '0 24px 32px 24px',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {/* Left joystick — Movement */}
      <div
        style={{ ...joystickStyle, pointerEvents: 'auto' }}
        onTouchStart={leftJoystick.onTouchStart}
        onTouchMove={leftJoystick.onTouchMove}
        onTouchEnd={leftJoystick.onTouchEnd}
      >
        <div style={knobStyle} />
        <div style={{
          position: 'absolute', bottom: -20, left: '50%', transform: 'translateX(-50%)',
          fontSize: 10, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap',
        }}>
          MOVE
        </div>
      </div>

      {/* Right joystick — Look */}
      <div
        style={{ ...joystickStyle, pointerEvents: 'auto' }}
        onTouchStart={rightJoystick.onTouchStart}
        onTouchMove={rightJoystick.onTouchMove}
        onTouchEnd={rightJoystick.onTouchEnd}
      >
        <div style={knobStyle} />
        <div style={{
          position: 'absolute', bottom: -20, left: '50%', transform: 'translateX(-50%)',
          fontSize: 10, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap',
        }}>
          LOOK
        </div>
      </div>
    </div>
  )
}
