// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    await screen.findAllByText('Lake cottage')
    const grid = within(document.querySelector('.house-grid') as HTMLElement)
    expect(grid.getByText('Lake cottage')).toBeTruthy()
    expect(grid.getByText('2 rooms')).toBeTruthy()
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
    expect(screen.getByText('Only image files can be used')).toBeTruthy()
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
    await screen.findAllByText('Lake cottage')
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

describe('home: featured room and house cards', () => {
  const scene = { room_id: R, manifest_data: { caption: 'A cosy living room. With a sofa.', urls: { panorama: '/pano.png' } } }

  function homeApi(rooms: unknown[]) {
    return mockApi((url) => {
      if (url === '/api/v1/properties') return { body: [house] }
      if (url.endsWith('/rooms')) return { body: rooms }
      if (url.includes('/scenes/')) return { body: scene }
      return { body: house }
    })
  }

  it('shows the latest ready room turning, with its caption and a walk-through link', async () => {
    homeApi([room({ status: 'ready', updated_at: '2026-11-12' })])
    const { container } = render(<Dashboard />)
    expect(await screen.findByText('A cosy living room')).toBeTruthy()
    const feature = container.querySelector('.feature') as HTMLElement
    expect(within(feature).getByRole('heading', { name: 'Living' })).toBeTruthy()
    expect(within(feature).getByRole('link', { name: 'Walk through' }).getAttribute('href')).toBe(`#/houses/${P}/tour/${R}`)
    expect((feature.querySelector('.pano-strip img') as HTMLImageElement).getAttribute('src')).toBe('/pano.png')
  })

  it('invites the first room when nothing is ready', async () => {
    homeApi([room()])
    render(<Dashboard />)
    expect(await screen.findByText('Your first room lights up here')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Walk through' })).toBeNull()
  })

  it('shows room photos and the ready count on the house card', async () => {
    homeApi([room({ status: 'ready', thumbnail_key: 'scenes/j/t.webp' }), room({ id: 'r2', name: 'Bed' })])
    const { container } = render(<Dashboard />)
    expect(await screen.findByText('1 ready to walk')).toBeTruthy()
    const img = container.querySelector('.house-shots img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/api/v1/assets/scenes/j/t.webp')
  })

  it('draws the plan when a house has no photos yet', async () => {
    homeApi([room()])
    const { container } = render(<Dashboard />)
    await screen.findByText('Your first room lights up here')
    await waitFor(() => expect(container.querySelector('.house-shots .empty-plan')).toBeTruthy())
  })

  it('lists every house in the sidebar', async () => {
    homeApi([])
    const { container } = render(<Dashboard />)
    const side = container.querySelector('.sidebar') as HTMLElement
    await waitFor(() => expect(within(side).getByRole('link', { name: /Lake cottage/ }).getAttribute('href')).toBe(`#/houses/${P}`))
    expect(within(side).getByRole('link', { name: /All houses/ }).getAttribute('aria-current')).toBe('page')
  })

  it('focuses the new house form from the sidebar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    homeApi([])
    render(<Dashboard />)
    fireEvent.click(screen.getByRole('button', { name: 'New house' }))
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(document.activeElement?.id).toBe('house-name')
    vi.useRealTimers()
  })
})

