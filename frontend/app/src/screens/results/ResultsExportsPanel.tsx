import { Panel } from '../../components/ui'
import { ExportPanel } from '../../components/ExportPanel'

/**
 * Geospatial export bundles for this run — the shared `ExportPanel` job flow
 * (`POST /exports` → poll → download) plus the live HTML report. Replaces the
 * old buttons that never downloaded and reported success on failure.
 */
export function ResultsExportsPanel({
  runId,
  label,
}: {
  runId: string | null
  label: string
}) {
  return (
    <Panel title="Export Results & Geospatial Bundles">
      <ExportPanel key={runId ?? 'none'} runId={runId} label={label} accent="#0b6bcb" />
    </Panel>
  )
}
