import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadTour } from './api'
import { isTouchDevice, touchInput, useViewerStore } from './store'

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('loadTour', () => {
  it('loads a whole-house tour', async () => {
    const tour = { property_id: 'p', name: 'Home', rooms: [] }
    const fn = stubFetch(200, tour)
    expect(await loadTour({ propertyId: 'p' })).toEqual(tour)
    expect(fn).toHaveBeenCalledWith('/api/v1/properties/p/tour')
  })

  it('property wins over room (room is just the starting point)', async () => {
    const fn = stubFetch(200, { property_id: 'p', name: '', rooms: [] })
    await loadTour({ propertyId: 'p', roomId: 'r' })
    expect(fn).toHaveBeenCalledWith('/api/v1/properties/p/tour')
  })

  it('wraps a single room manifest as a one-room tour', async () => {
    const manifest = { urls: { splat: '/a.spz' } }
    const fn = stubFetch(200, { room_id: 'r', manifest_data: manifest })
    const tour = await loadTour({ roomId: 'r' })
    expect(fn).toHaveBeenCalledWith('/api/v1/scenes/r/manifest')
    expect(tour.rooms).toHaveLength(1)
    expect(tour.rooms[0]).toMatchObject({ room_id: 'r', status: 'ready', scene: manifest })
  })

  it('builds a scene from a bare splat URL without fetching', async () => {
    const fn = stubFetch(200, {})
    const tour = await loadTour({ sceneUrl: 'https://x/world.spz' })
    expect(fn).not.toHaveBeenCalled()
    expect(tour.rooms[0].scene?.urls.splat).toBe('https://x/world.spz')
    expect(tour.rooms[0].scene?.viewerSettings?.flipY).toBe(true)
  })

  it('surfaces the API detail message', async () => {
    stubFetch(404, { detail: 'No 3D scene for this room yet' })
    await expect(loadTour({ roomId: 'r' })).rejects.toThrow('No 3D scene for this room yet')
  })

  it('fails clearly when nothing was requested', async () => {
    await expect(loadTour({})).rejects.toThrow(/property=, \?room= or \?scene=/)
  })
})

describe('viewer store', () => {
  it('starts not ready', () => {
    const s = useViewerStore.getState()
    expect(s.splatReady).toBe(false)
    expect(s.splatProgress).toBe(0)
  })

  it('tracks splat progress and readiness', () => {
    useViewerStore.getState().setSplatProgress(0.4)
    useViewerStore.getState().setSplatReady(true)
    expect(useViewerStore.getState()).toMatchObject({ splatProgress: 0.4, splatReady: true })
  })

  it('increments the reset token', () => {
    const before = useViewerStore.getState().resetToken
    useViewerStore.getState().requestReset()
    useViewerStore.getState().requestReset()
    expect(useViewerStore.getState().resetToken).toBe(before + 2)
  })

  it('touch input starts at rest', () => {
    expect(touchInput.move).toEqual({ x: 0, y: 0 })
    expect(touchInput.lookDelta).toEqual({ x: 0, y: 0 })
  })

  it('isTouchDevice is a boolean', () => {
    expect(typeof isTouchDevice()).toBe('boolean')
  })
})
