/** Small shared pieces of the HOMIE web app. */
import { useCallback, useEffect, useState } from 'react'
import {
  Bath,
  BedDouble,
  Car,
  CircleAlert,
  CookingPot,
  DoorOpen,
  Fence,
  Monitor,
  Sofa,
  Square,
  UtensilsCrossed,
  WashingMachine,
  type LucideIcon,
} from 'lucide-react'
import { statusLabel } from './client'

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
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

const ROOM_ICONS: Record<string, LucideIcon> = {
  living_room: Sofa,
  bedroom: BedDouble,
  kitchen: CookingPot,
  bathroom: Bath,
  dining_room: UtensilsCrossed,
  hallway: DoorOpen,
  balcony: Fence,
  office: Monitor,
  garage: Car,
  laundry: WashingMachine,
}

export function RoomIcon({ type, size = 18 }: { type: string; size?: number }) {
  const Icon = ROOM_ICONS[type] ?? Square
  return <Icon size={size} strokeWidth={1.5} aria-hidden />
}

/**
 * The lamp: HOMIE's status mark. Lit means the room is ready to walk through,
 * a slow pulse means it is being built right now.
 */
export function Lamp({ state }: { state: 'lit' | 'live' | 'off' | 'fault' }) {
  return <span className={`lamp lamp-${state}`} aria-hidden />
}

export function lampFor(status: string): 'lit' | 'live' | 'off' | 'fault' {
  if (status === 'ready') return 'lit'
  if (status === 'processing') return 'live'
  if (status === 'failed') return 'fault'
  return 'off'
}

export function Status({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      <Lamp state={lampFor(status)} />
      {statusLabel(status)}
    </span>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="note" role="alert">
      <CircleAlert size={16} strokeWidth={1.5} aria-hidden />
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-quiet btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}
