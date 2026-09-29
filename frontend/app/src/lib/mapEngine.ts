import { Map } from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'

/**
 * SHARED MAP ENGINE
 *
 * One MapLibre instance for every single-map screen (Watch, Discover, Run,
 * Results). The instance is created by the first screen that mounts and then
 * adopted — never destroyed — by each later screen: the canvas element moves
 * into the new screen's holder, tiles stay cached, the GL context survives
 * and the camera is exactly where the analyst left it. Only the overlay
 * layers swap (MapShell's features effect already converges those).
 *
 * Compare panes and the minimap deliberately stay private (`shared={false}`):
 * several live maps cannot share one instance.
 */

let shared: Map | null = null

export function acquireSharedMap(
  container: HTMLElement,
  style: StyleSpecification,
): { map: Map; fresh: boolean } {
  if (!shared) {
    shared = new Map({
      container,
      style,
      center: [80.5, 22.5],
      zoom: 4.2,
      attributionControl: false,
      maxPitch: 70,
    })
    return { map: shared, fresh: true }
  }
  const el = shared.getContainer()
  // Re-acquires land here with the SAME holder (StrictMode / effect
  // reconnect / HMR) — appending the container into itself, or into one of
  // its own descendants, throws HierarchyRequestError. Only move when the
  // target is a genuinely different, outside node.
  if (el !== container && !el.contains(container) && el.parentElement !== container) {
    // A popup the previous screen left behind belongs to unmounted state —
    // the new screen's hover effect draws its own.
    el.querySelectorAll('.maplibregl-popup').forEach((p) => p.remove())
    container.appendChild(el)
  }
  // The holder geometry changed (new screen, new cell): re-measure without
  // touching sources, layers or the camera.
  shared.resize()
  return { map: shared, fresh: false }
}
