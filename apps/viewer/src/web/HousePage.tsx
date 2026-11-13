/** One house, drawn as a floor plan: built rooms are lit with their own photo, the rest are outlines. */
import { useEffect, useState, type FormEvent } from 'react'
import { Footprints, Plus } from 'lucide-react'
import { api, plural, prettyRoomType, ROOM_TYPES, thumbnailUrl, type Job, type Room } from './client'
import { href, navigate } from './router'
import { useLiveJob } from './live'
import { Shell } from './Shell'
import { ErrorNote, RoomIcon, Status, useAsync } from './ui'

/** Live percentage for a room that is being built. */
function BuildingMeter({ roomId, onDone }: { roomId: string; onDone: () => void }) {
  const [first, setFirst] = useState<Job | null>(null)
  useEffect(() => {
    api.jobs.latestForRoom(roomId).then(setFirst).catch(() => {})
  }, [roomId])
  const { job } = useLiveJob(first, onDone)
  const pct = Math.round((job?.progress ?? 0) * 100)
  return (
    <>
      <span className="cell-pct">{pct}%</span>
      <div className="meter" role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div style={{ transform: `scaleX(${Math.max(0.03, pct / 100)})` }} />
      </div>
    </>
  )
}

function RoomCell({ room, propertyId, onBuilt }: { room: Room; propertyId: string; onBuilt: () => void }) {
  const thumb = thumbnailUrl(room)
  const lit = room.status === 'ready' && thumb
  return (
    <li className={`cell ${lit ? 'cell-lit' : 'cell-plan'} cell-${room.status}`}>
      <a href={href({ name: 'room', propertyId, roomId: room.id })}>
        <div className="thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
          {!lit && (
            <span className="cell-icon">
              <RoomIcon type={room.room_type} size={20} />
            </span>
          )}
        </div>
        <div className="cell-label">
          <strong>{room.name}</strong>
          <span className="cell-meta">
            <span>{prettyRoomType(room.room_type) === room.name ? '' : prettyRoomType(room.room_type)}</span>
            <Status status={room.status} />
          </span>
        </div>
        {room.status === 'processing' && <BuildingMeter roomId={room.id} onDone={onBuilt} />}
      </a>
    </li>
  )
}

function AddRoomCell({ propertyId }: { propertyId: string }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('living_room')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const room = await api.rooms.create(propertyId, { name: name.trim(), room_type: type })
      navigate({ name: 'room', propertyId, roomId: room.id })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="cell cell-add">
      <form onSubmit={add}>
        <span className="add-title">
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          New room
        </span>
        <input aria-label="Room name" placeholder="Name, like Main bedroom" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="field-row">
          <span className="select-icon">
            <RoomIcon type={type} size={16} />
          </span>
          <select aria-label="Room type" value={type} onChange={(e) => setType(e.target.value)}>
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {prettyRoomType(t)}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add room'}
        </button>
        {error && <ErrorNote message={error} />}
      </form>
    </li>
  )
}

export function HousePage({ propertyId }: { propertyId: string }) {
  const house = useAsync(() => api.properties.get(propertyId), [propertyId])
  const rooms = useAsync(() => api.rooms.list(propertyId), [propertyId])
  const list = Array.isArray(rooms.data) ? rooms.data : null

  // Room status changes (captured → processing → ready) also come from the worker; refresh now and then.
  const building = list?.some((r) => r.status === 'processing')
  useEffect(() => {
    if (!building) return
    const t = setInterval(rooms.reload, 15000)
    return () => clearInterval(t)
  }, [building, rooms.reload])

  const ready = list?.filter((r) => r.status === 'ready').length ?? 0
  const total = list?.length ?? 0

  return (
    <Shell
      crumbs={[{ label: 'Houses', to: '#/' }, { label: house.data?.name ?? '…' }]}
      actions={
        ready > 0 && (
          <a className="btn btn-lamp" href={href({ name: 'tour', propertyId })}>
            <Footprints size={16} strokeWidth={1.5} aria-hidden />
            Walk through house
          </a>
        )
      }
    >
      {house.error && <ErrorNote message={house.error} onRetry={house.reload} />}
      {house.data && (
        <header className="page-head">
          <div>
            <h1>{house.data.name}</h1>
            <p className="lede">
              {house.data.address ? `${house.data.address} · ` : ''}
              {ready} of {total} rooms ready in 3D
            </p>
          </div>
          {total > 0 && (
            <div className="plan-legend" aria-hidden>
              <span>
                <span className="lamp lamp-lit" /> Lit when ready
              </span>
              <span>
                <span className="lamp lamp-off" /> Needs photos
              </span>
            </div>
          )}
        </header>
      )}

      {rooms.error && <ErrorNote message={rooms.error} onRetry={rooms.reload} />}

      <section className="section">
        <h2 className="section-title">
          Floor plan <span className="count">{list ? plural(total, 'room') : ''}</span>
        </h2>
        {list && list.length === 0 && <p className="empty-line">No rooms yet. Add the first room, then photograph it</p>}
        <ul className="plan">
          {list?.map((r) => (
            <RoomCell key={r.id} room={r} propertyId={propertyId} onBuilt={rooms.reload} />
          ))}
          <AddRoomCell propertyId={propertyId} />
        </ul>
      </section>
    </Shell>
  )
}
