/**
 * HOMIE web app: houses drawn as floor plans, rooms you shoot and watch build live, and the walkthrough.
 */
import { lazy, Suspense } from 'react'
import { navigate, useRoute } from './router'
import { HousesPage } from './HousesPage'
import { HousePage } from './HousePage'
import { RoomPage } from './RoomPage'
import { Shell } from './Shell'
import './web.css'

const Walkthrough = lazy(() => import('../Walkthrough').then((m) => ({ default: m.Walkthrough })))

export function Dashboard() {
  const route = useRoute()
  switch (route.name) {
    case 'houses':
      return <HousesPage />
    case 'house':
      return <HousePage key={route.propertyId} propertyId={route.propertyId} />
    case 'room':
      return <RoomPage key={route.roomId} propertyId={route.propertyId} roomId={route.roomId} />
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
          <p className="empty-line">
            That page doesn't exist. <a href="#/">Go to your houses</a>
          </p>
        </Shell>
      )
  }
}
