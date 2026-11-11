import { describe, expect, it } from 'vitest'
import { href, parseRoute, type Route } from './router'

const P = '3f1c2a9e-1111-4a2b-9c3d-000000000001'
const R = '7a8b9c0d-2222-4e5f-8a9b-000000000002'

describe('parseRoute', () => {
  it.each([
    ['', { name: 'houses' }],
    ['#', { name: 'houses' }],
    ['#/', { name: 'houses' }],
    [`#/houses/${P}`, { name: 'house', propertyId: P }],
    [`#/houses/${P}/`, { name: 'house', propertyId: P }],
    [`#/houses/${P}/rooms/${R}`, { name: 'room', propertyId: P, roomId: R }],
    [`#/houses/${P}/tour`, { name: 'tour', propertyId: P, roomId: undefined }],
    [`#/houses/${P}/tour/${R}`, { name: 'tour', propertyId: P, roomId: R }],
  ])('%s', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected)
  })

  it.each(['#/nope', '#/houses', '#/houses/x', `#/houses/${P}/rooms`, `#/houses/${P}/rooms/${R}/extra`, '#/houses/<script>'])(
    'unknown path %s is notFound',
    (hash) => {
      expect(parseRoute(hash)).toEqual({ name: 'notFound' })
    },
  )
})

describe('href', () => {
  const routes: Route[] = [
    { name: 'houses' },
    { name: 'house', propertyId: P },
    { name: 'room', propertyId: P, roomId: R },
    { name: 'tour', propertyId: P },
    { name: 'tour', propertyId: P, roomId: R },
  ]

  it.each(routes)('round-trips %o', (route) => {
    const parsed = parseRoute(href(route))
    expect(parsed).toMatchObject(route)
  })

  it('notFound links home', () => {
    expect(href({ name: 'notFound' })).toBe('#/')
  })
})
