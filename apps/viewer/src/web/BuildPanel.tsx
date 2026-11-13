/** The live build: percentage, the five stages, elapsed time and the photos that went in. */
import { Check, X } from 'lucide-react'
import type { Job } from './client'
import { BUILD_STAGES, buildStageIndex, formatDuration, useNow, type LiveMode } from './live'
import { Lamp } from './ui'

function LiveBadge({ mode }: { mode: LiveMode }) {
  if (mode === 'stream') {
    return (
      <span className="live-badge" title="Updates arrive the moment the builder reports them">
        <Lamp state="live" />
        Live
      </span>
    )
  }
  return <span className="live-badge quiet">{mode === 'poll' ? 'Checking every 3s' : 'Connecting'}</span>
}

export function BuildPanel({ job, mode, photos, onCancel }: { job: Job; mode: LiveMode; photos: string[]; onCancel: () => void }) {
  const pct = Math.round(job.progress * 100)
  const stage = buildStageIndex(job)
  const now = useNow(true)
  const since = Date.parse(job.started_at ?? job.created_at)
  const elapsed = Number.isFinite(since) ? formatDuration(now - since) : null

  return (
    <section className="build" aria-live="polite">
      <header className="build-head">
        <strong>Building your 3D room</strong>
        <LiveBadge mode={mode} />
      </header>

      <div className="build-figure">
        <span className="pct">{pct}%</span>
        {elapsed && (
          <span className="elapsed">
            <span className="elapsed-time">{elapsed}</span> elapsed · usually 5 to 8 minutes
          </span>
        )}
      </div>

      <div className="meter meter-lg" role="progressbar" aria-label="Build progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div style={{ transform: `scaleX(${Math.max(0.02, job.progress)})` }} />
      </div>

      <ol className="steps">
        {BUILD_STAGES.map((s, i) => {
          const state = i < stage ? 'done' : i === stage ? 'now' : 'next'
          return (
            <li key={s.key} className={`step step-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="step-mark">{state === 'done' ? <Check size={14} strokeWidth={2} aria-hidden /> : state === 'now' ? <Lamp state="live" /> : null}</span>
              <span className="step-label">{s.label}</span>
              {state === 'now' && job.current_message && <span className="step-msg">{job.current_message}</span>}
            </li>
          )
        })}
      </ol>

      {photos.length > 0 && (
        <div className="sent">
          <span className="secondary">{photos.length === 1 ? '1 photo sent' : `${photos.length} photos sent`}</span>
          <ul>
            {photos.map((src, i) => (
              <li key={src}>
                <img src={src} alt={`Photo ${i + 1}`} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="build-foot">
        <span className="secondary">You can close this page. The build keeps going</span>
        <button className="btn btn-quiet btn-sm" onClick={onCancel}>
          <X size={14} strokeWidth={1.5} aria-hidden />
          Cancel
        </button>
      </footer>
    </section>
  )
}
