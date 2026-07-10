/**
 * LoadingScreen — Full-screen loading overlay.
 */

export function LoadingScreen() {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(10, 10, 10, 0.9)',
      zIndex: 100,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        width: 40,
        height: 40,
        border: '3px solid rgba(255, 255, 255, 0.1)',
        borderTopColor: '#818cf8',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }} />
      <p style={{ color: '#a1a1aa', marginTop: 16, fontSize: 14 }}>Loading scene...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