describe('house page: floor plan', () => {
  beforeEach(() => {
    window.location.hash = `#/houses/${P}`
  })

  it('marks the open house in the sidebar', async () => {
    mockApi((url) => (url === '/api/v1/properties' ? { body: [house] } : url.endsWith('/rooms') ? { body: [] } : { body: house }))
    const { container } = render(<Dashboard />)
    const side = container.querySelector('.sidebar') as HTMLElement
    await waitFor(() => expect(within(side).getByRole('link', { name: /Lake cottage/ }).getAttribute('aria-current')).toBe('page'))
  })

  it('shows live progress for a room that is building', async () => {
    mockApi((url) => {
      if (url.endsWith('/rooms')) return { body: [room({ status: 'processing' })] }
      if (url.startsWith('/api/v1/reconstruction-jobs?')) return { body: [{ id: 'j1', status: 'generating_world', progress: 0.37 }] }
      return { body: house }
    })
    render(<Dashboard />)
    expect(await screen.findByText('37%')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Build progress' }).getAttribute('aria-valuenow')).toBe('37')
  })

  it('lights ready rooms and draws the rest as plan', async () => {
    mockApi((url) =>
      url.endsWith('/rooms')
        ? { body: [room({ status: 'ready', thumbnail_key: 'k.webp' }), room({ id: 'r2', name: 'Bed', room_type: 'bedroom' })] }
        : { body: house },
    )
    const { container } = render(<Dashboard />)
    await screen.findByText('Bed')
    expect(container.querySelectorAll('.cell-lit')).toHaveLength(1)
    expect(container.querySelectorAll('.cell-plan')).toHaveLength(1)
    expect(container.querySelector('.cell-plan .cell-icon svg')).toBeTruthy()
  })

  it('links each room to its page', async () => {
    mockApi((url) => (url.endsWith('/rooms') ? { body: [room()] } : { body: house }))
    render(<Dashboard />)
    await screen.findByText('Living')
    expect(screen.getByRole('link', { name: /Living/ }).getAttribute('href')).toBe(`#/houses/${P}/rooms/${R}`)
  })

  it('counts rooms in the plan title', async () => {
    mockApi((url) => (url.endsWith('/rooms') ? { body: [room(), room({ id: 'r2', name: 'Bed' })] } : { body: house }))
    render(<Dashboard />)
    expect(await screen.findByText('2 rooms')).toBeTruthy()
  })
})

describe('room page: scene, rebuild and live build', () => {
  beforeEach(() => {
    window.location.hash = `#/houses/${P}/rooms/${R}`
  })

  function roomApi(over: { jobs?: unknown[]; room?: Record<string, unknown>; on?: (url: string, init?: RequestInit) => unknown } = {}) {
    return mockApi((url, init) => {
      const custom = over.on?.(url, init)
      if (custom) return { body: custom }
      if (url.startsWith('/api/v1/reconstruction-jobs?')) return { body: over.jobs ?? [] }
      if (url.includes('/scenes/')) return { body: { room_id: R, manifest_data: { caption: 'A tidy study.', urls: { panorama: '/p.png' } } } }
      if (url.includes('/rooms/')) return { body: room(over.room) }
      return { body: house }
    })
  }

  it('shows the panorama and caption of a ready room', async () => {
    roomApi({ room: { status: 'ready' }, jobs: [{ id: 'j1', status: 'ready', progress: 1, completed_at: '2026-11-12T10:00:00Z' }] })
    const { container } = render(<Dashboard />)
    expect(await screen.findByText('A tidy study')).toBeTruthy()
    expect(container.querySelector('.stage .pano-strip img')?.getAttribute('src')).toBe('/p.png')
    expect(screen.getByText(/Built 12 Nov 2026|Built Nov 12, 2026/)).toBeTruthy()
  })

  it('shows the walking keys as keycaps', async () => {
    roomApi({ room: { status: 'ready' }, jobs: [{ id: 'j1', status: 'ready', progress: 1 }] })
    const { container } = render(<Dashboard />)
    await screen.findByText('3D room ready')
    expect([...container.querySelectorAll('.keys kbd')].map((k) => k.textContent)).toEqual(['W', 'A', 'S', 'D', 'Drag', 'Double-click'])
  })

  it('swaps the scene for the photo form when rebuilding, and back', async () => {
    roomApi({ room: { status: 'ready' }, jobs: [{ id: 'j1', status: 'ready', progress: 1 }] })
    render(<Dashboard />)
    await screen.findByText('Rebuild this room')
    expect(screen.queryByRole('button', { name: /Drop photos here/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use new photos' }))
    expect(screen.getByRole('button', { name: /Drop photos here/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Walk through' }).getAttribute('href')).toBe(`#/houses/${P}/tour/${R}`)
    expect(screen.getByText('How to shoot it')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep the current room' }))
    expect(screen.queryByRole('button', { name: /Drop photos here/ })).toBeNull()
  })

  it('walks through the build stages with the current one marked', async () => {
    roomApi({ jobs: [{ id: 'j1', status: 'generating_world', progress: 0.5, current_message: 'Building your 3D room… (2m 10s)', created_at: '2026-11-14T10:00:00Z' }] })
    const { container } = render(<Dashboard />)
    await screen.findByText('50%')
    const steps = [...container.querySelectorAll('.step')]
    expect(steps.map((s) => s.className.split(' ')[1])).toEqual(['step-done', 'step-done', 'step-now', 'step-next', 'step-next'])
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Building the 3D world')
    expect(screen.getByText('Building your 3D room… (2m 10s)')).toBeTruthy()
    expect(screen.getByText(/elapsed/)).toBeTruthy()
  })

  it('says it is checking when it cannot stream', async () => {
    roomApi({ jobs: [{ id: 'j1', status: 'queued', progress: 0 }] })
    render(<Dashboard />)
    expect(await screen.findByText('Checking every 3s')).toBeTruthy()
  })

  it('cancels a running build', async () => {
    const calls = roomApi({
      jobs: [{ id: 'j1', status: 'generating_world', progress: 0.3 }],
      on: (url, init) => (url.endsWith('/cancel') && init?.method === 'POST' ? { id: 'j1', status: 'cancelled', progress: 0.3 } : null),
    })
    render(<Dashboard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Build cancelled')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/reconstruction-jobs/j1/cancel')).toBe(true)
  })

  it('retries a failed build', async () => {
    const calls = roomApi({
      jobs: [{ id: 'j1', status: 'failed', progress: 0.3, error_message: 'Timed out' }],
      on: (url, init) => (url.endsWith('/retry') && init?.method === 'POST' ? { id: 'j1', status: 'queued', progress: 0 } : null),
    })
    render(<Dashboard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Building your 3D room')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/reconstruction-jobs/j1/retry')).toBe(true)
  })

  it('fills the shot guide as photos are added', async () => {
    roomApi()
    const { container } = render(<Dashboard />)
    await screen.findByRole('heading', { name: 'Living' })
    expect(container.querySelectorAll('.wedge.taken')).toHaveLength(0)
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const photo = (n: string) => new File([new Uint8Array([1])], n, { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [photo('a.jpg'), photo('b.jpg')] } })
    expect(container.querySelectorAll('.wedge.taken')).toHaveLength(2)
    expect(container.querySelectorAll('.slot.filled')).toHaveLength(2)
    expect(container.querySelectorAll('.slot')).toHaveLength(8)
  })

  it('accepts iPhone HEIC photos with no MIME type', async () => {
    roomApi()
    render(<Dashboard />)
    await screen.findByRole('heading', { name: 'Living' })
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'IMG_6159.HEIC', { type: '' })] } })
    expect(screen.getByText('1 / 8 photos')).toBeTruthy()
  })

  it('keeps the photos it sent on the build panel', async () => {
    const calls = roomApi()
    render(<Dashboard />)
    await screen.findByRole('heading', { name: 'Living' })
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })] } })
    fireEvent.click(screen.getByRole('button', { name: /Build 3D room from 1 photo$/ }))
    expect(await screen.findByText('1 photo sent')).toBeTruthy()
    expect(calls.filter((c) => c.url.endsWith('/finalize'))).toHaveLength(1)
  })
})
