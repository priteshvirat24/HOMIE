/** Visuals drawn in code: the room panorama, the shot guide and the empty floor plan. */
import { useState } from 'react'

/**
 * A room's 360° panorama turning slowly, as if you were standing in the room and looking around.
 * Two copies side by side so the loop is seamless; static when the viewer prefers less motion.
 */
export function Panorama({ src, fallback, alt }: { src?: string | null; fallback?: string | null; alt: string }) {
  const [broken, setBroken] = useState(false)
  const [fallbackBroken, setFallbackBroken] = useState(false)
  if (src && !broken) {
    return (
      <div className="pano" role="img" aria-label={alt}>
        <div className="pano-strip">
          <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
          <img src={src} alt="" draggable={false} aria-hidden />
        </div>
      </div>
    )
  }
  if (fallback && !fallbackBroken) {
    return (
      <div className="pano pano-still" role="img" aria-label={alt}>
        <img src={fallback} alt="" draggable={false} onError={() => setFallbackBroken(true)} />
      </div>
    )
  }
  return <div className="pano pano-empty" aria-hidden />
}

/**
 * Top-down sketch of how to shoot a room: stand in one spot and turn about 90° between photos.
 */
export function ShotGuide({ shots = 4, active = 0 }: { shots?: number; active?: number }) {
  const wedges = Array.from({ length: shots }, (_, i) => (i * 360) / shots)
  return (
    <svg className="shot-guide" viewBox="0 0 240 200" role="img" aria-label="Stand in the middle of the room and turn about 90 degrees between photos">
      {/* walls, with a door opening and its swing */}
      <path className="wall" d="M28 20 H212 V180 H130 M96 180 H28 V20" />
      <path className="swing" d="M96 180 A34 34 0 0 1 130 146" />
      <line className="swing" x1="130" y1="180" x2="130" y2="146" />
      {/* a bed and a sofa, so it reads as a room */}
      <rect className="furniture" x="150" y="34" width="46" height="62" rx="4" />
      <rect className="furniture" x="44" y="38" width="64" height="22" rx="4" />
      {wedges.map((deg, i) => (
        <g key={deg} transform={`rotate(${deg} 120 104)`}>
          <path className={`wedge ${i < active ? 'taken' : ''}`} d="M120 104 L96 52 A58 58 0 0 1 144 52 Z" />
          <text className="wedge-n" x="120" y="62" textAnchor="middle" transform={`rotate(${-deg} 120 62)`}>
            {i + 1}
          </text>
        </g>
      ))}
      <circle className="camera" cx="120" cy="104" r="6" />
    </svg>
  )
}

/** A small house plan with one lit room, for the moment before anything has been built. */
export function EmptyPlan() {
  return (
    <svg className="empty-plan" viewBox="0 0 360 220" aria-hidden>
      <rect className="room-lit" x="21" y="21" width="138" height="98" />
      <path className="wall" d="M20 20 H340 V200 H20 Z" />
      <path className="wall" d="M160 20 V96 M160 124 V200 M20 120 H120 M148 120 H160 M160 110 H250 M278 110 H340 M250 110 V200" />
      <path className="swing" d="M120 120 A28 28 0 0 1 148 92" />
      <path className="swing" d="M250 110 A28 28 0 0 0 278 138" />
      <rect className="furniture" x="40" y="40" width="60" height="22" rx="4" />
      <rect className="furniture" x="190" y="36" width="52" height="64" rx="4" />
      <rect className="furniture" x="270" y="140" width="50" height="40" rx="4" />
      <circle className="camera" cx="90" cy="78" r="5" />
    </svg>
  )
}
