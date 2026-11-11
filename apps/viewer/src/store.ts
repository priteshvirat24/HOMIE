import { create } from 'zustand'

/** Touch input from the on-screen joystick / look area, read every frame by the controller. */
export const touchInput = {
  move: { x: 0, y: 0 }, // x: strafe right, y: forward (both -1..1)
  lookDelta: { x: 0, y: 0 }, // accumulated pixels since last frame
}

interface ViewerState {
  splatProgress: number // 0..1 while downloading the current room's splat
  splatReady: boolean
  splatError: string | null
  resetToken: number
  setSplatProgress: (p: number) => void
  setSplatReady: (ready: boolean) => void
  setSplatError: (error: string | null) => void
  requestReset: () => void
}

export const useViewerStore = create<ViewerState>((set) => ({
  splatProgress: 0,
  splatReady: false,
  splatError: null,
  resetToken: 0,
  setSplatProgress: (splatProgress) => set({ splatProgress }),
  setSplatReady: (splatReady) => set({ splatReady }),
  setSplatError: (splatError) => set({ splatError }),
  requestReset: () => set((s) => ({ resetToken: s.resetToken + 1 })),
}))

export const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
