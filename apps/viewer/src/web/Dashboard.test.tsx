// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../Walkthrough', () => ({
  Walkthrough: ({ request }: { request: { propertyId?: string; roomId?: string } }) => (
    <div data-testid="walkthrough">
      walk {request.propertyId} {request.roomId ?? ''}
    </div>
  ),
}))

import { Dashboard } from './Dashboard'

const P = '3f1c2a9e-1111-4a2b-9c3d-000000000001'
const R = '7a8b9c0d-2222-4e5f-8a9b-000000000002'

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown }

function mockApi(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const { status = 200, body } = handler(url, init)
      return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status })
    }),
  )
  return calls
}

const house = { id: P, name: 'Lake cottage', address: '1 Shore Rd', room_count: 2, created_at: '', updated_at: '' }
const room = (over: Record<string, unknown> = {}) => ({
  id: R, property_id: P, name: 'Living', room_type: 'living_room', status: 'created', thumbnail_key: null,
  created_at: '', updated_at: '', ...over,
})

beforeEach(() => {
  window.location.hash = '#/'
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  globalThis.URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('houses page', () => {
  it('lists houses', async () => {
    mockApi(() => ({ body: [house] }))
    render(<Dashboard />)
    expect(await screen.findByText('Lake cottage')).toBeTruthy()
    expect(screen.getByText('2 rooms')).toBeTruthy()
  })

  it('shows an empty state', async () => {
    mockApi(() => ({ body: [] }))
    render(<Dashboard />)
    expect(await screen.findByText(/No houses yet/)).toBeTruthy()
  })

  it('shows API errors with a retry', async () => {
    mockApi(() => ({ status: 500, body: { detail: 'Database down' } }))
    render(<Dashboard />)
    expect(await screen.findByText('Database down')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('creates a house and opens it', async () => {
    const calls = mockApi((url, init) =>
      init?.method === 'POST' ? { status: 201, body: { ...house, id: P } } : url.includes('/rooms') ? { body: [] } : { body: url.endsWith('/properties') ? [] : house },
    )
    render(<Dashboard />)
    fireEvent.change(screen.getByLabelText('House name'), { target: { value: 'New place' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add house' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/houses/${P}`))
    const post = calls.find((c) => c.init?.method === 'POST')!
    expect(JSON.parse(String(post.init!.body))).toEqual({ name: 'New place' })
  })

  it('disables Add house until a name is typed', () => {
    mockApi(() => ({ body: [] }))
    render(<Dashboard />)
    expect((screen.getByRole('button', { name: 'Add house' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('house page', () => {
  beforeEach(() => {
    window.location.hash = `#/houses/${P}`
  })

  it('shows rooms with status and the walkthrough button when a room is ready', async () => {
    mockApi((url) => (url.endsWith('/rooms') ? { body: [room({ status: 'ready' }), room({ id: 'r2', name: 'Bed', status: 'created' })] } : { body: house }))
    render(<Dashboard />)
    expect(await screen.findByText('Living')).toBeTruthy()
    expect(screen.getByText('Ready to walk')).toBeTruthy()
    expect(screen.getByText('Not captured')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Walk through house' }).getAttribute('href')).toBe(`#/houses/${P}/tour`)
    expect(screen.getByText(/1 of 2 rooms ready in 3D/)).toBeTruthy()
  })

  it('hides the walkthrough button when nothing is ready', async () => {
    mockApi((url) => (url.endsWith('/rooms') ? { body: [room()] } : { body: house }))
    render(<Dashboard />)
    await screen.findByText('Living')
    expect(screen.queryByRole('link', { name: 'Walk through house' })).toBeNull()
  })

  it('adds a room with the chosen type', async () => {
    const calls = mockApi((url, init) =>
      init?.method === 'POST'
        ? { status: 201, body: room({ id: R }) }
        : url.endsWith('/rooms')
          ? { body: [] }
          : url.includes('/rooms/')
            ? { body: room() }
            : url.startsWith('/api/v1/reconstruction-jobs')
              ? { body: [] }
              : { body: house },
    )
    render(<Dashboard />)
    await screen.findByText(/No rooms yet/)
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Kitchen' } })
    fireEvent.change(screen.getByLabelText('Room type'), { target: { value: 'kitchen' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/houses/${P}/rooms/${R}`))
    const post = calls.find((c) => c.init?.method === 'POST')!
    expect(JSON.parse(String(post.init!.body))).toEqual({ name: 'Kitchen', room_type: 'kitchen' })
  })

  it('uses the scene thumbnail as the card image', async () => {
    mockApi((url) => (url.endsWith('/rooms') ? { body: [room({ status: 'ready', thumbnail_key: 'scenes/j/t.webp' })] } : { body: house }))
    const { container } = render(<Dashboard />)
    await screen.findByText('Living')
    expect((container.querySelector('.thumb') as HTMLElement).style.backgroundImage).toContain('/api/v1/assets/scenes/j/t.webp')
  })
})

describe('room page', () => {
  beforeEach(() => {
    window.location.hash = `#/houses/${P}/rooms/${R}`
  })

  const photo = (name: string, type = 'image/jpeg') => new File([new Uint8Array([1, 2])], name, { type })

  function roomApi(over: { jobs?: unknown[]; room?: Record<string, unknown> } = {}) {
    return mockApi((url, init) => {
      if (url.startsWith('/api/v1/reconstruction-jobs?')) return { body: over.jobs ?? [] }
      if (url === '/api/v1/capture-sessions' && init?.method === 'POST') return { status: 201, body: { id: 's1' } }
      if (url.endsWith('/photos')) return { status: 201, body: { id: 'f' } }
      if (url.endsWith('/finalize')) return { body: { status: 'submitted' } }
      if (url === '/api/v1/reconstruction-jobs' && init?.method === 'POST')
        return { status: 201, body: { id: 'j1', status: 'queued', progress: 0, current_message: 'Waiting for a worker…' } }
      if (url.includes('/rooms/')) return { body: room(over.room) }
      return { body: house }
    })
  }

  it('adds photos, removes one, and builds the room', async () => {
    const calls = roomApi()
    render(<Dashboard />)
    await screen.findByRole('heading', { name: 'Living' })
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')] } })
    expect(screen.getByText('3 / 8 photos')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.jpg' }))
    expect(screen.getByText('2 / 8 photos')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Build 3D room from 2 photos/ }))
    expect(await screen.findByText('Building your 3D room')).toBeTruthy()
    expect(calls.filter((c) => c.url.endsWith('/photos'))).toHaveLength(2)
  })

  it('ignores non-image files', async () => {
    roomApi()
    render(<Dashboard />)
    await screen.findByRole('heading', { name: 'Living' })
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [photo('notes.txt', 'text/plain'), photo('a.jpg')] } })
    expect(screen.getByText('1 / 8 photos')).toBeTruthy()
    expect(screen.getByText('Only image files can be used.')).toBeTruthy()
  })

  it('caps photos at 8', async () => {
    roomApi()
    render(<Dashboard />)
    await screen.findByRole('heading', { name: 'Living' })
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: Array.from({ length: 10 }, (_, i) => photo(`${i}.jpg`)) } })
    expect(screen.getByText('8 / 8 photos')).toBeTruthy()
    expect(screen.getByText(/up to 8 photos/)).toBeTruthy()
  })

  it('accepts dropped photos', async () => {
    roomApi()
    render(<Dashboard />)
    await screen.findByRole('heading', { name: 'Living' })
    fireEvent.drop(screen.getByRole('button', { name: /Drop photos here/ }), { dataTransfer: { files: [photo('d.jpg')] } })
    expect(screen.getByText('1 / 8 photos')).toBeTruthy()
  })

  it('shows a running job instead of the upload form', async () => {
    roomApi({ jobs: [{ id: 'j1', status: 'generating_world', progress: 0.42, current_message: 'Building…' }] })
    render(<Dashboard />)
    expect(await screen.findByText('42%')).toBeTruthy()
    expect(screen.queryByText(/Drop photos here/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('shows a failed job with its error and a retry', async () => {
    roomApi({ jobs: [{ id: 'j1', status: 'failed', progress: 0.3, error_message: 'World Labs: not enough credits' }] })
    render(<Dashboard />)
    expect(await screen.findByText('World Labs: not enough credits')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('offers the walkthrough for a ready room', async () => {
    roomApi({ room: { status: 'ready' }, jobs: [{ id: 'j1', status: 'ready', progress: 1 }] })
    render(<Dashboard />)
    expect(await screen.findByText('3D room ready')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Walk through' }).getAttribute('href')).toBe(`#/houses/${P}/tour/${R}`)
    expect(screen.getByText('Rebuild this room')).toBeTruthy()
  })
})

describe('tour and not found', () => {
  it('renders the walkthrough for a tour route', async () => {
    window.location.hash = `#/houses/${P}/tour/${R}`
    mockApi(() => ({ body: {} }))
    render(<Dashboard />)
    expect((await screen.findByTestId('walkthrough')).textContent).toContain(P)
    expect(screen.getByTestId('walkthrough').textContent).toContain(R)
  })

  it('reacts to hash changes', async () => {
    mockApi((url) => ({ body: url.endsWith('/properties') ? [house] : house }))
    render(<Dashboard />)
    await screen.findByText('Lake cottage')
    await act(async () => {
      window.location.hash = `#/houses/${P}/tour`
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(await screen.findByTestId('walkthrough')).toBeTruthy()
  })

  it('shows not found for unknown routes', () => {
    window.location.hash = '#/somewhere'
    mockApi(() => ({ body: {} }))
    render(<Dashboard />)
    expect(screen.getByText(/doesn't exist/)).toBeTruthy()
  })
})
