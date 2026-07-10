/**
 * HOMIE 3D Viewer — Main Application
 *
 * Renders a 3D scene with Gaussian splats, collision meshes, and first-person controls.
 * Designed to run inside a WebView in the React Native mobile app.
 *
 * Communication with the host app is via postMessage API:
 * - Receives: { type: 'LOAD_SCENE', sceneUrl: string, manifest: SceneManifest }
 * - Sends: { type: 'VIEWER_READY' }, { type: 'FPS', fps: number }, etc.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { SceneViewer } from './components/SceneViewer'
import { LoadingScreen } from './components/LoadingScreen'
import { TouchControls } from './components/TouchControls'
import { ViewerHUD } from './components/ViewerHUD'
import { useViewerStore } from './store/viewer'

export function App() {
  const { sceneUrl, manifest, isLoading, setScene } = useViewerStore()
  const [error, setError] = useState<string | null>(null)

  // Listen for messages from the React Native host
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data.type === 'LOAD_SCENE') {
          setScene(data.sceneUrl, data.manifest)
          setError(null)
        }
      } catch {
        // Ignore non-JSON messages
      }
    }

    window.addEventListener('message', handleMessage)

    // Notify host that viewer is ready
    window.parent?.postMessage(JSON.stringify({ type: 'VIEWER_READY' }), '*')

    return () => window.removeEventListener('message', handleMessage)
  }, [setScene])

  // For standalone testing: load scene from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const url = params.get('scene')
    if (url) {
      setScene(url, null)
    }
  }, [setScene])

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#ef4444', fontFamily: 'system-ui', padding: 20, textAlign: 'center' }}>
        <div>
          <h2>Failed to load scene</h2>
          <p style={{ color: '#a1a1aa', marginTop: 8 }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!sceneUrl) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#71717a', fontFamily: 'system-ui' }}>
        <p>Waiting for scene data...</p>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ fov: 70, near: 0.01, far: 1000 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#0a0a0a']} />
        <ambientLight intensity={0.4} />
        <Physics gravity={[0, -9.81, 0]}>
          <Suspense fallback={null}>
            <SceneViewer sceneUrl={sceneUrl} manifest={manifest} />
          </Suspense>
        </Physics>
      </Canvas>
      <TouchControls />
      <ViewerHUD />
      {isLoading && <LoadingScreen />}
    </div>
  )
}
