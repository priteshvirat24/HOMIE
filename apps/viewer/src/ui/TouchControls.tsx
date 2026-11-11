/**
 * Phone controls: drag anywhere on the left half to walk (a joystick appears under your thumb),
 * drag on the right half to look around.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { touchInput } from '../store'

const RADIUS = 56

export function TouchControls() {
  const moveId = useRef<number | null>(null)
  const lookId = useRef<number | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const lastLook = useRef({ x: 0, y: 0 })
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (e.clientX < window.innerWidth / 2 && moveId.current === null) {
      moveId.current = e.pointerId
      origin.current = { x: e.clientX, y: e.clientY }
      setStick({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 })
    } else if (lookId.current === null) {
      lookId.current = e.pointerId
      lastLook.current = { x: e.clientX, y: e.clientY }
    }
  }

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId === moveId.current) {
      let dx = e.clientX - origin.current.x
      let dy = e.clientY - origin.current.y
      const len = Math.hypot(dx, dy)
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS
        dy = (dy / len) * RADIUS
      }
      touchInput.move.x = dx / RADIUS
      touchInput.move.y = -dy / RADIUS
      setStick({ x: origin.current.x, y: origin.current.y, dx, dy })
    } else if (e.pointerId === lookId.current) {
      touchInput.lookDelta.x += (e.clientX - lastLook.current.x) * 1.1
      touchInput.lookDelta.y += (e.clientY - lastLook.current.y) * 1.1
      lastLook.current = { x: e.clientX, y: e.clientY }
    }
  }

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId === moveId.current) {
      moveId.current = null
      touchInput.move.x = touchInput.move.y = 0
      setStick(null)
    }
    if (e.pointerId === lookId.current) lookId.current = null
  }

  return (
    <div
      className="touch-layer"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {stick && (
        <div className="stick" style={{ left: stick.x - RADIUS, top: stick.y - RADIUS, width: RADIUS * 2, height: RADIUS * 2 }}>
          <div className="knob" style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }} />
        </div>
      )}
    </div>
  )
}
