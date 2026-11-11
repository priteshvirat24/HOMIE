/**
 * HOMIE web app: manage houses and rooms, upload room photos, follow the 3D build, and walk through.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  api,
  buildRoom,
  MAX_PHOTOS,
  prettyRoomType,
  ROOM_TYPES,
  statusLabel,
  TERMINAL_JOB_STATUSES,
  thumbnailUrl,
  type Job,
  type Property,
  type Room,
} from './client'
import { href, navigate, useRoute } from './router'
import './web.css'

const Walkthrough = lazy(() => import('../Walkthrough').then((m) => ({ default: m.Walkthrough })))

function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reload = useCallback(() => {
    setLoading(true)
    load()
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(reload, [reload])
  return { data, error, loading, reload, setData }
}

function Shell({ crumbs, children, actions }: { crumbs: { label: string; to?: string }[]; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="web">
      <header className="topbar">
        <a className="brand" href="#/">
          HOMIE
        </a>
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i}>
              {c.to ? <a href={c.to}>{c.label}</a> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>
        <div className="topbar-actions">{actions}</div>
      </header>
      <main className="page">{children}</main>
    </div>
  )
}

function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="note error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className="btn ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge status-${status}`}>{statusLabel(status)}</span>
}

/* ---------------- Houses ---------------- */

