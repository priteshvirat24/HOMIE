import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { url: string; init: RequestInit };

function stubFetch(responses: Array<{ status?: number; body?: unknown; text?: string }>) {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      const r = responses[Math.min(i++, responses.length - 1)];
      const status = r.status ?? 200;
      return new Response(status === 204 ? null : r.text ?? JSON.stringify(r.body ?? {}), { status });
    }),
  );
  return calls;
}

async function load(apiUrl?: string) {
  vi.resetModules();
  if (apiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = apiUrl;
  return import('../api');
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_API_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API_URL', () => {
  it('defaults to the local API on port 8000', async () => {
    expect((await load()).API_URL).toBe('http://localhost:8000');
  });

  it('uses EXPO_PUBLIC_API_URL', async () => {
    expect((await load('http://192.168.1.20:8000')).API_URL).toBe('http://192.168.1.20:8000');
  });

  it('strips a trailing slash', async () => {
    expect((await load('http://192.168.1.20:8000/')).API_URL).toBe('http://192.168.1.20:8000');
  });
});

describe('walkthroughUrl', () => {
  it.each([
    [{ propertyId: 'p1' }, 'http://h:8000/viewer/?property=p1'],
    [{ roomId: 'r1' }, 'http://h:8000/viewer/?room=r1'],
    [{ propertyId: 'p1', roomId: 'r1' }, 'http://h:8000/viewer/?property=p1&room=r1'],
    [{}, 'http://h:8000/viewer/?'],
  ])('%o', async (opts, expected) => {
    const { walkthroughUrl } = await load('http://h:8000');
    expect(walkthroughUrl(opts)).toBe(expected);
  });
});

describe('requests', () => {
  it('sends JSON with a content-type', async () => {
    const api = await load('http://h');
    const calls = stubFetch([{ status: 201, body: { id: 'p1' } }]);
    await api.propertiesApi.create({ name: 'Home' });
    expect(calls[0].url).toBe('http://h/api/v1/properties');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('uploads a photo as multipart without a JSON content-type', async () => {
    const api = await load('http://h');
    const calls = stubFetch([{ status: 201, body: { id: 'f1' } }]);
    await api.captureApi.uploadPhoto('s1', 'file:///data/photos/IMG_1.jpg', 'image/jpeg');
    expect(calls[0].url).toBe('http://h/api/v1/capture-sessions/s1/photos');
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('uses the API error detail', async () => {
    const api = await load('http://h');
    stubFetch([{ status: 400, body: { detail: 'A room can use at most 8 photos' } }]);
    await expect(api.captureApi.finalize('s1')).rejects.toThrow('A room can use at most 8 photos');
  });

  it('falls back to plain-text errors', async () => {
    const api = await load('http://h');
    stubFetch([{ status: 502, text: 'Bad Gateway' }]);
    await expect(api.propertiesApi.list()).rejects.toThrow('Bad Gateway');
  });

  it('returns undefined for 204', async () => {
    const api = await load('http://h');
    stubFetch([{ status: 204 }]);
    await expect(api.roomsApi.delete('p', 'r')).resolves.toBeUndefined();
  });

  it('finalize passes the selected frame as a query parameter', async () => {
    const api = await load('http://h');
    const calls = stubFetch([{ body: { status: 'submitted' } }]);
    await api.captureApi.finalize('s1', 'f9');
    expect(calls[0].url).toBe('http://h/api/v1/capture-sessions/s1/finalize?selected_frame_id=f9');
  });

  it('latestForRoom returns the newest job or null', async () => {
    const api = await load('http://h');
    const calls = stubFetch([{ body: [{ id: 'j2' }] }, { body: [] }]);
    expect(await api.reconstructionApi.latestForRoom('r1')).toEqual({ id: 'j2' });
    expect(await api.reconstructionApi.latestForRoom('r1')).toBeNull();
    expect(calls[0].url).toBe('http://h/api/v1/reconstruction-jobs?room_id=r1&limit=1');
  });

  it('creates an image_blaster job by default', async () => {
    const api = await load('http://h');
    const calls = stubFetch([{ status: 201, body: { id: 'j1' } }]);
    await api.reconstructionApi.create('s1');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ capture_session_id: 's1', engine: 'image_blaster' });
  });

  it('tour hits the property tour endpoint', async () => {
    const api = await load('http://h');
    const calls = stubFetch([{ body: { rooms: [] } }]);
    await api.sceneApi.tour('p1');
    expect(calls[0].url).toBe('http://h/api/v1/properties/p1/tour');
  });

  it('limits a room to 8 photos (matches the API and World Labs)', async () => {
    expect((await load()).MAX_PHOTOS_PER_ROOM).toBe(8);
  });
});
