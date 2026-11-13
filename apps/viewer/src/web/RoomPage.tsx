/** One room: shoot it, watch it build live, then step inside. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Footprints, ImagePlus, RefreshCw, X } from 'lucide-react'
import { api, shortCaption, buildRoom, MAX_PHOTOS, prettyRoomType, thumbnailUrl, type Job, type SceneInfo } from './client'
import { href } from './router'
import { isRunning, useLiveJob } from './live'
import { Panorama, ShotGuide } from './art'
import { BuildPanel } from './BuildPanel'
import { Shell } from './Shell'
import { ErrorNote, Kbd, RoomIcon, Status, useAsync } from './ui'

function useObjectUrls(files: File[]) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  return urls
}

const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)

function Capture({
  files,
  previews,
  step,
  error,
  onAdd,
  onRemove,
  onBuild,
}: {
  files: File[]
  previews: string[]
  step: string | null
  error: string | null
  onAdd: (list: FileList | File[]) => void
  onRemove: (i: number) => void
  onBuild: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const n = files.length

  return (
    <section className="capture">
      <div
        className={`dropzone ${over ? 'over' : ''} ${n ? 'has-files' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          onAdd(e.dataTransfer.files)
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Drop photos here or click to choose"
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <input
          ref={input}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) onAdd(e.target.files)
            e.target.value = ''
          }}
        />
        <span className="drop-icon">
          <ImagePlus size={20} strokeWidth={1.5} aria-hidden />
        </span>
        <strong>Drop photos here or click to choose</strong>
        <span className="secondary">JPEG, PNG, WebP or iPhone HEIC</span>
      </div>

      <div className="slots" aria-label="Photos">
        {Array.from({ length: MAX_PHOTOS }, (_, i) =>
          files[i] ? (
            <div key={`${files[i].name}-${i}`} className="slot filled">
              <img src={previews[i]} alt={`Photo ${i + 1}: ${files[i].name}`} />
              <span className="slot-n">{i + 1}</span>
              <button className="slot-remove" aria-label={`Remove ${files[i].name}`} onClick={() => onRemove(i)}>
                <X size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          ) : (
            <div key={`empty-${i}`} className="slot" aria-hidden>
              <span className="slot-n">{i + 1}</span>
            </div>
          ),
        )}
      </div>

      {error && <ErrorNote message={error} />}

      <footer className="capture-foot">
        <span className="photo-count">
          {n} / {MAX_PHOTOS} photos
        </span>
        <button className="btn btn-primary btn-lg" disabled={n === 0 || !!step} onClick={onBuild}>
          {step ?? (n ? `Build 3D room from ${n} photo${n === 1 ? '' : 's'}` : 'Build 3D room')}
        </button>
      </footer>
    </section>
  )
}

function ShootTips({ taken }: { taken: number }) {
  return (
    <section className="aside-card">
      <h2>How to shoot it</h2>
      <ShotGuide active={Math.min(taken, 4)} />
      <ul className="tips">
        <li>Stand near the middle of the room and keep the same zoom</li>
        <li>Turn about 90° between photos, so neighbouring shots overlap a little</li>
        <li>One photo works. Two to {MAX_PHOTOS} give the builder more of the room</li>
      </ul>
    </section>
  )
}

export function RoomPage({ propertyId, roomId }: { propertyId: string; roomId: string }) {
  const house = useAsync(() => api.properties.get(propertyId), [propertyId])
  const room = useAsync(() => api.rooms.get(propertyId, roomId), [propertyId, roomId])
  const [latest, setLatest] = useState<Job | null>(null)
  const [scene, setScene] = useState<SceneInfo | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [sent, setSent] = useState<File[]>([])
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const previews = useObjectUrls(files)
  const sentPreviews = useObjectUrls(sent)

  useEffect(() => {
    api.jobs.latestForRoom(roomId).then(setLatest).catch(() => {})
  }, [roomId])

  const { job, setJob, mode } = useLiveJob(latest, () => room.reload())

  const r = room.data
  const isReady = r?.status === 'ready'
  useEffect(() => {
    if (!isReady) return
    api.scenes.forRoom(roomId).then(setScene).catch(() => setScene(null))
  }, [isReady, roomId])

  const addFiles = (list: FileList | File[]) => {
    const all = Array.from(list)
    const images = all.filter(isImage)
    setError(images.length < all.length ? 'Only image files can be used' : null)
    setFiles((prev) => {
      const next = [...prev, ...images]
      if (next.length > MAX_PHOTOS) setError(`A room can use up to ${MAX_PHOTOS} photos, so the extra ones were left out`)
      return next.slice(0, MAX_PHOTOS)
    })
  }

  const start = async () => {
    setError(null)
    try {
      const j = await buildRoom(api, roomId, files, setStep)
      setSent(files)
      setJob(j)
      setFiles([])
      setRebuilding(false)
      room.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStep(null)
    }
  }

  const running = isRunning(job)
  const failed = job && (job.status === 'failed' || job.status === 'cancelled')
  const showScene = isReady && !running && !rebuilding
  const tour = href({ name: 'tour', propertyId, roomId })

  return (
    <Shell
      crumbs={[
        { label: 'Houses', to: '#/' },
        { label: house.data?.name ?? '…', to: href({ name: 'house', propertyId }) },
        { label: r?.name ?? '…' },
      ]}
      actions={
        isReady &&
        !showScene && (
          <a className="btn btn-lamp" href={tour}>
            <Footprints size={16} strokeWidth={1.5} aria-hidden />
            Walk through
          </a>
        )
      }
    >
      {room.error && <ErrorNote message={room.error} onRetry={room.reload} />}
      {r && (
        <header className="page-head">
          <div>
            <h1>{r.name}</h1>
            <p className="lede lede-meta">
              <RoomIcon type={r.room_type} size={16} />
              {prettyRoomType(r.room_type) !== r.name && (
                <>
                  {prettyRoomType(r.room_type)}
                  <span className="sep" aria-hidden>
                    ·
                  </span>
                </>
              )}
              <Status status={r.status} />
            </p>
          </div>
        </header>
      )}

      <div className="room-layout">
        <div className="room-main">
          {running && job && (
            <BuildPanel
              job={job}
              mode={mode}
              photos={sentPreviews}
              onCancel={async () => setJob(await api.jobs.cancel(job.id).catch(() => job))}
            />
          )}

          {showScene && (
            <section className="stage">
              <Panorama src={scene?.urls?.panorama} fallback={r && thumbnailUrl(r)} alt={`360° view of ${r?.name ?? 'the room'}`} />
              <div className="stage-overlay">
                {scene?.caption && <p className="caption">{shortCaption(scene.caption)}</p>}
                <a className="btn btn-lamp btn-lg" href={tour}>
                  <Footprints size={18} strokeWidth={1.5} aria-hidden />
                  Walk through
                </a>
              </div>
            </section>
          )}

          {!running && !showScene && (
            <>
              {failed && (
                <section className="failure" role="alert">
                  <div>
                    <strong>{job!.status === 'failed' ? 'Build failed' : 'Build cancelled'}</strong>
                    {job!.status === 'failed' && job!.error_message && <p>{job!.error_message}</p>}
                  </div>
                  <button
                    className="btn btn-quiet"
                    onClick={async () => {
                      try {
                        setJob(await api.jobs.retry(job!.id))
                      } catch (e) {
                        setError((e as Error).message)
                      }
                    }}
                  >
                    <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
                    Try again
                  </button>
                </section>
              )}
              <Capture
                files={files}
                previews={previews}
                step={step}
                error={error}
                onAdd={addFiles}
                onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
                onBuild={start}
              />
            </>
          )}
        </div>

        <aside className="room-aside">
          {isReady && (
            <section className="aside-card">
              <h2>3D room ready</h2>
              <p className="secondary">
                {job?.completed_at
                  ? `Built ${new Date(job.completed_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : 'Built and saved'}
              </p>
              <ul className="keys">
                <li>
                  <span className="keycaps">
                    <Kbd>W</Kbd>
                    <Kbd>A</Kbd>
                    <Kbd>S</Kbd>
                    <Kbd>D</Kbd>
                  </span>
                  Walk
                </li>
                <li>
                  <span className="keycaps">
                    <Kbd>Drag</Kbd>
                  </span>
                  Look around
                </li>
                <li>
                  <span className="keycaps">
                    <Kbd>Double-click</Kbd>
                  </span>
                  Mouse look, Esc to stop
                </li>
              </ul>
            </section>
          )}
          {isReady && !running && (
            <section className="aside-card">
              <h2>Rebuild this room</h2>
              <p className="secondary">New photos replace the current 3D room once the build finishes.</p>
              {!rebuilding ? (
                <button className="btn btn-quiet" onClick={() => setRebuilding(true)}>
                  <ImagePlus size={16} strokeWidth={1.5} aria-hidden />
                  Use new photos
                </button>
              ) : (
                <button className="btn btn-quiet" onClick={() => setRebuilding(false)}>
                  Keep the current room
                </button>
              )}
            </section>
          )}
          {running && (
            <section className="aside-card">
              <h2>While it builds</h2>
              <p className="secondary">
                World Labs turns your photos into a 3D room you can walk around in. When it finishes, this room lights up on the
                floor plan.
              </p>
            </section>
          )}
          {!running && (!isReady || rebuilding) && <ShootTips taken={files.length} />}
        </aside>
      </div>
    </Shell>
  )
}
