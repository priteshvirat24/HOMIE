import { useEffect, useState } from 'react'

/** Hash routes of the web app. */
export type Route =
  | { name: 'houses' }
  | { name: 'house'; propertyId: string }
  | { name: 'room'; propertyId: string; roomId: string }
  | { name: 'tour'; propertyId: string; roomId?: string }
  | { name: 'notFound' }

const UUIDISH = '([0-9a-fA-F-]{8,})'

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '') || '/'
  if (path === '/' || path === '') return { name: 'houses' }
  let m = path.match(new RegExp(`^/houses/${UUIDISH}$`))
  if (m) return { name: 'house', propertyId: m[1] }
  m = path.match(new RegExp(`^/houses/${UUIDISH}/rooms/${UUIDISH}$`))
  if (m) return { name: 'room', propertyId: m[1], roomId: m[2] }
  m = path.match(new RegExp(`^/houses/${UUIDISH}/tour(?:/${UUIDISH})?$`))
  if (m) return { name: 'tour', propertyId: m[1], roomId: m[2] }
  return { name: 'notFound' }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'houses':
      return '#/'
    case 'house':
      return `#/houses/${route.propertyId}`
    case 'room':
      return `#/houses/${route.propertyId}/rooms/${route.roomId}`
    case 'tour':
      return `#/houses/${route.propertyId}/tour${route.roomId ? `/${route.roomId}` : ''}`
    default:
      return '#/'
  }
}

export function navigate(route: Route) {
  window.location.hash = href(route)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
