import { describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  buildRoom,
  createClient,
  MAX_PHOTOS,
  prettyRoomType,
  ROOM_TYPES,
  statusLabel,
  TERMINAL_JOB_STATUSES,
  thumbnailUrl,
} from './client'

type Call = { url: string; init: RequestInit }

function fakeFetch(responses: Array<{ status?: number; body?: unknown; text?: string }> = []) {
  const calls: Call[] = []
  let i = 0
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = responses[Math.min(i++, responses.length - 1)] ?? { status: 200, body: {} }
    const status = r.status ?? 200
    const text = r.text ?? (r.body === undefined ? '' : JSON.stringify(r.body))
    return new Response(status === 204 ? null : text, { status })
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

describe('createClient requests', () => {
  it('lists properties with GET and no JSON content-type', async () => {
    const { fn, calls } = fakeFetch([{ body: [] }])
    await createClient('', fn).properties.list()
    expect(calls[0].url).toBe('/api/v1/properties')
    expect(calls[0].init.method).toBeUndefined()
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('prefixes a base URL', async () => {
    const { fn, calls } = fakeFetch([{ body: [] }])
    await createClient('http://api:8000', fn).properties.list()
    expect(calls[0].url).toBe('http://api:8000/api/v1/properties')
  })

  it('creates a property with a JSON body', async () => {
    const { fn, calls } = fakeFetch([{ status: 201, body: { id: 'p1' } }])
    const p = await createClient('', fn).properties.create({ name: 'Home' })
    expect(p).toEqual({ id: 'p1' })
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ name: 'Home' })
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('creates a room under its house', async () => {
    const { fn, calls } = fakeFetch([{ status: 201, body: { id: 'r1' } }])
    await createClient('', fn).rooms.create('p1', { name: 'Kitchen', room_type: 'kitchen' })
    expect(calls[0].url).toBe('/api/v1/properties/p1/rooms')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ name: 'Kitchen', room_type: 'kitchen' })
  })

  it('returns undefined for 204 deletes', async () => {
    const { fn, calls } = fakeFetch([{ status: 204 }])
    await expect(createClient('', fn).rooms.remove('p1', 'r1')).resolves.toBeUndefined()
    expect(calls[0].init.method).toBe('DELETE')
  })

  it('uploads photos as multipart without forcing a content-type', async () => {
    const { fn, calls } = fakeFetch([{ status: 201, body: { id: 'f1' } }])
    const file = new File([new Uint8Array([1, 2, 3])], 'room.jpg', { type: 'image/jpeg' })
    await createClient('', fn).capture.upload('s1', file)
    expect(calls[0].url).toBe('/api/v1/capture-sessions/s1/photos')
    const body = calls[0].init.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect((body.get('file') as File).name).toBe('room.jpg')
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('latestForRoom returns the first job or null', async () => {
    const { fn, calls } = fakeFetch([{ body: [{ id: 'j2' }, { id: 'j1' }] }, { body: [] }])
    const c = createClient('', fn)
    expect(await c.jobs.latestForRoom('r1')).toEqual({ id: 'j2' })
    expect(await c.jobs.latestForRoom('r1')).toBeNull()
    expect(calls[0].url).toBe('/api/v1/reconstruction-jobs?room_id=r1&limit=1')
  })

  it.each([
    ['retry', '/api/v1/reconstruction-jobs/j1/retry'],
    ['cancel', '/api/v1/reconstruction-jobs/j1/cancel'],
  ] as const)('%s posts to %s', async (action, url) => {
    const { fn, calls } = fakeFetch([{ body: { id: 'j1' } }])
    await createClient('', fn).jobs[action]('j1')
    expect(calls[0]).toMatchObject({ url, init: { method: 'POST' } })
  })
})

describe('createClient errors', () => {
  it('uses FastAPI detail messages', async () => {
    const { fn } = fakeFetch([{ status: 404, body: { detail: 'Room not found' } }])
    await expect(createClient('', fn).rooms.get('p', 'r')).rejects.toMatchObject({ status: 404, message: 'Room not found' })
  })

  it('falls back to plain text bodies', async () => {
    const { fn } = fakeFetch([{ status: 500, text: 'Internal Server Error' }])
    await expect(createClient('', fn).properties.list()).rejects.toThrow('Internal Server Error')
  })

  it('falls back to a generic message for empty bodies', async () => {
    const { fn } = fakeFetch([{ status: 502, text: '' }])
    await expect(createClient('', fn).properties.list()).rejects.toThrow('Request failed (502)')
  })

  it('validation error arrays still produce a readable error', async () => {
    const { fn } = fakeFetch([{ status: 422, body: { detail: [{ msg: 'field required' }] } }])
    const err = await createClient('', fn).properties.create({ name: '' }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(422)
  })
})

describe('buildRoom', () => {
  const photo = (n: string) => new File([new Uint8Array([1])], n, { type: 'image/jpeg' })

  it('creates a session, uploads every photo, finalizes, and starts a job', async () => {
    const { fn, calls } = fakeFetch([
      { status: 201, body: { id: 's1' } },
      { status: 201, body: { id: 'f1' } },
      { status: 201, body: { id: 'f2' } },
      { body: { status: 'submitted' } },
      { status: 201, body: { id: 'j1', status: 'queued' } },
    ])
    const steps: string[] = []
    const job = await buildRoom(createClient('', fn), 'r1', [photo('a.jpg'), photo('b.jpg')], (s) => steps.push(s))
    expect(job).toEqual({ id: 'j1', status: 'queued' })
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v1/capture-sessions',
      '/api/v1/capture-sessions/s1/photos',
      '/api/v1/capture-sessions/s1/photos',
      '/api/v1/capture-sessions/s1/finalize',
      '/api/v1/reconstruction-jobs',
    ])
    expect(JSON.parse(String(calls[4].init.body))).toEqual({ capture_session_id: 's1' })
    expect(steps).toEqual(['Uploading photo 1 of 2…', 'Uploading photo 2 of 2…', 'Starting 3D generation…'])
  })

  it('rejects an empty photo list without calling the API', async () => {
    const { fn, calls } = fakeFetch()
    await expect(buildRoom(createClient('', fn), 'r1', [])).rejects.toThrow('Add at least one photo')
    expect(calls).toHaveLength(0)
  })

  it(`rejects more than ${MAX_PHOTOS} photos`, async () => {
    const { fn, calls } = fakeFetch()
    const files = Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => photo(`${i}.jpg`))
    await expect(buildRoom(createClient('', fn), 'r1', files)).rejects.toThrow(`at most ${MAX_PHOTOS}`)
    expect(calls).toHaveLength(0)
  })

  it('stops at the first failed upload', async () => {
    const { fn, calls } = fakeFetch([{ status: 201, body: { id: 's1' } }, { status: 415, body: { detail: 'Unsupported' } }])
    await expect(buildRoom(createClient('', fn), 'r1', [photo('a.jpg'), photo('b.jpg')])).rejects.toThrow('Unsupported')
    expect(calls).toHaveLength(2)
  })
})

describe('helpers', () => {
  it.each([
    ['living_room', 'Living room'],
    ['kitchen', 'Kitchen'],
    ['dining_room', 'Dining room'],
    ['other', 'Other'],
  ])('prettyRoomType(%s) = %s', (t, out) => expect(prettyRoomType(t)).toBe(out))

  it('room types match the API enum', () => {
    expect(ROOM_TYPES).toEqual([
      'living_room', 'bedroom', 'kitchen', 'bathroom', 'dining_room', 'hallway', 'balcony', 'office', 'garage', 'laundry', 'other',
    ])
  })

  it.each([
    [{ thumbnail_key: 'scenes/j/thumbnail.webp' }, '/api/v1/assets/scenes/j/thumbnail.webp'],
    [{ thumbnail_key: null }, null],
    [{}, null],
  ])('thumbnailUrl(%o)', (room, url) => expect(thumbnailUrl(room)).toBe(url))

  it.each([
    ['ready', 'Ready to walk'],
    ['processing', 'Building 3D…'],
    ['created', 'Not captured'],
    ['failed', 'Failed'],
    ['mystery', 'mystery'],
  ])('statusLabel(%s)', (s, label) => expect(statusLabel(s)).toBe(label))

  it('terminal job statuses', () => {
    expect([...TERMINAL_JOB_STATUSES].sort()).toEqual(['cancelled', 'failed', 'ready'])
  })
})
