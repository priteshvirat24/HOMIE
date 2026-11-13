import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Dashboard } from './web/Dashboard'
import '@fontsource-variable/instrument-sans'
import '@fontsource/instrument-serif/400.css'
import './styles.css'

const Walkthrough = lazy(() => import('./Walkthrough').then((m) => ({ default: m.Walkthrough })))

/**
 * /viewer/?property=…&room=…  or  ?room=…  or  ?scene=…  → bare walkthrough (what the phone's WebView opens)
 * /viewer/                                               → the HOMIE web app
 */
const params = new URLSearchParams(window.location.search)
const embedded = params.has('property') || params.has('room') || params.has('scene')
document.body.classList.add(embedded ? 'mode-walk' : 'mode-web')

createRoot(document.getElementById('root')!).render(
  embedded ? (
    <Suspense fallback={null}>
      <Walkthrough request={{ propertyId: params.get('property'), roomId: params.get('room'), sceneUrl: params.get('scene') }} />
    </Suspense>
  ) : (
    <Dashboard />
  ),
)
