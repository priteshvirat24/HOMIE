/** Scene manifest as returned by the API (storage keys already resolved to URLs). */
export interface SceneManifest {
  schemaVersion: number
  engine: string
  representation: string
  worldId?: string
  marbleUrl?: string
  caption?: string
  viewerSettings?: {
    metricScaleFactor?: number
    groundPlaneOffset?: number
    flipY?: boolean
  }
  urls: {
    splat?: string | null
    splat_mobile?: string | null
    collider?: string | null
    panorama?: string | null
    thumbnail?: string | null
  }
}

export interface TourRoom {
  room_id: string
  name: string
  room_type: string
  status: string
  scene: SceneManifest | null
}

export interface PropertyTour {
  property_id: string
  name: string
  rooms: TourRoom[]
}
