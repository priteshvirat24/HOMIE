/* API client for HOMIE backend */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8001';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body || res.statusText);
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
export const captureApi = {
  create: (roomId: string) =>
    request<CaptureSession>('/api/v1/capture-sessions', {
      method: 'POST',
      body: JSON.stringify({ room_id: roomId }),
    }),
  get: (sessionId: string) => request<CaptureSession>(`/api/v1/capture-sessions/${sessionId}`),
  registerFrame: (sessionId: string, frame: FrameRegister) =>
    request<CaptureFrame>(`/api/v1/capture-sessions/${sessionId}/frames`, {
      method: 'POST',
      body: JSON.stringify(frame),
    }),
  listFrames: (sessionId: string) =>
    request<CaptureFrame[]>(`/api/v1/capture-sessions/${sessionId}/frames`),
  getUploadUrls: (sessionId: string, frameIds: string[]) =>
    request<{ urls: UploadUrl[] }>(`/api/v1/capture-sessions/${sessionId}/upload-urls`, {
      method: 'POST',
      body: JSON.stringify(frameIds),
    }),
  finalize: (sessionId: string, selectedFrameId?: string) =>
    request<{ status: string }>(`/api/v1/capture-sessions/${sessionId}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ selected_frame_id: selectedFrameId }),
    }),
};

// ── Reconstruction ───────────────────────────────────────────
export const reconstructionApi = {
  create: (captureSessionId: string, engine = 'image_blaster') =>
    request<ReconstructionJob>('/api/v1/reconstruction-jobs', {
      method: 'POST',
      body: JSON.stringify({ capture_session_id: captureSessionId, engine }),
    }),
  get: (jobId: string) => request<ReconstructionJob>(`/api/v1/reconstruction-jobs/${jobId}`),
  progress: (jobId: string) => request<JobProgress>(`/api/v1/reconstruction-jobs/${jobId}/progress`),
  retry: (jobId: string) =>
    request<ReconstructionJob>(`/api/v1/reconstruction-jobs/${jobId}/retry`, { method: 'POST' }),
  cancel: (jobId: string) =>
    request<ReconstructionJob>(`/api/v1/reconstruction-jobs/${jobId}/cancel`, { method: 'POST' }),
};

// ── Scene ────────────────────────────────────────────────────
export const sceneApi = {
  getManifest: (roomId: string) => request<SceneManifest>(`/api/v1/scenes/${roomId}/manifest`),
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
export interface FrameRegister {
  original_filename?: string; content_type?: string; file_size_bytes?: number;
  width?: number; height?: number; quality_score?: number;
  is_accepted?: boolean; rejection_reasons?: string[]; captured_at?: string;
}
export interface UploadUrl { frame_id: string; storage_key: string; upload_url: string; }
export interface ReconstructionJob {
  id: string; capture_session_id: string; engine: string; status: string;
  progress: number; current_message?: string; retry_count: number;
  error_message?: string; created_at: string; started_at?: string; completed_at?: string;
}
export interface JobProgress {
  id: string; status: string; progress: number; message?: string; error_message?: string;
}
export interface SceneManifest {
  id: string; room_id: string; engine: string; representation: string;
  manifest_data: Record<string, unknown>; created_at: string;
}
