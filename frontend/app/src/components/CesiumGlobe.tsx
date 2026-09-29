/**
 * CESIUM GLOBE — the 3D overlay of the shared map shell. READ THIS BEFORE EDITING.
 *
 * Contract (locked): same deal as MapShell — PAGE-UNAGNOSTIC, context-only.
 * The globe receives exactly two props, `features` and `fit` (viewport scoping
 * for this slot), and reads EVERYTHING else from `river-context`:
 * `view.mode` (mounts only in 3D), mission river + build draft (dam geometry
 * with Build's overrides). It never takes mission objects as props and never
 * gets called directly — screens publish to context, this subscribes.
 *
 * ── ENTITY CONTRACT (keep MapShell's 2D renderer in agreement) ──────────────
 * - LineString → polyline, `clampToGround: true`, `width: f.width ?? 3`.
 * - Polygon .... → ground-draped polygon (`heightReference: CLAMP_TO_GROUND`,
 *   outline on). NEVER `classificationType: TERRAIN` — it only renders against
 *   3D Tiles, so on the plain globe every polygon stays INVISIBLE (this exact
 *   bug hid all 3D overlays once; do not reintroduce it).
 * - Point ...... → clamped marker + label. Display ranges are GLOBE-scale
 *   (dam 8,000 km, others 2,000 km; labels 2,000/500 km) — 2D-scale cutoffs
 *   hide every marker at overview zoom.
 * - Dam model ... → built ONLY from registry/draft measurements (height, crest
 *   length, axis). Missing dimension = no model, marker only. Never invent one.
 *
 * ── BOOT / READY PROTOCOL ───────────────────────────────────────────────────
 * Cesium arrives as a global script that can still be loading when 3D is first
 * toggled. The init effect polls (`bootAttempt`, ~6 s) instead of bailing, and
 * NOTHING touches the viewer until `ready` is set — entity sync and camera
 * effects both gate on it. Keep `ready` in those dep arrays.
 * Sync pattern: `removeAll()` + re-add on `[features, dam, is3D, ready]`.
 * New global layers arrive via the shared `features` prop automatically (the
 * shell appends e.g. the `build-domain` ring) — nothing to wire here.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MapFeature } from './MapShell'
import { useApp } from '../lib/store'
import { useRiverContext } from '../lib/river-context'

declare const Cesium: any

interface Props {
  features: MapFeature[]
  fit: number[] | null
}

/**
 * The 3D globe. It takes only what is specific to *this* map instance — the
 * layers to draw and the camera target — and reads everything else from the
 * mission context: which dam, its geometry, whether Build has overridden its
 * height or axis, and the shared 2D/3D switch. No component hands it state.
 */
