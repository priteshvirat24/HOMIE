/** Home: the latest walkable room turning slowly, then every house. */
import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Footprints } from 'lucide-react'
import { api, shortCaption, latestReadyRoom, plural, thumbnailUrl, type Property, type Room, type SceneInfo } from './client'
import { href, navigate } from './router'
import { EmptyPlan, Panorama } from './art'
import { Shell } from './Shell'
import { ErrorNote, Lamp, useAsync } from './ui'

interface HouseWithRooms extends Property {
  rooms: Room[] | null
}

function useHousesWithRooms() {
  const houses = useAsync(() => api.properties.list(), [])
  const [rooms, setRooms] = useState<Record<string, Room[]>>({})
  useEffect(() => {
    if (!Array.isArray(houses.data)) return
    let live = true
    houses.data.forEach((h) =>
      api.rooms
        .list(h.id)
        .then((list) => live && Array.isArray(list) && setRooms((prev) => ({ ...prev, [h.id]: list })))
        .catch(() => {}),
    )
    return () => {
      live = false
    }
  }, [houses.data])
  const list: HouseWithRooms[] | null = Array.isArray(houses.data) ? houses.data.map((h) => ({ ...h, rooms: rooms[h.id] ?? null })) : null
  return { ...houses, list }
}

function Featured({ houses }: { houses: HouseWithRooms[] }) {
  const all = houses.flatMap((h) => (h.rooms ?? []).map((r) => ({ ...r, house: h })))
  const room = latestReadyRoom(all)
  const [scene, setScene] = useState<SceneInfo | null>(null)
  useEffect(() => {
    if (!room) return
    api.scenes.forRoom(room.id).then(setScene).catch(() => setScene(null))
  }, [room?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!room) {
    return (
      <section className="feature feature-empty">
        <EmptyPlan />
        <div className="feature-copy">
          <h2>Your first room lights up here</h2>
          <p>Add a house, then upload up to eight photos of a room. A few minutes later you can walk through it.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="feature">
      <Panorama src={scene?.urls?.panorama} fallback={thumbnailUrl(room)} alt={`360° view of ${room.name}`} />
      <div className="feature-overlay">
        <div className="feature-copy">
          <span className="eyebrow">
            <Lamp state="lit" />
            Latest room · {room.house.name}
          </span>
          <h2>{room.name}</h2>
          {scene?.caption && <p className="caption">{shortCaption(scene.caption)}</p>}
        </div>
        <a className="btn btn-lamp btn-lg" href={href({ name: 'tour', propertyId: room.property_id, roomId: room.id })}>
          <Footprints size={18} strokeWidth={1.5} aria-hidden />
          Walk through
        </a>
      </div>
    </section>
  )
}

function HouseCard({ house }: { house: HouseWithRooms }) {
  const rooms = house.rooms ?? []
  const ready = rooms.filter((r) => r.status === 'ready')
  const [broken, setBroken] = useState<string[]>([])
  const good = (rooms.map(thumbnailUrl).filter(Boolean) as string[]).filter((s) => !broken.includes(s)).slice(0, 3)
  return (
    <a className="house-card" href={href({ name: 'house', propertyId: house.id })}>
      <div className={`house-shots shots-${Math.max(1, good.length)}`}>
        {good.length ? (
          good.map((s) => <img key={s} src={s} alt="" loading="lazy" onError={() => setBroken((b) => [...b, s])} />)
        ) : (
          <EmptyPlan />
        )}
      </div>
      <div className="house-body">
        <strong>{house.name}</strong>
        {house.address && <span className="secondary">{house.address}</span>}
        <span className="house-meta">
          <span>{plural(house.room_count, 'room')}</span>
          {ready.length > 0 && (
            <span className="lit-count">
              <Lamp state="lit" />
              {ready.length} ready to walk
            </span>
          )}
        </span>
      </div>
      <ArrowRight className="house-go" size={16} strokeWidth={1.5} aria-hidden />
    </a>
  )
}

function NewHouseForm() {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const p = await api.properties.create({ name: name.trim(), address: address.trim() || undefined })
      navigate({ name: 'house', propertyId: p.id })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="add-card" onSubmit={create}>
      <span className="add-title">New house</span>
      <input id="house-name" aria-label="House name" placeholder="Name, like Lake cottage" value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Address (optional)" placeholder="Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} />
      <button className="btn btn-primary" disabled={busy || !name.trim()}>
        {busy ? 'Adding…' : 'Add house'}
      </button>
      {error && <ErrorNote message={error} />}
    </form>
  )
}

export function HousesPage() {
  const { list, error, loading, reload } = useHousesWithRooms()
  const rooms = list?.reduce((n, h) => n + h.room_count, 0) ?? 0

  return (
    <Shell crumbs={[{ label: 'Houses' }]}>
      <header className="page-head">
        <div>
          <h1>Houses</h1>
          <p className="lede">Photograph a room, then walk through it in 3D a few minutes later</p>
        </div>
        {list && list.length > 0 && (
          <p className="head-stat">
            {plural(list.length, 'house')} · {plural(rooms, 'room')}
          </p>
        )}
      </header>

      {error && <ErrorNote message={error} onRetry={reload} />}
      {list && <Featured houses={list} />}
      {loading && !list && !error && <div className="feature feature-loading" aria-label="Loading" />}

      <section className="section">
        <h2 className="section-title">All houses</h2>
        {list && list.length === 0 && <p className="empty-line">No houses yet. Add one to start photographing rooms</p>}
        <ul className="house-grid">
          {list?.map((h) => (
            <li key={h.id}>
              <HouseCard house={h} />
            </li>
          ))}
          <li>
            <NewHouseForm />
          </li>
        </ul>
      </section>
    </Shell>
  )
}

