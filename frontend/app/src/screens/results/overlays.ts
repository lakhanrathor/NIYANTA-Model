/**
 * Overlay features the Results map draws — visibility toggled through the
 * mission context (`view.hiddenLayers`), so every map on screen agrees.
 * Ids must match the feature ids the orchestrator builds.
 */
export const RESULTS_OVERLAYS = [
  { id: 'river-path', label: 'River path' },
  { id: 'build-downstream-reach', label: 'Active flood reach' },
  { id: 'build-reach-terminus', label: 'Reach terminus' },
  { id: 'selected-dam', label: 'Dam' },
  { id: 'flood-gauges', label: 'Gauges' },
  { id: 'flood-breach', label: 'Breach' },
  { id: 'watch-boxes', label: 'Watch boxes' },
  { id: 'probe', label: 'Inspected point' },
]
