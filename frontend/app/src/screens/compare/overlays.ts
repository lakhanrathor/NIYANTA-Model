/**
 * Overlay features the compare screens draw — visibility toggled through the
 * mission context (`view.hiddenLayers`), so every map on screen agrees.
 * Ids must match the feature ids the orchestrator builds.
 */
export const COMPARE_OVERLAYS = [
  { id: 'river-corridor', label: 'River corridor' },
  { id: 'river-path', label: 'River path' },
  { id: 'build-downstream-reach', label: 'Active flood reach' },
  { id: 'aoi', label: 'Simulation domain' },
  { id: 'selected-dam', label: 'Dam' },
  { id: 'probe', label: 'Inspected point' },
]
