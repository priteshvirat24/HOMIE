/** Browser client for the HOMIE API (same origin: the API serves this app at /viewer/). */

export interface Property {
  id: string
  name: string
  address?: string | null
  notes?: string | null
  room_count: number
  created_at: string
  updated_at: string
}

export interface Room {
  id: string
  property_id: string
  name: string
  room_type: string
  status: string
  notes?: string | null
  thumbnail_key?: string | null
  created_at: string
  updated_at: string
}

export interface CaptureSession {
  id: string
  room_id: string
  status: string
  frame_count: number
  accepted_count: number
}

export interface Job {
  id: string
  capture_session_id: string
  engine: string
  status: string
  progress: number
  current_message?: string | null
  error_message?: string | null
  retry_count: number
  created_at: string
}

export const ROOM_TYPES = [
  'living_room',
  'bedroom',
  'kitchen',
  'bathroom',
  'dining_room',
  'hallway',
  'balcony',
  'office',
  'garage',
  'laundry',
  'other',
] as const

export const MAX_PHOTOS = 8
export const TERMINAL_JOB_STATUSES = new Set(['ready', 'failed', 'cancelled'])

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Fetch = typeof fetch

export function createClient(base = '', fetchImpl: Fetch = (...a) => fetch(...a)) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...(isForm || !init?.body ? {} : { 'Content-Type': 'application/json' }), ...init?.headers },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let detail: unknown = text
      try {
        detail = JSON.parse(text).detail ?? text
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, typeof detail === 'string' && detail ? detail : `Request failed (${res.status})`)
    }
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  return {
    properties: {
      list: () => request<Property[]>('/api/v1/properties'),
      get: (id: string) => request<Property>(`/api/v1/properties/${id}`),
      create: (data: { name: string; address?: string }) => request<Property>('/api/v1/properties', json('POST', data)),
      remove: (id: string) => request<void>(`/api/v1/properties/${id}`, { method: 'DELETE' }),
    },
    rooms: {
      list: (propertyId: string) => request<Room[]>(`/api/v1/properties/${propertyId}/rooms`),
      get: (propertyId: string, roomId: string) => request<Room>(`/api/v1/properties/${propertyId}/rooms/${roomId}`),
      create: (propertyId: string, data: { name: string; room_type: string }) =>
        request<Room>(`/api/v1/properties/${propertyId}/rooms`, json('POST', data)),
      remove: (propertyId: string, roomId: string) =>
        request<void>(`/api/v1/properties/${propertyId}/rooms/${roomId}`, { method: 'DELETE' }),
    },
    capture: {
      create: (roomId: string) => request<CaptureSession>('/api/v1/capture-sessions', json('POST', { room_id: roomId })),
      upload: (sessionId: string, file: File | Blob, filename = 'photo.jpg') => {
        const form = new FormData()
        form.append('file', file, (file as File).name ?? filename)
        return request<{ id: string }>(`/api/v1/capture-sessions/${sessionId}/photos`, { method: 'POST', body: form })
      },
      finalize: (sessionId: string) =>
        request<{ status: string }>(`/api/v1/capture-sessions/${sessionId}/finalize`, { method: 'POST' }),
    },
    jobs: {
      create: (captureSessionId: string) =>
        request<Job>('/api/v1/reconstruction-jobs', json('POST', { capture_session_id: captureSessionId })),
      get: (jobId: string) => request<Job>(`/api/v1/reconstruction-jobs/${jobId}`),
      latestForRoom: async (roomId: string) =>
        (await request<Job[]>(`/api/v1/reconstruction-jobs?room_id=${roomId}&limit=1`))[0] ?? null,
      retry: (jobId: string) => request<Job>(`/api/v1/reconstruction-jobs/${jobId}/retry`, { method: 'POST' }),
      cancel: (jobId: string) => request<Job>(`/api/v1/reconstruction-jobs/${jobId}/cancel`, { method: 'POST' }),
    },
  }
}

export type Client = ReturnType<typeof createClient>
export const api = createClient()

/** Upload photos and start a reconstruction. Reports each step through onStep. */
export async function buildRoom(
  client: Client,
  roomId: string,
  files: File[],
  onStep: (message: string) => void = () => {},
): Promise<Job> {
  if (files.length === 0) throw new Error('Add at least one photo')
  if (files.length > MAX_PHOTOS) throw new Error(`Use at most ${MAX_PHOTOS} photos per room`)
  const session = await client.capture.create(roomId)
  for (let i = 0; i < files.length; i++) {
    onStep(`Uploading photo ${i + 1} of ${files.length}…`)
    await client.capture.upload(session.id, files[i])
  }
  onStep('Starting 3D generation…')
  await client.capture.finalize(session.id)
  return client.jobs.create(session.id)
}

export function prettyRoomType(t: string): string {
  const s = t.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function thumbnailUrl(room: Pick<Room, 'thumbnail_key'>): string | null {
  return room.thumbnail_key ? `/api/v1/assets/${room.thumbnail_key}` : null
}

export function statusLabel(status: string): string {
  return (
    {
      created: 'Not captured',
      capturing: 'Capturing',
      captured: 'Photos ready',
      uploading: 'Uploading',
      uploaded: 'Uploaded',
      processing: 'Building 3D…',
      ready: 'Ready to walk',
      failed: 'Failed',
    } as Record<string, string>
  )[status] ?? status
}
