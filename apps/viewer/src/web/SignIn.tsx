/** The sign-in gate in front of the web app and the walkthrough, and the sign-in page itself. */
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, SIGNED_OUT_EVENT, type Session } from './client'
import { EmptyPlan } from './art'
import { Mark } from './Shell'
import './web.css'

interface AuthState {
  username: string | null
  required: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({ username: null, required: false, signOut: async () => {} })

export const useAuth = () => useContext(AuthContext)

type Phase = 'checking' | 'in' | 'out'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [session, setSession] = useState<Session | null>(null)

  const check = useCallback(() => {
    api.auth
      .me()
      .then((s) => {
        setSession(s)
        setPhase('in')
      })
      .catch((e) => {
        // 401: signed out. Anything else (API down): let the app show its own errors.
        if (e instanceof ApiError && e.status === 401) setPhase('out')
        else setPhase('in')
      })
  }, [])

  useEffect(check, [check])

  useEffect(() => {
    const onOut = () => setPhase('out')
    window.addEventListener(SIGNED_OUT_EVENT, onOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onOut)
  }, [])

  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => {})
    setSession(null)
    setPhase('out')
  }, [])

  if (phase === 'checking') return <div className="signin-blank" aria-busy="true" />
  if (phase === 'out')
    return (
      <SignInPage
        onSignedIn={(s) => {
          setSession(s)
          setPhase('in')
        }}
      />
    )
  return (
    <AuthContext.Provider value={{ username: session?.username ?? null, required: !!session?.auth_required, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function SignInPage({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await api.auth.login(username.trim(), password))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach HOMIE. Check that the server is running')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="web signin">
      <section className="signin-art" aria-hidden>
        <span className="brand">
          <Mark />
          HOMIE
        </span>
        <EmptyPlan />
        <p className="signin-tag">Every room you photograph becomes a place you can walk through</p>
      </section>

      <section className="signin-panel">
        <form className="signin-form" onSubmit={submit}>
          <span className="brand signin-brand-compact">
            <Mark />
            HOMIE
          </span>
          <h1>Sign in</h1>
          <p className="lede">Your houses, room by room, in 3D</p>

          <label className="field">
            <span>Username</span>
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>

          {error && (
            <p className="signin-error" role="alert">
              {error}
            </p>
          )}

          <button className="btn btn-primary btn-lg" disabled={busy || !username.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  )
}
