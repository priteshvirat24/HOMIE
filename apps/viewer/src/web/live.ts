/**
 * Live build progress. Listens to the API's Server-Sent Events stream for a job and falls back to
 * polling when the browser (or a proxy) can't hold a stream open.
 */
import { useEffect, useRef, useState } from 'react'
import { api, TERMINAL_JOB_STATUSES, type Client, type Job } from './client'

export type LiveMode = 'idle' | 'connecting' | 'stream' | 'poll'

export const POLL_MS = 3000

export function jobEventsUrl(jobId: string, base = ''): string {
  return `${base}/api/v1/reconstruction-jobs/${jobId}/events`
}

export function isRunning(job: Pick<Job, 'status'> | null | undefined): boolean {
  return !!job && !TERMINAL_JOB_STATUSES.has(job.status)
}

/**
 * Keeps `job` current while it runs. `onFinish` fires once when it reaches ready, failed or cancelled.
 */
export function useLiveJob(initial: Job | null, onFinish?: (job: Job) => void, client: Client = api) {
  const [job, setJob] = useState<Job | null>(initial)
  const [mode, setMode] = useState<LiveMode>('idle')
  const finished = useRef(onFinish)
  finished.current = onFinish

  // Follow a different job when the caller hands one in (first load, retry from elsewhere).
  useEffect(() => setJob(initial), [initial?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const id = job?.id
  const running = isRunning(job)

  useEffect(() => {
    if (!id || !running) {
      setMode('idle')
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setInterval> | undefined
    let source: EventSource | undefined

    const accept = (next: Job) => {
      if (stopped) return
      setJob(next)
      if (!isRunning(next)) {
        stop()
        finished.current?.(next)
      }
    }
    const poll = () => {
      setMode('poll')
      timer = setInterval(() => {
        client.jobs.get(id).then(accept).catch(() => {
          /* keep polling */
        })
      }, POLL_MS)
    }
    function stop() {
      stopped = true
      source?.close()
      if (timer) clearInterval(timer)
      setMode('idle')
    }

    if (typeof EventSource === 'undefined') {
      poll()
    } else {
      setMode('connecting')
      source = new EventSource(jobEventsUrl(id))
      source.onopen = () => !stopped && setMode('stream')
      source.addEventListener('job', (e) => accept(JSON.parse((e as MessageEvent).data)))
      source.addEventListener('gone', () => stop())
      source.onerror = () => {
        // The browser retries on its own while CONNECTING; a CLOSED source means give up and poll.
        if (stopped || source?.readyState !== 2) return
        source.close()
        poll()
      }
    }
    return () => {
      stopped = true
      source?.close()
      if (timer) clearInterval(timer)
    }
  }, [id, running]) // eslint-disable-line react-hooks/exhaustive-deps

  return { job, setJob, mode }
}

/* ---------- build stages ---------- */

export const BUILD_STAGES = [
  { key: 'queued', label: 'Waiting for the builder' },
  { key: 'photos', label: 'Preparing your photos' },
  { key: 'world', label: 'Building the 3D world' },
  { key: 'download', label: 'Fetching the scene' },
  { key: 'save', label: 'Saving it to the house' },
] as const

const WAITING = new Set(['created', 'validating_input', 'queued', 'waiting_for_worker'])

/** Index into BUILD_STAGES for a job; BUILD_STAGES.length once it is ready. */
export function buildStageIndex(job: Pick<Job, 'status' | 'progress'>): number {
  if (job.status === 'ready') return BUILD_STAGES.length
  if (WAITING.has(job.status) && job.progress <= 0) return 0
  if (job.progress < 0.15) return 1
  if (job.progress < 0.82) return 2
  if (job.progress < 0.92) return 3
  return 4
}

/** "4m 05s", "52s", "1h 02m" */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

/** Re-renders every `ms` while `active`, returning the current time. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}
