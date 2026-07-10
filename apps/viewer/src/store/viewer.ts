/**
 * Viewer Zustand store — manages scene state and viewer settings.
 */

import { create } from 'zustand'

export interface SceneManifest {
  schemaVersion: number
  sceneId: string
  engine: string
  representation: string
  artifacts: {
    splat?: string | null
    colliderMesh?: string | null
    panorama?: string | null
    thumbnail?: string | null
  }
  viewerSettings?: {
    metricScaleFactor?: number
    groundPlaneOffset?: number
    flipY?: boolean
  }
  caption?: string
}

interface ViewerState {
  sceneUrl: string | null
  manifest: SceneManifest | null
  isLoading: boolean
  fps: number
  quality: 'low' | 'medium' | 'high'
  showDebug: boolean
  movementInput: { x: number; y: number }
  lookInput: { x: number; y: number }

  setScene: (url: string, manifest: SceneManifest | null) => void
  setLoading: (loading: boolean) => void
  setFps: (fps: number) => void
  setQuality: (quality: 'low' | 'medium' | 'high') => void
  toggleDebug: () => void
  setMovementInput: (x: number, y: number) => void
  setLookInput: (x: number, y: number) => void
}

export const useViewerStore = create<ViewerState>((set) => ({
  sceneUrl: null,
  manifest: null,
  isLoading: false,
  fps: 0,
  quality: 'medium',
  showDebug: false,
  movementInput: { x: 0, y: 0 },
  lookInput: { x: 0, y: 0 },

  setScene: (url, manifest) => set({ sceneUrl: url, manifest, isLoading: true }),
  setLoading: (loading) => set({ isLoading: loading }),
  setFps: (fps) => set({ fps }),
  setQuality: (quality) => set({ quality }),
  toggleDebug: () => set((s) => ({ showDebug: !s.showDebug })),
  setMovementInput: (x, y) => set({ movementInput: { x, y } }),
  setLookInput: (x, y) => set({ lookInput: { x, y } }),
}))
