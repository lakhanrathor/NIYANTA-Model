import type { ReactNode } from 'react'
import { Empty, Icon, Metric, Pill, Prov } from '../ui'
import { EM_DASH, num } from '../../lib/format'
import { useDamView } from './useDamView'
import type { DamView } from './useDamView'

export type DamCardVariant = 'full' | 'inline' | 'metrics'

/**
 * THE dam display. One component, three densities — every page renders dam
 * facts through exactly one of them, and every fact arrives via `useDamView`
 * (mission context + registry). No dam data travels through props, ever:
 *
 * - `full`: photo, header, the whole metric grid, provenance. The dam's home.
 * - `inline`: photo thumb + name + status in one header row. Panel headers
 *   that mix dam and scenario facts (Run, Results, Compare).
 * - `metrics`: the six structural facts alone. Embedding in scenario panels.
 *
 * `action` is a page-specific slot (e.g. Discover's Continue-to-Build button):
 * chrome, not data, so it stays a prop.
 */
export function DamCard({ variant = 'full', action }: { variant?: DamCardVariant; action?: ReactNode }) {
  const { dam, pending, imagePending } = useDamView()

  if (!dam) {
    if (variant === 'full' && pending) return <Empty>Loading the dam record…</Empty>
    return null
  }
  if (variant === 'inline')
    return (
      <div className="flex items-center gap-3 px-3 py-2.5">
        <DamThumb photoUrl={dam.photoUrl} name={dam.name} pending={imagePending} />
        <DamIdentity dam={dam} pending={pending} titleClass="text-[13px]" />
        <DamStatusPill dam={dam} />
      </div>
    )
  if (variant === 'metrics') return <DamMetrics dam={dam} />
  return (
    <>
      {dam.photoUrl && (
        <img
          src={dam.photoUrl}
          alt={`${dam.name ?? 'Dam'} — registry photo`}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
          className="block h-32 w-full border-b border-[var(--line)] object-cover"
        />
      )}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <DamIdentity dam={dam} pending={pending} titleClass="text-[14px]" />
        <DamStatusPill dam={dam} />
      </div>
      <DamMetrics dam={dam} />
      <div className="grid grid-cols-2 gap-px border-t border-[var(--line)] bg-[var(--line)]">
        <div className="bg-white">
          <Metric
            label="Full supply level"
            value={dam.fsl_m != null ? num(dam.fsl_m, 1) : EM_DASH}
            unit="m"
          />
        </div>
        <div className="bg-white">
          <Metric label="Purpose" value={dam.purpose ?? EM_DASH} />
        </div>
      </div>
      {action && <div className="border-t border-[var(--line)] p-3">{action}</div>}
      <Prov>Registry record merged with the mission context</Prov>
    </>
  )
}

/** Name + place line. Padding comes from the caller (header row vs banner). */
function DamIdentity({
  dam,
  pending,
  titleClass,
}: {
  dam: DamView
  pending: boolean
  titleClass: string
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className={`block truncate ${titleClass} font-semibold`}>
        {dam.name ?? (pending ? '…' : EM_DASH)}
      </span>
      {(dam.state || dam.alongKm !== null) && (
        <span className="num block truncate text-[10px] text-[var(--faint)]">
          {dam.state ?? ''}
          {dam.state && dam.alongKm !== null ? ' · ' : ''}
          {dam.alongKm !== null ? `${num(dam.alongKm, 1)} km along river` : ''}
        </span>
      )}
    </span>
  )
}

function DamStatusPill({ dam }: { dam: DamView }) {
  const inDb = dam.status === 'in_db'
  return (
    <Pill tone={inDb ? 'ok' : dam.status ? 'warn' : 'muted'}>
      {inDb ? 'In DB' : (dam.status ?? EM_DASH)}
    </Pill>
  )
}

/** Registry photo, honest tile while loading or absent. */
function DamThumb({
  photoUrl,
  name,
  pending,
}: {
  photoUrl: string | null
  name: string | null
  pending: boolean
}) {
  const box = 'h-12 w-16'
  if (pending && !photoUrl) {
    return (
      <div
        className={`flex ${box} shrink-0 items-center justify-center rounded border border-[var(--line)] bg-[var(--bg)] text-[var(--faint)]`}
      >
        …
      </div>
    )
  }
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name ?? 'Dam'}
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
        className={`${box} shrink-0 rounded border border-[var(--line)] object-cover`}
      />
    )
  }
  return (
    <div
      className={`flex ${box} shrink-0 flex-col items-center justify-center gap-0.5 rounded border border-[var(--line)] bg-[var(--bg)] text-[var(--faint)]`}
      title="GET /api/dams/{id}/image returned no imagery"
    >
      <Icon name="image" size={14} />
      <span className="text-[8px]">no image</span>
    </div>
  )
}

/** The six structural facts, no chrome — drops into any scenario panel. */
function DamMetrics({ dam }: { dam: DamView }) {
  return (
    <div className="grid grid-cols-2 gap-px border-t border-[var(--line)] bg-[var(--line)]">
      <div className="bg-white">
        <Metric
          label="Height"
          value={dam.height_m != null ? num(dam.height_m, 0) : EM_DASH}
          unit="m"
        />
        <Metric
          label="Crest length"
          value={dam.crest_length_m != null ? num(dam.crest_length_m, 0) : EM_DASH}
          unit="m"
        />
        <Metric label="Type" value={dam.dam_type ?? EM_DASH} />
      </div>
      <div className="bg-white">
        <Metric
          label="Crest level"
          value={dam.crest_m != null ? num(dam.crest_m, 1) : EM_DASH}
          unit="m"
        />
        <Metric
          label="Storage"
          value={dam.storage_mcm != null ? num(dam.storage_mcm, 1) : EM_DASH}
          unit="hm³"
        />
        <Metric
          label="Along river"
          value={dam.alongKm != null ? num(dam.alongKm, 1) : EM_DASH}
          unit="km"
        />
      </div>
    </div>
  )
}