function HousesPage() {
  const { data, error, loading, reload } = useAsync(() => api.properties.list(), [])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setFormError(null)
    try {
      const p = await api.properties.create({ name: name.trim(), address: address.trim() || undefined })
      navigate({ name: 'house', propertyId: p.id })
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell crumbs={[{ label: 'Houses' }]}>
      <section className="intro">
        <h1>Your houses</h1>
        <p>Photograph each room, and HOMIE turns it into a 3D space you can walk through — one room or the whole house.</p>
      </section>

      <form className="inline-form" onSubmit={create}>
        <input aria-label="House name" placeholder="House name, e.g. Lake cottage" value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="Address (optional)" placeholder="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} />
        <button className="btn primary" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add house'}
        </button>
      </form>
      {formError && <ErrorNote message={formError} />}

      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <p className="muted">Loading…</p>}
      {data && data.length === 0 && <p className="empty">No houses yet. Add one above to get started.</p>}
      {data && data.length > 0 && (
        <ul className="grid">
          {data.map((p: Property) => (
            <li key={p.id}>
              <a className="card" href={href({ name: 'house', propertyId: p.id })}>
                <strong>{p.name}</strong>
                {p.address && <span className="muted">{p.address}</span>}
                <span className="meta">
                  {p.room_count} room{p.room_count === 1 ? '' : 's'}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

/* ---------------- House ---------------- */

function HousePage({ propertyId }: { propertyId: string }) {
  const house = useAsync(() => api.properties.get(propertyId), [propertyId])
  const rooms = useAsync(() => api.rooms.list(propertyId), [propertyId])
  const [name, setName] = useState('')
  const [type, setType] = useState('living_room')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Refresh while any room is still building.
  const building = rooms.data?.some((r) => r.status === 'processing')
  useEffect(() => {
    if (!building) return
    const t = setInterval(rooms.reload, 5000)
    return () => clearInterval(t)
  }, [building, rooms.reload])

  const ready = rooms.data?.filter((r) => r.status === 'ready').length ?? 0

  const addRoom = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setFormError(null)
    try {
      const room = await api.rooms.create(propertyId, { name: name.trim(), room_type: type })
      navigate({ name: 'room', propertyId, roomId: room.id })
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      crumbs={[{ label: 'Houses', to: '#/' }, { label: house.data?.name ?? '…' }]}
      actions={
        ready > 0 && (
          <a className="btn primary" href={href({ name: 'tour', propertyId })}>
            Walk through house
          </a>
        )
      }
    >
      {house.error && <ErrorNote message={house.error} onRetry={house.reload} />}
      {house.data && (
        <section className="intro">
          <h1>{house.data.name}</h1>
          <p>
            {house.data.address ? `${house.data.address} · ` : ''}
            {ready} of {rooms.data?.length ?? 0} rooms ready in 3D
          </p>
        </section>
      )}

      <form className="inline-form" onSubmit={addRoom}>
        <input aria-label="Room name" placeholder="Room name, e.g. Main bedroom" value={name} onChange={(e) => setName(e.target.value)} />
        <select aria-label="Room type" value={type} onChange={(e) => setType(e.target.value)}>
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>
              {prettyRoomType(t)}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add room'}
        </button>
      </form>
      {formError && <ErrorNote message={formError} />}

      {rooms.error && <ErrorNote message={rooms.error} onRetry={rooms.reload} />}
      {rooms.data && rooms.data.length === 0 && <p className="empty">No rooms yet. Add the first room above.</p>}
      {rooms.data && rooms.data.length > 0 && (
        <ul className="grid">
          {rooms.data.map((r: Room) => {
            const thumb = thumbnailUrl(r)
            return (
              <li key={r.id}>
                <a className="card room-card" href={href({ name: 'room', propertyId, roomId: r.id })}>
                  <div className="thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
                    {!thumb && <span>{prettyRoomType(r.room_type)}</span>}
                  </div>
                  <strong>{r.name}</strong>
                  <span className="meta-row">
                    <span className="muted">{prettyRoomType(r.room_type)}</span>
                    <StatusBadge status={r.status} />
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </Shell>
  )
}

/* ---------------- Room ---------------- */

function useObjectUrls(files: File[]) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  return urls
}

function JobPanel({ job, onRetry, onCancel }: { job: Job; onRetry: () => void; onCancel: () => void }) {
  const pct = Math.round(job.progress * 100)
  const running = !TERMINAL_JOB_STATUSES.has(job.status)
  return (
    <section className={`job job-${job.status}`} aria-live="polite">
      <div className="job-head">
        <strong>
          {job.status === 'ready' ? '3D room ready' : job.status === 'failed' ? 'Build failed' : job.status === 'cancelled' ? 'Build cancelled' : 'Building your 3D room'}
        </strong>
        {running && <span className="muted">{pct}%</span>}
      </div>
      {running && (
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
      )}
      {job.current_message && running && <p className="muted">{job.current_message}</p>}
      {job.status === 'failed' && job.error_message && <p className="error-text">{job.error_message}</p>}
      <div className="row">
        {running && (
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        {(job.status === 'failed' || job.status === 'cancelled') && (
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
      {running && <p className="hint">This usually takes about 5 minutes. You can leave this page; the build keeps going.</p>}
    </section>
  )
}

function RoomPage({ propertyId, roomId }: { propertyId: string; roomId: string }) {
  const house = useAsync(() => api.properties.get(propertyId), [propertyId])
  const room = useAsync(() => api.rooms.get(propertyId, roomId), [propertyId, roomId])
  const [job, setJob] = useState<Job | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const previews = useObjectUrls(files)

  useEffect(() => {
    api.jobs.latestForRoom(roomId).then(setJob).catch(() => {})
  }, [roomId])

  const running = job && !TERMINAL_JOB_STATUSES.has(job.status)
  useEffect(() => {
    if (!job || !running) return
    const t = setInterval(async () => {
      try {
        const next = await api.jobs.get(job.id)
        setJob(next)
        if (TERMINAL_JOB_STATUSES.has(next.status)) room.reload()
      } catch {
        /* keep polling */
      }
    }, 3000)
    return () => clearInterval(t)
  }, [job?.id, running]) // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (list: FileList | File[]) => {
    const images = Array.from(list).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))
    setError(images.length < Array.from(list).length ? 'Only image files can be used.' : null)
    setFiles((prev) => {
      const next = [...prev, ...images]
      if (next.length > MAX_PHOTOS) setError(`A room can use up to ${MAX_PHOTOS} photos — extra photos were left out.`)
      return next.slice(0, MAX_PHOTOS)
    })
  }

  const start = async () => {
    setError(null)
    try {
      const j = await buildRoom(api, roomId, files, setStep)
      setJob(j)
      setFiles([])
      room.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStep(null)
    }
  }

  const r = room.data
  return (
    <Shell
      crumbs={[
        { label: 'Houses', to: '#/' },
        { label: house.data?.name ?? '…', to: href({ name: 'house', propertyId }) },
        { label: r?.name ?? '…' },
      ]}
      actions={
        r?.status === 'ready' && (
          <a className="btn primary" href={href({ name: 'tour', propertyId, roomId })}>
            Walk through
          </a>
        )
      }
    >
      {room.error && <ErrorNote message={room.error} onRetry={room.reload} />}
      {r && (
        <section className="intro">
          <h1>{r.name}</h1>
          <p>
            {prettyRoomType(r.room_type)} · <StatusBadge status={r.status} />
          </p>
        </section>
      )}

      {job && (
        <JobPanel
          job={job}
          onCancel={async () => setJob(await api.jobs.cancel(job.id).catch(() => job))}
          onRetry={async () => {
            try {
              setJob(await api.jobs.retry(job.id))
            } catch (e) {
              setError((e as Error).message)
            }
          }}
        />
      )}

      {!running && (
        <section className="capture">
          <h2>{r?.status === 'ready' ? 'Rebuild this room' : 'Add photos of this room'}</h2>
          <p className="muted">
            One photo works. For a better result, add 2–{MAX_PHOTOS} photos taken from the same spot, turning about 90° between
            shots, with the same zoom.
          </p>
          <div
            className={`dropzone ${dragging ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              addFiles(e.dataTransfer.files)
            }}
            onClick={() => input.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          >
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <strong>Drop photos here or click to choose</strong>
            <span className="muted">
              {files.length} / {MAX_PHOTOS} photos
            </span>
          </div>

          {files.length > 0 && (
            <ul className="previews">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <img src={previews[i]} alt={`Photo ${i + 1}: ${f.name}`} />
                  <button className="remove" aria-label={`Remove ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <ErrorNote message={error} />}
          <div className="row">
            <button className="btn primary" disabled={files.length === 0 || !!step} onClick={start}>
              {step ?? `Build 3D room from ${files.length || ''} photo${files.length === 1 ? '' : 's'}`.replace('from  ', 'from ')}
            </button>
          </div>
        </section>
      )}
    </Shell>
  )
}

/* ---------------- App ---------------- */

export function Dashboard() {
  const route = useRoute()
  switch (route.name) {
    case 'houses':
      return <HousesPage />
    case 'house':
      return <HousePage propertyId={route.propertyId} />
    case 'room':
      return <RoomPage propertyId={route.propertyId} roomId={route.roomId} />
    case 'tour':
      return (
        <div className="tour">
          <Suspense
            fallback={
              <div className="center">
                <div className="spinner" />
              </div>
            }
          >
            <Walkthrough
              request={{ propertyId: route.propertyId, roomId: route.roomId }}
              onExit={() =>
                navigate(route.roomId ? { name: 'room', propertyId: route.propertyId, roomId: route.roomId } : { name: 'house', propertyId: route.propertyId })
              }
            />
          </Suspense>
        </div>
      )
    default:
      return (
        <Shell crumbs={[{ label: 'Not found' }]}>
          <p className="empty">
            That page doesn't exist. <a href="#/">Go to your houses</a>
          </p>
        </Shell>
      )
  }
}
