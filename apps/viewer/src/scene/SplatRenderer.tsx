/**
 * Gaussian-splat renderer using Spark.
 * Adapted from image-blaster (https://github.com/neilsonnn/image-blaster, app/src/modules/splat/SplatRenderer.tsx,
 * MIT License, Copyright (c) 2026 Neilson Koerner-Safrata) — depth-of-field patching removed, load progress added.
 */
import { useEffect, useMemo, useRef } from 'react'
import { extend, useThree } from '@react-three/fiber'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import type * as THREE from 'three'
import { useViewerStore } from '../store'

const SparkRendererEl = extend(SparkRenderer)
const SplatMeshEl = extend(SplatMesh)
const ignoreRaycast: THREE.Object3D['raycast'] = () => {}

interface Props {
  url: string
  groundPlaneOffset: number
  flipY: boolean
  metricScaleFactor: number
}

export function SplatRenderer({ url, groundPlaneOffset, flipY, metricScaleFactor }: Props) {
  const renderer = useThree((s) => s.gl)
  const splatRef = useRef<SplatMesh>(null)
  const sparkRef = useRef<SparkRenderer>(null)
  const { setSplatProgress, setSplatReady, setSplatError } = useViewerStore.getState()

  useEffect(() => {
    setSplatReady(false)
    setSplatProgress(0)
    setSplatError(null)
  }, [url, setSplatProgress, setSplatReady, setSplatError])

  // Spark rejects `initialized` when the file can't be downloaded or parsed.
  useEffect(() => {
    let live = true
    splatRef.current?.initialized.catch((e: unknown) => {
      if (live) setSplatError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      live = false
    }
  }, [url, setSplatError])

  useEffect(() => {
    if (splatRef.current) splatRef.current.raycast = ignoreRaycast
    if (sparkRef.current) sparkRef.current.raycast = ignoreRaycast
  })

  const sparkArgs = useMemo(() => ({ renderer, enableLod: true }), [renderer])
  const splatArgs = useMemo(
    () => ({
      url,
      onProgress: (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) setSplatProgress(e.loaded / e.total)
      },
      onLoad: () => {
        setSplatProgress(1)
        setSplatReady(true)
      },
    }),
    [url, setSplatProgress, setSplatReady],
  )

  return (
    <SparkRendererEl ref={sparkRef} args={[sparkArgs]}>
      <group position={[0, groundPlaneOffset, 0]} rotation={[flipY ? Math.PI : 0, 0, 0]} scale={metricScaleFactor}>
        <SplatMeshEl key={url} ref={splatRef} args={[splatArgs]} />
      </group>
    </SparkRendererEl>
  )
}
