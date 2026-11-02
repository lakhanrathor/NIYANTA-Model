import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { EM_DASH, latLon, num } from '../../lib/format'
import { Empty, Icon, Pill } from '../../components/ui'
import type { CascadeDam } from '../../lib/api'
import { useRiverContext } from '../../lib/river-context'
import { PlayerScene } from '../PlayerScene'
import { parseFrameStack } from './waterMaterial'
import { StoryCaption } from './StoryCaption'
import { usePlayer } from './PlayerProvider'
import { LAYER_IDS } from './types'

/** Stable empty list — selectors must not mint a new array per call. */
const NO_DAMS: CascadeDam[] = []

/**
 * CENTRE — the 3D viewport. Owns the PlayerScene instance and every effect
 * that feeds it (terrain shell, dam pin, villages, display options,
 * per-frame water, colour overlays). Overlays are honest status only.
 */
export function Viewport({
  leftOpen,
  onShowLeft,
  onHideLeft,
  rightOpen,
  onShowRight,
  onHideRight,
}: {
  leftOpen: boolean
  onShowLeft: () => void
  onHideLeft: () => void
  rightOpen: boolean
  onShowRight: () => void
  onHideRight: () => void
}) {
  const p = usePlayer()
  const {
    runId, bbox, bboxKey, damView, damKey, mountRef, sceneRef,
    terrainDoc, ramps, clamped, water, setWater, setPick,
    setSelectedVillage, setOverlayState,
    terrainExag, waterExag, waterOpacity, hiddenLayers,
    villages, selectedVillage, colorMode, playing, speed, showParticles,
  } = p
  // Layer visibility is mission state, not page state.
  const showTerrain = !hiddenLayers.includes(LAYER_IDS.terrain)
  const showDam = !hiddenLayers.includes(LAYER_IDS.dam)
  const showWater = !hiddenLayers.includes(LAYER_IDS.water)
  const showVillages = !hiddenLayers.includes(LAYER_IDS.villages)
  const showCascade = !hiddenLayers.includes(LAYER_IDS.cascade)
  const showInfra = !hiddenLayers.includes(LAYER_IDS.infra)
  // Cascade screening + picked dam live in the mission context (runId-scoped
  // like outputs) — pins here and lists anywhere read the same snapshot.
  const cascadeDams = useRiverContext((s) => (s.cascade?.runId === runId ? (s.cascade?.dams ?? NO_DAMS) : NO_DAMS))
  const selectedCascadeDam = useRiverContext((s) =>
    s.cascade?.runId === runId ? (s.cascade?.selectedDamId ?? null) : null,
  )
  const selectCascadeDam = useRiverContext((s) => s.selectCascadeDam)

  // One scene per mount. Picks mark the scene AND publish the point — the
  // Probe panel subscribes to it, never to this component. Village pins
  // select into the shared village slot instead of probing raster.
  useEffect(() => {
    if (!mountRef.current) return
    const scene = new PlayerScene(mountRef.current, {
      terrainExag: 1,
      waterExag: 1,
      waterOpacity: 0.95,
      showTerrain: true,
      showDam: true,
      showWater: true,
      showVillages: true,
      showCascade: true,
      showInfra: true,
    })
    scene.onPick = (lon, lat) => {
      scene.markPick(lon, lat)
      setPick({ lon, lat })
    }
    scene.onVillage = (v) => {
      setSelectedVillage(v)
      scene.focusAt(v.lon, v.lat)
    }
    scene.onCascadeDam = (d) => {
      selectCascadeDam(d.id)
      scene.focusAt(d.lon, d.lat)
    }
    scene.onOverlayState = (kind, status) => setOverlayState(kind, status)
    sceneRef.current = scene
    return () => {
      sceneRef.current = null
      scene.dispose()
    }
  }, [mountRef, sceneRef, setPick, setSelectedVillage,
    selectCascadeDam, setOverlayState])

  useEffect(() => {
    sceneRef.current?.setRun(runId)
  }, [runId, sceneRef])

  useEffect(() => {
    sceneRef.current?.setRamp(ramps.depth)
  }, [ramps.depth, sceneRef])

  useEffect(() => {
    sceneRef.current?.setOverlayRamp('arrival', ramps.arrival)
  }, [ramps.arrival, sceneRef])

  useEffect(() => {
    sceneRef.current?.setOverlayRamp('velocity', ramps.velocity)
  }, [ramps.velocity, sceneRef])

  useEffect(() => {
    sceneRef.current?.setGrid(terrainDoc.data ?? null, bbox)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainDoc.data, bboxKey])

  useEffect(() => {
    sceneRef.current?.setDam(damView)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [damKey])

  // The breach outflow series drives the jet through the opening.
  const hydroDoc = p.hydro.data
  useEffect(() => {
    sceneRef.current?.setHydrograph(hydroDoc?.time_s, hydroDoc?.q_cms)
  }, [hydroDoc, sceneRef])

  // The modelled breach opens in the dam wall as the run plays.
  const sum = p.summary.data
  useEffect(() => {
    const w = sum?.breach_width
    const d = sum?.breach_depth
    sceneRef.current?.setBreach(
      w != null && d != null ? { width_m: w, depth_m: d, tForm_s: (sum?.breach_t_form_hr ?? 0) * 3600 } : null,
    )
  }, [sum?.breach_width, sum?.breach_depth, sum?.breach_t_form_hr, damKey, sceneRef])

  useEffect(() => {
    sceneRef.current?.setVillages(villages)
  }, [villages, sceneRef])

  useEffect(() => {
    sceneRef.current?.setCascadeDams(
      cascadeDams.map((d) => ({ id: d.dam_id, name: d.name ?? 'Dam', lon: d.lon, lat: d.lat, status: d.status })),
    )
  }, [cascadeDams, sceneRef])

  useEffect(() => {
    sceneRef.current?.selectCascadeDam(selectedCascadeDam)
  }, [selectedCascadeDam, sceneRef])

  useEffect(() => {
    sceneRef.current?.selectVillage(selectedVillage)
  }, [selectedVillage, sceneRef])

  useEffect(() => {
    sceneRef.current?.setColorMode(colorMode)
  }, [colorMode, sceneRef])

  useEffect(() => {
    sceneRef.current?.setOptions({
      terrainExag, waterExag, waterOpacity, showTerrain, showDam, showWater, showVillages, showCascade, showInfra,
    })
  }, [sceneRef, terrainExag, waterExag, waterOpacity, hiddenLayers]) // eslint-disable-line react-hooks/exhaustive-deps

  // Every depth frame in one download → GPU texture array; playback then
  // glides between frames in the shader. Until it lands (or if it can't be
  // used) frames load one by one from the depth tiles.
  const [stackReady, setStackReady] = useState(false)
  const terrainStep = terrainDoc.data?.step ?? 1
  useEffect(() => {
    setStackReady(false)
    sceneRef.current?.setFrameStack(null)
    if (!runId || !terrainDoc.data) return
    let live = true
    fetch(`/api/runs/${runId}/frames.bin?step=${terrainStep}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (!live) return
        sceneRef.current?.setFrameStack(buf ? parseFrameStack(buf) : null)
        setStackReady(Boolean(sceneRef.current?.smooth))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [runId, terrainDoc.data, terrainStep, sceneRef])

  useEffect(() => {
    // tile path only — with the GPU stack the scene times the notch itself
    if (!stackReady && p.frameT != null) sceneRef.current?.setBreachTime(p.frameT)
  }, [p.frameT, stackReady, sceneRef]) // eslint-disable-line react-hooks/exhaustive-deps

  // Depth follows the playhead. Smooth path: no debounce, the surface glides
  // for one playback tick. Tile path: debounced (each frame is a download).
  const tickMs = 1200 / Number(speed)
  useEffect(() => {
    if (!runId || !bbox) return
    let live = true
    if (!stackReady) setWater(null)
    const timer = window.setTimeout(() => {
      sceneRef.current
        ?.setFrame(clamped, stackReady ? (playing ? tickMs : 250) : 0)
        .then((res) => {
          if (live) setWater(res)
        })
        .catch(() => {
          if (live) setWater({ status: 'no-tiles', wet: 0, total: 0 })
        })
    }, stackReady ? 0 : 120)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [runId, bboxKey, clamped, stackReady, sceneRef, setWater]) // eslint-disable-line react-hooks/exhaustive-deps

  // OSM infrastructure: fetched once per run, recoloured every frame — the
  // flood reaching, cutting and leaving roads and buildings.
  const infra = useApi(['run-infra', runId], () => api.runInfrastructure(runId!), {
    enabled: Boolean(runId),
    staleTime: 60_000,
  })
  useEffect(() => {
    sceneRef.current?.setInfrastructure(infra.data ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infra.data, bboxKey, sceneRef])
  useEffect(() => {
    sceneRef.current?.setInfraFrame(clamped)
  }, [clamped, infra.data, sceneRef])

  // SPH runs can draw the solver's particles over the water surface
  // (Layers → SPH particles); the surface stays — it is the readable view.
  const isSph = p.run.data?.run.engine === 'sph' && showParticles
  // count is tagged with its frame: while the next frame loads, the pill must
  // not show the previous frame's count under the new frame number
  const [particleState, setParticleState] = useState<{ frame: number; count: number } | null>(null)
  const particleCount = particleState && particleState.frame === clamped ? particleState.count : null
  useEffect(() => {
    if (!runId || !bbox || !isSph) {
      sceneRef.current?.setParticles(null)
      setParticleState(null)
      return
    }
    let live = true
    const frame = clamped
    api
      .runParticles(runId, frame)
      .then((res) => {
        if (!live) return
        sceneRef.current?.setParticles({ data: res.data, l0_m: res.l0_m })
        setParticleState({ frame, count: res.count })
      })
      .catch(() => {
        if (!live) return
        sceneRef.current?.setParticles(null)
        setParticleState(null)
      })
    return () => {
      live = false
    }
  }, [runId, bboxKey, clamped, isSph, sceneRef]) // eslint-disable-line react-hooks/exhaustive-deps

  const waterNote =
    !bbox
      ? null
      : particleCount != null
        ? `Frame ${clamped + 1} · SPH · ${num(particleCount, 0)} particles`
        : isSph && particleState
          ? `Frame ${clamped + 1} · loading particles…`
          : water == null
          ? 'Loading depth raster…'
          : water.status === 'no-tiles'
            ? 'No depth tiles for this frame'
            : water.status === 'dry'
              ? `Frame ${clamped + 1} · dry everywhere`
              : `Frame ${clamped + 1} · ${num(water.wet, 0)} of ${num(water.total, 0)} cells wet${stackReady ? ' · smooth' : ''}`

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-white">
      {!leftOpen && (
        <button
          onClick={onShowLeft}
          title="Show controls"
          className="absolute left-2 top-2 z-30 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line-strong)] bg-white text-[var(--muted)] hover:text-[var(--text)]"
        >
          <Icon name="chevronRight" size={13} />
        </button>
      )}
      {!rightOpen && (
        <button
          onClick={onShowRight}
          title="Show telemetry"
          className="absolute right-2 top-2 z-30 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line-strong)] bg-white text-[var(--muted)] hover:text-[var(--text)]"
        >
          <Icon name="chevronLeft" size={13} />
        </button>
      )}
      {leftOpen && (
        <button
          onClick={onHideLeft}
          title="Hide controls"
          className="absolute left-2 top-1/2 z-30 flex h-12 w-5 -translate-y-1/2 items-center justify-center rounded-md border border-[var(--line-strong)] bg-white/90 text-[var(--muted)] hover:text-[var(--text)]"
        >
          <Icon name="chevronLeft" size={13} />
        </button>
      )}
      {rightOpen && (
        <button
          onClick={onHideRight}
          title="Hide telemetry"
          className="absolute right-2 top-1/2 z-30 flex h-12 w-5 -translate-y-1/2 items-center justify-center rounded-md border border-[var(--line-strong)] bg-white/90 text-[var(--muted)] hover:text-[var(--text)]"
        >
          <Icon name="chevronRight" size={13} />
        </button>
      )}

      <div ref={mountRef} className="min-h-0 w-full flex-1 cursor-crosshair" />

      <div className="absolute left-3 top-2.5 z-10 flex items-center gap-2 rounded-md border border-[var(--line)] bg-white/95 px-2.5 py-1 text-[11px] backdrop-blur">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
        <span className="font-medium">3D player</span>
        <span className="num text-[var(--muted)]">{damView ? latLon(damView.lat, damView.lon) : EM_DASH}</span>
      </div>

      {bbox && (
        <div className="pointer-events-none absolute inset-x-0 top-11 z-10">
          <StoryCaption />
        </div>
      )}

      {waterNote && (
        <div className="absolute right-3 top-2.5 z-10">
          <Pill tone={water?.status === 'no-tiles' ? 'warn' : 'muted'}>{waterNote}</Pill>
        </div>
      )}
      {infra.data && showInfra && (
        <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-2 rounded-md border border-[var(--line)] bg-white/95 px-2.5 py-1.5 text-[11px] backdrop-blur">
          <span className="font-medium">OSM infrastructure</span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: '#c2410c' }} />
            under water now
          </span>
          <span className="flex items-center gap-1 text-[var(--muted)]">
            <span className="h-2 w-2 rounded-sm" style={{ background: '#f59e0b' }} />
            flooded earlier
          </span>
        </div>
      )}
      {terrainDoc.data?.source === 'synthetic' && bbox && (
        <div className="absolute bottom-14 left-3 z-10 max-w-[420px] rounded-md border border-amber-300 bg-amber-50/95 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900">
          <b>Synthetic test valley.</b> This run did not get real terrain for its study area, so the flood is
          modelled on an artificial valley — not the real ground around {damView?.name ?? 'the dam'}. Re-run it to
          model the real valley.
        </div>
      )}
      {damView?.placed === 'model' && terrainDoc.data?.source !== 'synthetic' && bbox && (
        <div className="absolute bottom-14 left-3 z-10">
          <Pill tone="warn">Dam shown at the model&apos;s breach cell — the registry point is outside this grid</Pill>
        </div>
      )}
      {terrainDoc.offline && bbox && (
        <div className="absolute left-3 top-11 z-10">
          <Pill tone="warn">DEM offline — flat relief, imagery only</Pill>
        </div>
      )}

      {!bbox && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 p-6">
          <Empty>
            No model domain for this run yet — no DEM bounds, no scenario AOI and no dam position.
            <br />
            Source: <span className="num">GET /runs/{runId ? runId.slice(0, 8) : '…'}…</span>
          </Empty>
        </div>
      )}
    </div>
  )
}
