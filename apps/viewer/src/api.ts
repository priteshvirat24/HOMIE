import type { PropertyTour, SceneManifest, TourRoom } from './types'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = text
    try {
      detail = JSON.parse(text).detail ?? text
    } catch {
      /* plain text */
    }
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export interface TourRequest {
  propertyId?: string | null
  roomId?: string | null
  sceneUrl?: string | null
}

/**
 * Loads what to show:
 *  - ?property=<id>[&room=<id>]  → whole-house tour starting at that room
 *  - ?room=<id>                  → a single room
 *  - ?scene=<.spz url>           → a bare splat file (for testing)
 */
export async function loadTour(req: TourRequest): Promise<PropertyTour> {
  if (req.propertyId) {
    return getJson<PropertyTour>(`/api/v1/properties/${req.propertyId}/tour`)
  }
  if (req.roomId) {
    const m = await getJson<{ room_id: string; manifest_data: SceneManifest }>(`/api/v1/scenes/${req.roomId}/manifest`)
    const room: TourRoom = { room_id: m.room_id, name: 'Room', room_type: 'other', status: 'ready', scene: m.manifest_data }
    return { property_id: '', name: '', rooms: [room] }
  }
  if (req.sceneUrl) {
    const scene: SceneManifest = {
      schemaVersion: 2,
      engine: 'file',
      representation: 'gaussian_splat',
      viewerSettings: { flipY: true },
      urls: { splat: req.sceneUrl },
    }
    return { property_id: '', name: '', rooms: [{ room_id: 'file', name: 'Scene', room_type: 'other', status: 'ready', scene }] }
  }
  throw new Error('Nothing to show — open the viewer with ?property=, ?room= or ?scene=')
}
