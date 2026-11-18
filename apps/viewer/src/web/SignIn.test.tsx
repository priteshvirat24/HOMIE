// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from './SignIn'
import { Shell } from './Shell'
import { api, signedOut } from './client'

type Reply = { status?: number; body?: unknown } | Error

function mockApi(handler: (url: string, init?: RequestInit) => Reply) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const r = handler(url, init)
      if (r instanceof Error) throw r
      const { status = 200, body } = r
      return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status })
    }),
  )
  return calls
}

const signedIn = { username: 'admin', auth_required: true }

function App() {
  return (
    <AuthGate>
      <Shell crumbs={[{ label: 'Houses' }]}>
        <p>The houses</p>
      </Shell>
    </AuthGate>
  )
}

beforeEach(() => {
  window.location.hash = '#/'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function fill(user: string, pass: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: user } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: pass } })
}

describe('sign-in gate', () => {
  it('shows the sign-in page when signed out', async () => {
    mockApi((url) => (url === '/api/v1/auth/me' ? { status: 401, body: { detail: 'Sign in to continue' } } : { body: [] }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByText('The houses')).toBeNull()
  })

  it('shows the app when the session is valid', async () => {
    mockApi((url) => (url === '/api/v1/auth/me' ? { body: signedIn } : { body: [] }))
    render(<App />)
    expect(await screen.findByText('The houses')).toBeTruthy()
  })

  it('shows the app when sign-in is turned off, with no sign-out button', async () => {
    mockApi((url) => (url === '/api/v1/auth/me' ? { body: { username: null, auth_required: false } } : { body: [] }))
    render(<App />)
    await screen.findByText('The houses')
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('lets the app show its own error when the API is unreachable', async () => {
    mockApi(() => new TypeError('Failed to fetch'))
    render(<App />)
    expect(await screen.findByText('The houses')).toBeTruthy()
  })

  it('renders nothing while checking', () => {
    mockApi(() => ({ body: signedIn }))
    const { container } = render(<App />)
    expect(container.querySelector('.signin-blank')).toBeTruthy()
  })
})

describe('sign-in page', () => {
  function signedOutApi(login: (body: { username: string; password: string }) => Reply) {
    return mockApi((url, init) => {
      if (url === '/api/v1/auth/me') return { status: 401, body: { detail: 'Sign in to continue' } }
      if (url === '/api/v1/auth/login') return login(JSON.parse(String(init?.body)))
      return { body: [] }
    })
  }

  it('keeps the button off until both fields are filled', async () => {
    signedOutApi(() => ({ body: signedIn }))
    render(<App />)
    await screen.findByRole('heading', { name: 'Sign in' })
    const button = () => screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement
    expect(button().disabled).toBe(true)
    fill('admin', '')
    expect(button().disabled).toBe(true)
    fill('admin', '12345')
    expect(button().disabled).toBe(false)
  })

  it('signs in and opens the app', async () => {
    const calls = signedOutApi(({ username, password }) =>
      username === 'admin' && password === '12345' ? { body: signedIn } : { status: 401, body: { detail: 'Wrong username or password' } },
    )
    render(<App />)
    await screen.findByRole('heading', { name: 'Sign in' })
    fill(' admin ', '12345')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('The houses')).toBeTruthy()
    const login = calls.find((c) => c.url === '/api/v1/auth/login')!
    expect(login.init?.method).toBe('POST')
    expect(JSON.parse(String(login.init?.body))).toEqual({ username: 'admin', password: '12345' })
  })

  it('shows the error and clears the password on a wrong password', async () => {
    signedOutApi(() => ({ status: 401, body: { detail: 'Wrong username or password' } }))
    render(<App />)
    await screen.findByRole('heading', { name: 'Sign in' })
    fill('admin', 'nope')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Wrong username or password')).toBeTruthy()
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('admin')
  })

  it('shows the lockout message', async () => {
    signedOutApi(() => ({ status: 429, body: { detail: 'Too many attempts. Wait a few minutes and try again' } }))
    render(<App />)
    await screen.findByRole('heading', { name: 'Sign in' })
    fill('admin', 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/Too many attempts/)).toBeTruthy()
  })

  it('says so when the server cannot be reached', async () => {
    mockApi((url) => (url === '/api/v1/auth/me' ? { status: 401, body: {} } : new TypeError('Failed to fetch')))
    render(<App />)
    await screen.findByRole('heading', { name: 'Sign in' })
    fill('admin', '12345')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/Could not reach HOMIE/)).toBeTruthy()
  })

  it('uses password-manager friendly fields', async () => {
    signedOutApi(() => ({ body: signedIn }))
    render(<App />)
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(screen.getByLabelText('Username').getAttribute('autocomplete')).toBe('username')
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password')
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password')
  })
})

describe('signing out', () => {
  it('signs out from the sidebar', async () => {
    const calls = mockApi((url) => (url === '/api/v1/auth/me' ? { body: signedIn } : url === '/api/v1/auth/logout' ? { status: 204 } : { body: [] }))
    render(<App />)
    await screen.findByText('The houses')
    expect(screen.getByText('admin')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0])
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/auth/logout' && c.init?.method === 'POST')).toBe(true)
  })

  it('goes back to sign-in when any API call says the session ended', async () => {
    let expired = false
    mockApi((url) => {
      if (url === '/api/v1/auth/me') return { body: signedIn }
      if (expired) return { status: 401, body: { detail: 'Sign in to continue' } }
      return { body: [] }
    })
    render(<App />)
    await screen.findByText('The houses')
    expired = true
    await act(async () => {
      await api.properties.list().catch(() => {})
    })
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })

  it('ignores 401s from the sign-in endpoints themselves', async () => {
    const listener = vi.fn()
    window.addEventListener('homie:signed-out', listener)
    mockApi(() => ({ status: 401, body: { detail: 'Wrong username or password' } }))
    await api.auth.login('admin', 'bad').catch(() => {})
    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener('homie:signed-out', listener)
  })

  it('signedOut() broadcasts the event', () => {
    const listener = vi.fn()
    window.addEventListener('homie:signed-out', listener)
    signedOut()
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('homie:signed-out', listener)
  })
})

describe('walkthrough loader', () => {
  it('signals sign-out when the tour request is rejected', async () => {
    const { loadTour } = await import('../api')
    const listener = vi.fn()
    window.addEventListener('homie:signed-out', listener)
    mockApi(() => ({ status: 401, body: { detail: 'Sign in to continue' } }))
    await expect(loadTour({ propertyId: 'p1' })).rejects.toThrow('Sign in to continue')
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('homie:signed-out', listener)
  })

  it('waits for the sign-in check before the dashboard loads data', async () => {
    const calls = mockApi((url) => (url === '/api/v1/auth/me' ? { status: 401, body: {} } : { body: [] }))
    render(<App />)
    await screen.findByRole('heading', { name: 'Sign in' })
    await waitFor(() => expect(calls.map((c) => c.url)).toEqual(['/api/v1/auth/me']))
  })
})
