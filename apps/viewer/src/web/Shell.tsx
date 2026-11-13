/** App frame: a sidebar with every house, and a top bar with the path and the page's main action. */
import { useEffect, useState } from 'react'
import { House, Plus } from 'lucide-react'
import { api, type Property } from './client'
import { href, useRoute } from './router'

export interface Crumb {
  label: string
  to?: string
}

let cachedHouses: Property[] | null = null

function useHouses() {
  const [houses, setHouses] = useState<Property[] | null>(cachedHouses)
  useEffect(() => {
    let live = true
    api.properties
      .list()
      .then((list) => {
        if (!live || !Array.isArray(list)) return
        cachedHouses = list
        setHouses(list)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return houses
}

export function Mark() {
  // A roofline over a doorway: the house you walk into.
  return (
    <svg className="mark" viewBox="0 0 20 20" aria-hidden>
      <path d="M3 9.2 10 3l7 6.2V17H3z" />
      <path d="M8 17v-4.6h4V17" />
    </svg>
  )
}

export function newHouse() {
  window.location.hash = '#/'
  setTimeout(() => document.getElementById('house-name')?.focus(), 50)
}

function Sidebar() {
  const houses = useHouses()
  const route = useRoute()
  const current = 'propertyId' in route ? route.propertyId : null

  return (
    <aside className="sidebar">
      <a className="brand" href="#/">
        <Mark />
        HOMIE
      </a>

      <nav className="side-nav" aria-label="Houses">
        <a className="side-row" href="#/" aria-current={route.name === 'houses' ? 'page' : undefined}>
          <House size={16} strokeWidth={1.5} aria-hidden />
          <span>All houses</span>
        </a>

        <div className="side-group">
          <span className="side-label">Your houses</span>
          {houses?.map((h) => (
            <a
              key={h.id}
              className="side-row"
              href={href({ name: 'house', propertyId: h.id })}
              aria-current={h.id === current ? 'page' : undefined}
            >
              <span className="side-dot" aria-hidden />
              <span className="side-name">{h.name}</span>
              <span className="side-count">{h.room_count}</span>
            </a>
          ))}
          <button className="side-row side-add" onClick={newHouse}>
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            <span>New house</span>
          </button>
        </div>
      </nav>

      <p className="side-foot">3D rooms by World Labs Marble</p>
    </aside>
  )
}

export function Shell({ crumbs, children, actions }: { crumbs: Crumb[]; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="web">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <a className="brand brand-compact" href="#/" aria-label="HOMIE home">
            <Mark />
          </a>
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i}>{c.to ? <a href={c.to}>{c.label}</a> : <span aria-current="page">{c.label}</span>}</span>
            ))}
          </nav>
          <div className="topbar-actions">{actions}</div>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  )
}
