/* API client for HOMIE backend */

// On a real phone this must be your computer's LAN address, e.g. http://192.168.1.20:8000 (set in .env).
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

/** URL of the 3D walkthrough (served by the API). With a propertyId it is a whole-house tour. */
export function walkthroughUrl(opts: { propertyId?: string; roomId?: string }): string {
  const q = new URLSearchParams();
  if (opts.propertyId) q.set('property', opts.propertyId);
  if (opts.roomId) q.set('room', opts.roomId);
  return `${API_URL}/viewer/?${q.toString()}`;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;
  const isForm = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const res = await fetch(url, {
    ...options,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    let detail = body;
    try { detail = JSON.parse(body).detail ?? body; } catch { /* not JSON */ }
    throw new ApiError(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail) || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Properties ──────────────────────────────────────────────
export const propertiesApi = {
  list: () => request<Property[]>('/api/v1/properties'),
  get: (id: string) => request<Property>(`/api/v1/properties/${id}`),
  create: (data: { name: string; address?: string; notes?: string }) =>
    request<Property>('/api/v1/properties', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; address: string; notes: string }>) =>
    request<Property>(`/api/v1/properties/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/api/v1/properties/${id}`, { method: 'DELETE' }),
};

// ── Rooms ────────────────────────────────────────────────────
export const roomsApi = {
  list: (propertyId: string) => request<Room[]>(`/api/v1/properties/${propertyId}/rooms`),
  get: (propertyId: string, roomId: string) =>
    request<Room>(`/api/v1/properties/${propertyId}/rooms/${roomId}`),
  create: (propertyId: string, data: { name: string; room_type?: string; notes?: string }) =>
    request<Room>(`/api/v1/properties/${propertyId}/rooms`, { method: 'POST', body: JSON.stringify(data) }),
  update: (propertyId: string, roomId: string, data: Partial<{ name: string; room_type: string }>) =>
    request<Room>(`/api/v1/properties/${propertyId}/rooms/${roomId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (propertyId: string, roomId: string) =>
    request<void>(`/api/v1/properties/${propertyId}/rooms/${roomId}`, { method: 'DELETE' }),
};

// ── Capture Sessions ─────────────────────────────────────────
export const MAX_PHOTOS_PER_ROOM = 8;

export const captureApi = {
  create: (roomId: string) =>
    request<CaptureSession>('/api/v1/capture-sessions', {
      method: 'POST',
      body: JSON.stringify({ room_id: roomId }),
    }),
  get: (sessionId: string) => request<CaptureSession>(`/api/v1/capture-sessions/${sessionId}`),
  /** Upload one photo (local file URI from the camera or gallery). */
  uploadPhoto: (sessionId: string, uri: string, mimeType = 'image/jpeg') => {
    const name = uri.split('/').pop() || 'photo.jpg';
    const form = new FormData();
    // React Native's FormData accepts { uri, name, type } for files
    form.append('file', { uri, name, type: mimeType } as unknown as Blob);
    return request<CaptureFrame>(`/api/v1/capture-sessions/${sessionId}/photos`, { method: 'POST', body: form });
  },
  listFrames: (sessionId: string) =>
    request<CaptureFrame[]>(`/api/v1/capture-sessions/${sessionId}/frames`),
  finalize: (sessionId: string, selectedFrameId?: string) =>
    request<{ status: string }>(
      `/api/v1/capture-sessions/${sessionId}/finalize${selectedFrameId ? '?selected_frame_id=' + selectedFrameId : ''}`,
      { method: 'POST' }
    ),
};

// ── Reconstruction ───────────────────────────────────────────
export const reconstructionApi = {
  create: (captureSessionId: string, engine = 'image_blaster') =>
    request<ReconstructionJob>('/api/v1/reconstruction-jobs', {
      method: 'POST',
      body: JSON.stringify({ capture_session_id: captureSessionId, engine }),
    }),
  get: (jobId: string) => request<ReconstructionJob>(`/api/v1/reconstruction-jobs/${jobId}`),
  latestForRoom: async (roomId: string) =>
    (await request<ReconstructionJob[]>(`/api/v1/reconstruction-jobs?room_id=${roomId}&limit=1`))[0] ?? null,
  progress: (jobId: string) => request<JobProgress>(`/api/v1/reconstruction-jobs/${jobId}/progress`),
  retry: (jobId: string) =>
    request<ReconstructionJob>(`/api/v1/reconstruction-jobs/${jobId}/retry`, { method: 'POST' }),
  cancel: (jobId: string) =>
    request<ReconstructionJob>(`/api/v1/reconstruction-jobs/${jobId}/cancel`, { method: 'POST' }),
};

// ── Scene ────────────────────────────────────────────────────
export const sceneApi = {
  getManifest: (roomId: string) => request<SceneManifest>(`/api/v1/scenes/${roomId}/manifest`),
  tour: (propertyId: string) => request<PropertyTour>(`/api/v1/properties/${propertyId}/tour`),
};

// ── Types ────────────────────────────────────────────────────
export interface Property {
  id: string; name: string; address?: string; notes?: string; room_count: number; created_at: string; updated_at: string;
}
export interface Room {
  id: string; property_id: string; name: string; room_type: string; status: string; notes?: string;
  thumbnail_key?: string; created_at: string; updated_at: string;
}
export interface CaptureSession {
  id: string; room_id: string; status: string; frame_count: number;
  accepted_count: number; rejected_count: number; selected_frame_id?: string;
  created_at: string; updated_at: string; completed_at?: string;
}
export interface CaptureFrame {
  id: string; session_id: string; storage_key?: string; quality_score?: number;
  is_accepted?: boolean; upload_status: string; created_at: string;
}
export interface ReconstructionJob {
  id: string; capture_session_id: string; engine: string; status: string;
  progress: number; current_message?: string; retry_count: number;
  error_message?: string; created_at: string; started_at?: string; completed_at?: string;
}
export interface JobProgress {
  id: string; status: string; progress: number; message?: string; current_message?: string; error_message?: string;
}
export interface SceneManifest {
  id: string; room_id: string; engine: string; representation: string;
  manifest_data: Record<string, unknown>; created_at: string;
}
export interface PropertyTour {
  property_id: string; name: string;
  rooms: { room_id: string; name: string; room_type: string; status: string; scene: Record<string, unknown> | null }[];
}
