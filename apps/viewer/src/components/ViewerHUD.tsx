/**
 * ViewerHUD — Heads-up display with FPS counter and controls.
 */

import { useViewerStore } from '../store/viewer'

export function ViewerHUD() {
  const fps = useViewerStore((s) => s.fps)
  const showDebug = useViewerStore((s) => s.showDebug)
  const toggleDebug = useViewerStore((s) => s.toggleDebug)

  return (
    <>
      {/* Debug toggle button */}
      <button
        onClick={toggleDebug}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 8,
          color: '#a1a1aa',
          padding: '6px 12px',
          fontSize: 12,
          cursor: 'pointer',
          fontFamily: 'monospace',
          zIndex: 20,
          backdropFilter: 'blur(4px)',
        }}
      >
        {showDebug ? 'Hide Debug' : 'Debug'}
      </button>

      {/* Debug info panel */}
      {showDebug && (
        <div style={{
          position: 'absolute',
          top: 48,
          right: 12,
          background: 'rgba(0, 0, 0, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 8,
          padding: '8px 12px',
          color: '#a1a1aa',
          fontSize: 11,
          fontFamily: 'monospace',
          zIndex: 20,
          backdropFilter: 'blur(4px)',
          lineHeight: 1.8,
        }}>
          <div>FPS: <span style={{ color: fps >= 30 ? '#4ade80' : fps >= 15 ? '#fbbf24' : '#ef4444' }}>{fps}</span></div>
          <div>Renderer: Three.js + Rapier</div>
          <div>Engine: HOMIE Viewer v0.1</div>
        </div>
      )}

      {/* Reset position button */}
      <button
        onClick={() => {
          // Send reset message
          window.parent?.postMessage(JSON.stringify({ type: 'RESET_POSITION' }), '*')
        }}
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 8,
          color: '#a1a1aa',
          padding: '6px 12px',
          fontSize: 12,
          cursor: 'pointer',
          zIndex: 20,
          backdropFilter: 'blur(4px)',
        }}
      >
        ↺ Reset
      </button>
    </>
  )
}
