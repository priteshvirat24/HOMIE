// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type Job } from './client'
import { BUILD_STAGES, buildStageIndex, formatDuration, isRunning, jobEventsUrl, POLL_MS, useLiveJob, useNow } from './live'

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1',
  capture_session_id: 's1',
  engine: 'image_blaster',
  status: 'generating_world',
  progress: 0.4,
  retry_count: 0,
  created_at: '2026-11-14T10:00:00Z',
  ...over,
})

/** Minimal EventSource stand-in the tests can drive. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  readyState = 0
  closed = false
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {}
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    ;(this.listeners[type] ??= []).push(fn)
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  emit(type: string, data: unknown) {
    this.listeners[type]?.forEach((fn) => fn(new MessageEvent(type, { data: JSON.stringify(data) })))
  }
  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0
    this.onerror?.()
  }
}

const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]

describe('buildStageIndex', () => {
  it.each([
    ['queued', 0, 0],
    ['created', 0, 0],
    ['waiting_for_worker', 0, 0],
    ['downloading_images', 0.02, 1],
    ['downloading_images', 0.1, 1],
    ['generating_world', 0.15, 2],
    ['generating_world', 0.5, 2],
    ['postprocessing', 0.82, 3],
    ['postprocessing', 0.9, 3],
    ['uploading_artifacts', 0.92, 4],
    ['uploading_artifacts', 0.99, 4],
    ['ready', 1, BUILD_STAGES.length],
  ])('%s at %s → stage %s', (status, progress, expected) => {
    expect(buildStageIndex({ status, progress })).toBe(expected)
  })

  it('treats a queued job that already has progress as past waiting', () => {
    expect(buildStageIndex({ status: 'queued', progress: 0.05 })).toBe(1)
  })

  it('has five named stages', () => {
    expect(BUILD_STAGES.map((s) => s.key)).toEqual(['queued', 'photos', 'world', 'download', 'save'])
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [999, '0s'],
    [52_000, '52s'],
    [60_000, '1m 00s'],
    [245_000, '4m 05s'],
    [3_720_000, '1h 02m'],
    [-5000, '0s'],
  ])('%s ms → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('helpers', () => {
  it('builds the events url', () => {
    expect(jobEventsUrl('abc')).toBe('/api/v1/reconstruction-jobs/abc/events')
    expect(jobEventsUrl('abc', 'http://h')).toBe('http://h/api/v1/reconstruction-jobs/abc/events')
  })

  it.each([
    ['queued', true],
    ['generating_world', true],
    ['ready', false],
    ['failed', false],
    ['cancelled', false],
  ])('isRunning(%s) = %s', (status, running) => {
    expect(isRunning({ status })).toBe(running)
  })

  it('isRunning is false without a job', () => {
    expect(isRunning(null)).toBe(false)
  })
})

describe('useLiveJob with a stream', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opens the job stream and reports live mode', () => {
    const { result } = renderHook(() => useLiveJob(job()))
    expect(latest().url).toBe('/api/v1/reconstruction-jobs/j1/events')
    expect(result.current.mode).toBe('connecting')
    act(() => latest().open())
    expect(result.current.mode).toBe('stream')
  })

  it('applies each job event', () => {
    const { result } = renderHook(() => useLiveJob(job()))
    act(() => latest().emit('job', job({ progress: 0.7, current_message: 'Almost' })))
    expect(result.current.job?.progress).toBe(0.7)
    expect(result.current.job?.current_message).toBe('Almost')
  })

  it('closes the stream and calls onFinish once the job is done', () => {
    const onFinish = vi.fn()
    const { result } = renderHook(() => useLiveJob(job(), onFinish))
    const source = latest()
    act(() => source.emit('job', job({ status: 'ready', progress: 1 })))
    expect(source.closed).toBe(true)
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish.mock.calls[0][0].status).toBe('ready')
    expect(result.current.mode).toBe('idle')
  })

  it('stops on a gone event', () => {
    const { result } = renderHook(() => useLiveJob(job()))
    act(() => latest().emit('gone', {}))
    expect(latest().closed).toBe(true)
    expect(result.current.mode).toBe('idle')
  })

  it('lets the browser retry while reconnecting', () => {
    const { result } = renderHook(() => useLiveJob(job()))
    act(() => latest().fail(false))
    expect(latest().closed).toBe(false)
    expect(result.current.mode).toBe('connecting')
  })

  it('falls back to polling when the stream is closed', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(job({ progress: 0.9 })), { status: 200 }))
    const client = createClient('', fetchImpl as unknown as typeof fetch)
    const { result } = renderHook(() => useLiveJob(job(), undefined, client))
    act(() => latest().fail(true))
    expect(result.current.mode).toBe('poll')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/reconstruction-jobs/j1', expect.anything())
    expect(result.current.job?.progress).toBe(0.9)
    vi.useRealTimers()
  })

  it('does not open a stream for a finished job', () => {
    const { result } = renderHook(() => useLiveJob(job({ status: 'ready', progress: 1 })))
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(result.current.mode).toBe('idle')
  })

  it('does nothing without a job', () => {
    const { result } = renderHook(() => useLiveJob(null))
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(result.current.job).toBeNull()
  })

  it('closes the stream on unmount', () => {
    const { unmount } = renderHook(() => useLiveJob(job()))
    const source = latest()
    unmount()
    expect(source.closed).toBe(true)
  })

  it('follows a new initial job', () => {
    const { result, rerender } = renderHook(({ j }) => useLiveJob(j), { initialProps: { j: job() } })
    rerender({ j: job({ id: 'j2' }) })
    expect(result.current.job?.id).toBe('j2')
    expect(latest().url).toContain('/j2/events')
  })
})

describe('useLiveJob without EventSource', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('polls and stops when the job finishes', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', undefined)
    const bodies = [job({ progress: 0.6 }), job({ status: 'failed', progress: 0.6, error_message: 'no credits' })]
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 }))
    const client = createClient('', fetchImpl as unknown as typeof fetch)
    const onFinish = vi.fn()
    const { result } = renderHook(() => useLiveJob(job(), onFinish, client))
    expect(result.current.mode).toBe('poll')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(result.current.job?.progress).toBe(0.6)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(result.current.job?.status).toBe('failed')
    expect(onFinish).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('useNow', () => {
  afterEach(() => vi.useRealTimers())

  it('ticks while active and stops when inactive', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T10:00:00Z'))
    const { result, rerender } = renderHook(({ active }) => useNow(active, 1000), { initialProps: { active: true } })
    const start = result.current
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current - start).toBe(3000)
    rerender({ active: false })
    const frozen = result.current
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current).toBe(frozen)
  })
})