export function CesiumGlobe({ features, fit }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<any>(null)
  // The Cesium script can still be loading when 3D is first toggled — the
  // init effect polls on this counter instead of bailing forever, and the
  // sync/camera effects wait for `ready` before touching the viewer.
  const [bootAttempt, setBootAttempt] = useState(0)
  const [ready, setReady] = useState(false)

  const mode = useRiverContext((s) => s.view.mode)
  const is3D = mode === '3d'
  const river = useRiverContext((s) => s.river)
  const build = useRiverContext((s) => s.build)

  // Registry record first, then whatever the Build draft currently says — the
  // same precedence the Build screen shows, but sourced from one shared place.
  const dam = useMemo(() => {
    if (!river?.damId || typeof river.damLon !== 'number' || typeof river.damLat !== 'number')
      return null
    return {
      id: river.damId,
      name: river.damName ?? river.damId,
      lon: river.damLon,
      lat: river.damLat,
      height_m: build?.height_m ?? river.damHeight,
      crest_m: build?.crest_m ?? river.damCrest,
      length_m: null as number | null,
      crest_length_m: build?.crest_length_m ?? river.damCrestLength,
      heading_deg: build?.heading_deg ?? river.damHeadingDeg,
      axis_heading_deg: build?.axis_heading_deg ?? river.damHeadingDeg,
      dam_heading_deg: build?.dam_heading_deg ?? river.damHeadingDeg,
    }
  }, [river, build])

  useEffect(() => {
    if (!containerRef.current) return
    if (typeof Cesium === 'undefined') {
      if (bootAttempt < 40) {
        const t = setTimeout(() => setBootAttempt((a) => a + 1), 150)
        return () => clearTimeout(t)
      }
      return
    }

    // 1. Initialize Cesium with reliable satellite imagery capped at max available provider zoom (17)
    // When zooming in closer, Cesium automatically overzooms/upscales the highest available tile instead of requesting missing higher-level tiles.
    const esriProvider = new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 17,
      credit: 'Esri World Imagery',
    })

    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false,
      sceneMode: is3D ? Cesium.SceneMode.SCENE3D : Cesium.SceneMode.SCENE2D,
      baseLayer: new Cesium.ImageryLayer(esriProvider),
    })

    // Explicitly add the imagery layer to ensure satellite tiles drape immediately
    viewer.imageryLayers.removeAll()
    viewer.imageryLayers.addImageryProvider(esriProvider)

    // Hide the bottom-left Cesium ion branding overlay
    if (viewer.cesiumWidget?.creditContainer) {
      viewer.cesiumWidget.creditContainer.style.display = 'none'
    }

    viewerRef.current = viewer
    setReady(true)

    // Enable depth testing against real terrain elevation
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.enableLighting = true

    // Live mouse cursor tracking in Cesium 3D
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement: any) => {
      const ray = viewer.camera.getPickRay(movement.endPosition)
      if (ray) {
        const cartesian = viewer.scene.globe.pick(ray, viewer.scene)
        if (cartesian) {
          const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
          const lon = Cesium.Math.toDegrees(cartographic.longitude)
          const lat = Cesium.Math.toDegrees(cartographic.latitude)
          useApp.getState().setCursor({ lat, lon })
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    // Load worldwide 3D elevation terrain (free public ArcGIS 3D elevation server, no token required)
    try {
      Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
        'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer',
      )
        .then((terrainProvider: any) => {
          if (viewer && !viewer.isDestroyed()) {
            viewer.terrainProvider = terrainProvider
          }
        })
        .catch(() => {
          // Fallback to basic ellipsoid if network terrain is unreachable
        })
    } catch {
      // ignore
    }

    return () => {
      handler.destroy()
      useApp.getState().setCursor(null)
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy()
      }
      viewerRef.current = null
      setReady(false)
    }
  }, [bootAttempt])

  // 2. Smooth 2D / 3D Mode Switch directly within Cesium
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || typeof Cesium === 'undefined' || viewer.isDestroyed()) return

    if (is3D) {
      if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) {
        viewer.scene.morphTo3D(0.8)
      }
    } else {
      if (viewer.scene.mode !== Cesium.SceneMode.SCENE2D) {
        viewer.scene.morphTo2D(0.8)
      }
    }
  }, [is3D])

  // 3. Camera Flying & Elevation View
  // Keyed on bounds VALUES, not array identity: screens rebuild the same
  // array on every render (list hover, corridor refetch), and a re-fly on
  // each one reads as the whole 3D view "re-initiating".
  const fitRef = useRef(fit)
  useEffect(() => {
    fitRef.current = fit
  }, [fit])
  const fitKey =
    fit && fit.length === 4 && fit.every((v) => typeof v === 'number' && !Number.isNaN(v))
      ? fit.join(',')
      : null
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || typeof Cesium === 'undefined' || viewer.isDestroyed()) return

    if (dam && typeof dam.lon === 'number' && typeof dam.lat === 'number') {
      // Altitude is a camera choice, not a claim about the dam: fall back to a
      // fixed stand-off distance rather than inventing a height.
      const height = typeof dam.height_m === 'number' ? dam.height_m : 0
      const alt = is3D ? Math.max(900, height * 70) : Math.max(3500, height * 250)
      const pitch = is3D ? -35 : -90

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          dam.lon,
          is3D ? dam.lat - 0.015 : dam.lat,
          alt,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(pitch),
          roll: 0.0,
        },
        duration: 1.2,
      })
    } else if (fitRef.current && fitRef.current.length === 4) {
      const [w, s, e, n] = fitRef.current
      viewer.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(w, s, e, n),
        duration: 1.2,
      })
    }
    // `fitKey` carries the bounds; dam identity + mode complete the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, dam?.id, dam?.lon, dam?.lat, is3D, ready])

  // 4. Synchronize Vector Features & 3D Dam Model
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || typeof Cesium === 'undefined' || viewer.isDestroyed()) return

    viewer.entities.removeAll()

    // Render Vector Polylines / Polygons / Points
    for (const f of features) {
      if (!f.data?.features) continue
      for (const feat of f.data.features) {
        const geom = feat.geometry
        if (!geom) continue

        if (geom.type === 'LineString') {
          const coords = geom.coordinates
          const pos = coords.map((c) => Cesium.Cartesian3.fromDegrees(c[0], c[1]))
          viewer.entities.add({
            name: f.label,
            polyline: {
              positions: pos,
              width: f.width ?? 3,
              material: Cesium.Color.fromCssColorString(f.color),
              clampToGround: true,
            },
          })
        } else if (geom.type === 'Polygon') {
          const ring = geom.coordinates[0]
          if (ring && ring.length >= 3) {
            const pos = ring.map((c) => Cesium.Cartesian3.fromDegrees(c[0], c[1]))
            viewer.entities.add({
              name: f.label,
              polygon: {
                hierarchy: pos,
                material: Cesium.Color.fromCssColorString(f.color).withAlpha(
                  f.fillOpacity ?? 0.3,
                ),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString(f.color),
                // Ground-draped polygon. (classificationType: TERRAIN only
                // renders against 3D Tiles — on the plain globe it stays
                // invisible, which is why overlays never appeared in 3D.)
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
            })
          }
        } else if (geom.type === 'Point') {
          const [lon, lat] = geom.coordinates
          const isSelected = f.id === 'selected-dam'
          const isTerminus = f.id === 'build-reach-terminus'
          const shouldLabel = isSelected || isTerminus || (feat.properties as any)?.showLabel === true
          const name = (feat.properties as any)?.title ?? (feat.properties as any)?.name ?? f.label

          const entityConfig: any = {
            name: name,
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            point: {
              pixelSize: isSelected ? 12 : (f.radius ?? 6) * 1.4,
              color: Cesium.Color.fromCssColorString(f.color),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: isSelected ? 3 : 1.5,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              // This globe is overview-scale — the old 80 km cutoff hid every
              // marker the moment you zoomed out to the river.
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
                0,
                isSelected ? 8000000 : 2000000,
              ),
            },
          }

          if (shouldLabel) {
            entityConfig.label = {
              text: name,
              font: isSelected ? 'bold 12px sans-serif' : '10px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -10),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
                0,
                isSelected ? 2000000 : 500000,
              ),
            }
          }

          viewer.entities.add(entityConfig)
        }
      }
    }

    // Render the 3D dam only from measurements the registry actually holds.
    // A missing height, crest length or axis means no model and no wall — the
    // marker the feature layer already drew is the whole story. Nothing here
    // invents a dimension or an orientation.
    if (dam && typeof dam.lon === 'number' && typeof dam.lat === 'number') {
      const height = typeof dam.height_m === 'number' ? dam.height_m : null
      const length = dam.crest_length_m ?? dam.length_m
      const axisHeading =
        typeof dam.axis_heading_deg === 'number'
          ? dam.axis_heading_deg
          : typeof dam.heading_deg === 'number'
            ? dam.heading_deg
            : null
      const modelHeading =
        typeof dam.dam_heading_deg === 'number'
          ? dam.dam_heading_deg
          : typeof dam.heading_deg === 'number'
            ? dam.heading_deg
            : axisHeading

      const damPos = Cesium.Cartesian3.fromDegrees(dam.lon, dam.lat, 0)

      // 3D Dam GLB — scaled by the measured height, rotated by the measured axis.
      if (height != null) {
        // Cesium heading rotates clockwise from North, hence the negation.
        const headingRad = Cesium.Math.toRadians(-(modelHeading ?? 0))
        const hpr = new Cesium.HeadingPitchRoll(headingRad, 0, 0)
        viewer.entities.add({
          name: `3D Structure · ${dam.name}`,
          position: damPos,
          orientation: Cesium.Transforms.headingPitchRollQuaternion(damPos, hpr),
          model: {
            uri: '/Dam.glb',
            minimumPixelSize: 64,
            maximumScale: 300,
            scale: Math.max(0.7, height / 16),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        })
      }

      // Crest wall + extrusion — needs the crest length and the axis heading.
      if (height != null && typeof length === 'number' && typeof axisHeading === 'number') {
        const rad = (axisHeading * Math.PI) / 180
        const halfLen = length / 2
        const kmToLat = 1 / 111320
        const kmToLon = 1 / (111320 * Math.max(Math.cos((dam.lat * Math.PI) / 180), 0.05))
        const dLon = halfLen * Math.cos(rad) * kmToLon
        const dLat = halfLen * Math.sin(rad) * kmToLat

        const wallPositions = [
          Cesium.Cartesian3.fromDegrees(dam.lon - dLon, dam.lat - dLat, height),
          Cesium.Cartesian3.fromDegrees(dam.lon + dLon, dam.lat + dLat, height),
        ]
        viewer.entities.add({
          name: `3D Dam Embankment (${height} m · ${length} m · axis ${axisHeading}°)`,
          wall: {
            positions: wallPositions,
            minimumHeights: [0, 0],
            maximumHeights: [height, height],
            material: Cesium.Color.fromCssColorString('#94a3b8'),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#334155'),
          },
          corridor: {
            positions: wallPositions,
            width: 14.0,
            material: Cesium.Color.fromCssColorString('#64748b'),
            extrudedHeight: height,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          },
        })
      }
    }
  }, [features, dam, is3D, ready])

  return <div ref={containerRef} className="h-full w-full" />
}
