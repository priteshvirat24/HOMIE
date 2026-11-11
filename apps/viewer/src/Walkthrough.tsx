/**
 * HOMIE 3D walkthrough — walk through one room or a whole house.
 *
 * Opened by the mobile app in a WebView (served by the API at /viewer/):
 *   /viewer/?property=<id>&room=<id>   whole-house tour, starting in that room
 *   /viewer/?room=<id>                 single room
 *   /viewer/?scene=<url to .spz>       a bare splat file
 */
import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { loadTour, type TourRequest } from './api'
import type { PropertyTour } from './types'
import { isTouchDevice, useViewerStore } from './store'
import { RoomScene } from './scene/RoomScene'
import { TouchControls } from './ui/TouchControls'

function prettyType(t: string) {
  return t.replace(/_/g, ' ')
}

interface Props {
  request: TourRequest
  /** Shown as a close button in the top bar (web app); the phone app has its own. */
  onExit?: () => void
}

export function Walkthrough({ request, onExit }: Props) {
  const [tour, setTour] = useState<PropertyTour | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<string | null>(request.roomId ?? null)
  const [showHelp, setShowHelp] = useState(true)
  const splatReady = useViewerStore((s) => s.splatReady)
  const splatProgress = useViewerStore((s) => s.splatProgress)
  const splatError = useViewerStore((s) => s.splatError)
  const requestReset = useViewerStore((s) => s.requestReset)
  const touch = useMemo(isTouchDevice, [])

  useEffect(() => {
    setTour(null)
    setError(null)
    loadTour(request)
      .then(setTour)
      .catch((e: Error) => setError(e.message))
  }, [request.propertyId, request.roomId, request.sceneUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => setShowHelp(false), 6000)
    return () => clearTimeout(t)
  }, [roomId])

  const walkable = tour?.rooms.filter((r) => r.scene) ?? []
  const current = walkable.find((r) => r.room_id === roomId) ?? walkable[0]
  const index = current ? walkable.indexOf(current) : -1

  if (error) {
    return (
      <div className="center">
        <h2>Can't open this 3D view</h2>
        <p>{error}</p>
        {onExit && <button className="btn" onClick={onExit}>Back</button>}
      </div>
    )
  }
  if (!tour) {
    return (
      <div className="center">
        <div className="spinner" />
        <p>Loading…</p>
      </div>
    )
  }
  if (!current?.scene) {
    return (
      <div className="center">
        <h2>No 3D rooms yet</h2>
        <p>Capture a room and wait for it to finish processing, then come back.</p>
        {onExit && <button className="btn" onClick={onExit}>Back</button>}
      </div>
    )
  }

  const pending = tour.rooms.filter((r) => !r.scene)
  const go = (i: number) => setRoomId(walkable[(i + walkable.length) % walkable.length].room_id)

  return (
    <>
      <Canvas camera={{ fov: 75, near: 0.05, far: 500 }} gl={{ antialias: false }} dpr={[1, 2]}>
        <RoomScene key={current.room_id} roomKey={current.room_id} scene={current.scene} />
      </Canvas>

      {touch && <TouchControls />}

      <div className="hud-top">
        <div className="title">
          {tour.name && <span className="house">{tour.name}</span>}
          <span className="room">{current.name}</span>
        </div>
        <div className="hud-actions">
          <button className="chip" onClick={requestReset} aria-label="Back to start position">
            ↺
          </button>
          {onExit && (
            <button className="chip" onClick={onExit} aria-label="Close walkthrough">
              ✕
            </button>
          )}
        </div>
      </div>

      {walkable.length > 1 && (
        <div className="rooms">
          <button className="chip" onClick={() => go(index - 1)} aria-label="Previous room">
            ‹
          </button>
          <div className="room-list">
            {walkable.map((r) => (
              <button
                key={r.room_id}
                className={`room-chip ${r.room_id === current.room_id ? 'active' : ''}`}
                onClick={() => setRoomId(r.room_id)}
              >
                {r.name}
                <small>{prettyType(r.room_type)}</small>
              </button>
            ))}
            {pending.map((r) => (
              <span key={r.room_id} className="room-chip pending" title={`${r.name} is ${r.status}`}>
                {r.name}
                <small>{r.status === 'processing' ? 'processing…' : 'not captured'}</small>
              </span>
            ))}
          </div>
          <button className="chip" onClick={() => go(index + 1)} aria-label="Next room">
            ›
          </button>
        </div>
      )}

      {showHelp && splatReady && (
        <div className="help" onClick={() => setShowHelp(false)}>
          {touch ? 'Left thumb: walk · Right thumb: look around' : 'WASD to walk · drag (or double-click) to look'}
        </div>
      )}

      {splatError && (
        <div className="loading" role="alert">
          <h2>Couldn't load {current.name}</h2>
          <p>The 3D file for this room is missing or damaged. Rebuilding the room usually fixes it.</p>
          {walkable.length > 1 && (
            <button className="btn" onClick={() => go(index + 1)}>
              Go to the next room
            </button>
          )}
          {onExit && (
            <button className="btn" onClick={onExit}>
              Back
            </button>
          )}
        </div>
      )}

      {!splatReady && !splatError && (
        <div className="loading">
          <div className="spinner" />
          <p>Loading {current.name}… {splatProgress > 0 ? `${Math.round(splatProgress * 100)}%` : ''}</p>
        </div>
      )}
    </>
  )
}
