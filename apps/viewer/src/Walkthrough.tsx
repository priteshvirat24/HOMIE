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
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react'
import { loadTour, type TourRequest } from './api'
import type { PropertyTour } from './types'
import { isTouchDevice, useViewerStore } from './store'
import { RoomScene } from './scene/RoomScene'
import { TouchControls } from './ui/TouchControls'

function prettyType(t: string) {
  const s = t.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const icon = { size: 18, strokeWidth: 1.5, 'aria-hidden': true } as const

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

  // Show the controls hint once the room is on screen, then get out of the way.
  useEffect(() => {
    if (!splatReady) return
    setShowHelp(true)
    const t = setTimeout(() => setShowHelp(false), 7000)
    return () => clearTimeout(t)
  }, [roomId, splatReady])

  const walkable = tour?.rooms.filter((r) => r.scene) ?? []
  const current = walkable.find((r) => r.room_id === roomId) ?? walkable[0]
  const index = current ? walkable.indexOf(current) : -1

  if (error) {
    return (
      <div className="center">
        <h2>Can't open this 3D view</h2>
        <p>{error}</p>
        {onExit && (
          <button className="btn" onClick={onExit}>
            Back
          </button>
        )}
      </div>
    )
  }
  if (!tour) {
    return (
      <div className="center">
        <div className="spinner" />
        <p>Opening the house</p>
      </div>
    )
  }
  if (!current?.scene) {
    return (
      <div className="center">
        <h2>No 3D rooms yet</h2>
        <p>Photograph a room and wait for its build to finish, then come back.</p>
        {onExit && (
          <button className="btn" onClick={onExit}>
            Back
          </button>
        )}
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
          <button className="chip" onClick={requestReset} aria-label="Back to start position" title="Back to start position">
            <RotateCcw {...icon} />
          </button>
          {onExit && (
            <button className="chip" onClick={onExit} aria-label="Close walkthrough" title="Close">
              <X {...icon} />
            </button>
          )}
        </div>
      </div>

      {walkable.length > 1 && (
        <div className="rooms">
          <button className="chip" onClick={() => go(index - 1)} aria-label="Previous room">
            <ChevronLeft {...icon} />
          </button>
          <div className="room-list">
            {walkable.map((r) => (
              <button
                key={r.room_id}
                className={`room-chip ${r.room_id === current.room_id ? 'active' : ''}`}
                onClick={() => setRoomId(r.room_id)}
                aria-current={r.room_id === current.room_id ? 'true' : undefined}
              >
                <span className="lamp lamp-lit" aria-hidden />
                <span className="room-chip-text">
                  {r.name}
                  <small>{prettyType(r.room_type)}</small>
                </span>
              </button>
            ))}
            {pending.map((r) => (
              <span key={r.room_id} className="room-chip pending" title={`${r.name} is not ready yet`}>
                <span className={`lamp ${r.status === 'processing' ? 'lamp-live' : ''}`} aria-hidden />
                <span className="room-chip-text">
                  {r.name}
                  <small>{r.status === 'processing' ? 'Building' : 'No photos yet'}</small>
                </span>
              </span>
            ))}
          </div>
          <button className="chip" onClick={() => go(index + 1)} aria-label="Next room">
            <ChevronRight {...icon} />
          </button>
        </div>
      )}

      {showHelp && splatReady && (
        <div className="help" onClick={() => setShowHelp(false)}>
          {touch ? (
            <>
              <span>Left thumb to walk</span>
              <span className="help-sep" />
              <span>Right thumb to look around</span>
            </>
          ) : (
            <>
              <span className="keycaps">
                <kbd className="kbd">W</kbd>
                <kbd className="kbd">A</kbd>
                <kbd className="kbd">S</kbd>
                <kbd className="kbd">D</kbd>
              </span>
              <span>walk</span>
              <span className="help-sep" />
              <kbd className="kbd">Drag</kbd>
              <span>look around</span>
            </>
          )}
        </div>
      )}

      {splatError && (
        <div className="loading" role="alert">
          <Backdrop scene={current.scene} />
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
        <div className="loading" aria-live="polite">
          <Backdrop scene={current.scene} />
          <span className="loading-label">Stepping into</span>
          <h2 className="loading-room">{current.name}</h2>
          <div className="loading-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(splatProgress * 100)}>
            <div style={{ transform: `scaleX(${Math.max(0.02, splatProgress)})` }} />
          </div>
          <span className="loading-pct">{splatProgress > 0 ? `${Math.round(splatProgress * 100)}%` : 'Fetching the 3D room'}</span>
        </div>
      )}
    </>
  )
}

/** The room's panorama (or thumbnail), dimmed, behind the loading screen. */
function Backdrop({ scene }: { scene: PropertyTour['rooms'][number]['scene'] }) {
  const src = scene?.urls.panorama ?? scene?.urls.thumbnail
  if (!src) return null
  return <div className="loading-backdrop" style={{ backgroundImage: `url(${src})` }} aria-hidden />
}
