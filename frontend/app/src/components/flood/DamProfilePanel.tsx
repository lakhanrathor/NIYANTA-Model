import { useMemo } from 'react'
import type { DamRow, ScenarioSpec } from '../../lib/api'
import { EM_DASH, num } from '../../lib/format'
import { Empty, Metric } from '../ui'

interface Geometry {
  crest: number
  bed: number
  height: number
  water: number
  d: (e: number) => number
  x: (t: number) => number
  xm: (e: number) => number
}

/**
 * Longitudinal section through the dam: reservoir on the left, dam wall with
 * the breach notch cut through it, riverbed running off to the right, water
 * spilling through the notch. Every level comes from the dam record and the
 * scenario spec — nothing is drawn when the data is missing.
 */
function geometry(
  dam: DamRow | null,
  spec: ScenarioSpec | null,
  W: number,
  H: number,
): Geometry | null {
  const res = spec?.reservoir
  const crest = dam?.crest_m ?? res?.crest_level_m ?? null
  const height = dam?.height_m ?? res?.dam_height_m ?? null
  const bed = res?.bed_level_m ?? (crest != null && height != null ? crest - height : null)
  if (bed == null) return null
  const crestE = crest ?? (height != null ? bed + height : null)
  if (crestE == null) return null
  const heightE = Math.max(1, height ?? crestE - bed)
  const water = Math.min(
    res?.initial_level_m ?? dam?.fsl_m ?? crestE - heightE * 0.12,
    crestE + heightE * 0.02,
  )

  const L = 46
  const R = 128
  const T = 18
  const B = 30
  const minE = bed - heightE * 0.5
  const maxE = crestE + heightE * 0.3
  return {
    crest: crestE,
    bed,
    height: heightE,
    water,
    d: (e: number) => T + ((maxE - e) / (maxE - minE)) * (H - T - B),
    x: (t: number) => L + ((t + 1) / 2) * (W - L - R),
    // elevation → x of the dam's upstream face (slope 1:2.5 in section)
    xm: (e: number) => {
      const t = Math.min(1, Math.max(0, (e - bed) / (crestE - bed)))
      return -0.16 + t * (0.16 - 0.045)
    },
  }
}

export function DamProfilePanel({
  dam,
  spec,
  peakCms,
}: {
  dam: DamRow | null
  spec: ScenarioSpec | null
  peakCms?: number | null
}) {
  const W = 640
  const H = 232
  const g = useMemo(() => geometry(dam, spec, W, H), [dam, spec])
  if (!g) {
    return <Empty>Dam elevation data (crest / bed / height) is missing — no section to draw.</Empty>
  }

  const res = spec?.reservoir
  const br = spec?.breach
  const breachDepth = Math.min(br?.depth_m ?? g.height * 0.35, g.height * 0.9)
  const breachTopY = g.d(g.crest)
  const breachBotY = g.d(g.crest - breachDepth)
  const crestL = g.x(-0.045)
  const crestR = g.x(0.045)
  const baseL = g.x(-0.16)
  const baseR = g.x(0.16)
  const bedY = g.d(g.bed)
  const waterY = g.d(g.water)
  const waterFaceX = g.x(g.xm(g.water))

  // downstream bed: falls away from the dam toe
  const downToeY = g.d(g.bed - g.height * 0.18)
  const downEndY = g.d(g.bed - g.height * 0.4)

  const ground = (pts: string, close: string) => `${pts} ${close}`
  const upstreamGround = ground(
    `M ${g.x(-1)} ${bedY} L ${baseL} ${bedY}`,
    `L ${baseL} ${g.d(g.bed - g.height)} L ${g.x(-1)} ${g.d(g.bed - g.height)} Z`,
  )
  const downstreamGround = ground(
    `M ${baseR} ${downToeY} L ${g.x(1)} ${downEndY}`,
    `L ${g.x(1)} ${g.d(g.bed - g.height)} L ${baseR} ${g.d(g.bed - g.height)} Z`,
  )
  const waterPoly = `M ${g.x(-1)} ${bedY} L ${g.x(-1)} ${waterY} L ${waterFaceX} ${waterY} L ${baseL} ${bedY} Z`
  const damPoly = `M ${baseL} ${bedY} L ${crestL} ${breachTopY} L ${crestR} ${breachTopY} L ${baseR} ${bedY} Z`
  // Notch cut through the crest — schematic slot, real depth from the spec.
  const notchTopHalf = (crestR - crestL) / 2 + 3
  const notchBotHalf = Math.max(4, notchTopHalf * 0.35)
  const notch = `M ${g.x(0) - notchTopHalf} ${breachTopY}
                 L ${g.x(0) - notchBotHalf} ${breachBotY}
                 L ${g.x(0) + notchBotHalf} ${breachBotY}
                 L ${g.x(0) + notchTopHalf} ${breachTopY} Z`

  const rows: { label: string; value: string; unit?: string }[] = [
    { label: 'Crest level', value: num(g.crest, 1), unit: 'm' },
    { label: 'Reservoir level (initial)', value: res?.initial_level_m != null || dam?.fsl_m != null ? num(g.water, 1) : EM_DASH, unit: 'm' },
    { label: 'Riverbed / toe', value: num(g.bed, 1), unit: 'm' },
    { label: 'Dam height', value: num(g.height, 1), unit: 'm' },
    { label: 'Crest length', value: dam?.crest_length_m != null ? num(dam.crest_length_m, 0) : EM_DASH, unit: 'm' },
    { label: 'Storage', value: res?.storage_mcm != null ? num(res.storage_mcm, 1) : (dam?.storage_mcm ?? dam?.capacity_mcm) != null ? num((dam?.storage_mcm ?? dam?.capacity_mcm) ?? 0, 1) : EM_DASH, unit: 'hm³' },
    { label: 'Breach width', value: br?.width_m != null ? num(br.width_m, 1) : EM_DASH, unit: 'm' },
    { label: 'Breach depth', value: br?.depth_m != null ? num(br.depth_m, 1) : EM_DASH, unit: 'm' },
    { label: 'Formation time', value: br?.formation_time_hr != null ? num(br.formation_time_hr, 2) : EM_DASH, unit: 'h' },
    { label: 'Breach method', value: br?.method ? br.method : EM_DASH },
    { label: 'Peak outflow', value: peakCms != null ? num(peakCms, 0) : EM_DASH, unit: 'm³/s' },
    { label: 'Dam type', value: dam?.dam_type ?? spec?.dam_type ?? EM_DASH },
  ]

  const label = (x: number, y: number, text: string, fill = '#667085', anchor: 'start' | 'middle' | 'end' = 'start', weight = 400) => (
    <text x={x} y={y} fontSize={9.5} fill={fill} textAnchor={anchor} fontWeight={weight}>
      {text}
    </text>
  )

  const R = 128

  return (
    <div>
      <div className="border-b border-[var(--line)] bg-[var(--bg-subtle)] p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Dam longitudinal section with breach">
          <defs>
            <linearGradient id="dw-water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7db8f5" />
              <stop offset="100%" stopColor="#3a7bd0" />
            </linearGradient>
            <linearGradient id="dw-dam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e8d9b0" />
              <stop offset="100%" stopColor="#cbb47a" />
            </linearGradient>
          </defs>

          {/* ground */}
          <path d={upstreamGround} fill="#ece5d6" stroke="#c9bda3" strokeWidth="1" />
          <path d={downstreamGround} fill="#ece5d6" stroke="#c9bda3" strokeWidth="1" />

          {/* reservoir */}
          <path d={waterPoly} fill="url(#dw-water)" opacity="0.92" />
          <line x1={g.x(-1)} y1={waterY} x2={waterFaceX} y2={waterY} stroke="#1d4ed8" strokeWidth="1.2" />

          {/* dam body */}
          <path d={damPoly} fill="url(#dw-dam)" stroke="#8a7550" strokeWidth="1.2" />
          {/* crest line + breach notch */}
          <line x1={crestL} y1={breachTopY} x2={crestR} y2={breachTopY} stroke="#8a7550" strokeWidth="1.4" />
          <path d={notch} fill="#ffffff" stroke="#d92d20" strokeWidth="1.4" />

          {/* outflow through the notch */}
          <path
            d={`M ${g.x(0) + notchBotHalf} ${breachBotY} Q ${g.x(0.10)} ${breachBotY + 14} ${g.x(0.30)} ${downToeY - 4}`}
            fill="none"
            stroke="#0b6bcb"
            strokeWidth="2"
            markerEnd="url(#dw-arrow)"
          />
          <defs>
            <marker id="dw-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#0b6bcb" />
            </marker>
          </defs>

          {/* level reference lines */}
          <line x1={g.x(-1)} y1={bedY} x2={g.x(1)} y2={bedY} stroke="#a99c7f" strokeDasharray="3 3" strokeWidth="0.8" />
          <line x1={g.x(-1)} y1={breachTopY} x2={g.x(1)} y2={breachTopY} stroke="#8a7550" strokeDasharray="4 3" strokeWidth="0.8" />

          {/* right-hand level labels */}
          {label(W - R + 8, breachTopY + 3, `Crest ${num(g.crest, 1)} m`, '#8a7550', 'start', 600)}
          {label(W - R + 8, waterY + 3, `Reservoir ${num(g.water, 1)} m`, '#1d4ed8', 'start', 600)}
          {label(W - R + 8, bedY + 3, `Riverbed ${num(g.bed, 1)} m`, '#8a7a5f')}

          {/* annotations */}
          {label(g.x(-0.97), waterY - 7, 'upstream · reservoir', '#1d4ed8', 'start', 600)}
          {label(g.x(0.97), downEndY + 14, 'downstream', '#667085', 'end', 600)}
          {label(g.x(0), breachTopY - 8, 'breach', '#d92d20', 'middle', 600)}
          {label(g.x(0.34), breachBotY + 6, peakCms != null ? `outflow ${num(peakCms, 0)} m³/s` : 'outflow', '#0b6bcb', 'start', 600)}
          {label(g.x(0), H - 10, `${dam?.name ?? 'Dam'} — longitudinal section (not to scale)`, '#98a2b3', 'middle')}

          {/* breach dimension callout */}
          <line x1={g.x(0) - notchTopHalf - 16} y1={breachTopY} x2={g.x(0) - notchTopHalf - 4} y2={breachTopY} stroke="#d92d20" strokeWidth="0.9" />
          <line x1={g.x(0) - notchBotHalf - 16} y1={breachBotY} x2={g.x(0) - notchBotHalf - 4} y2={breachBotY} stroke="#d92d20" strokeWidth="0.9" />
          <line
            x1={g.x(0) - notchTopHalf - 12}
            y1={breachTopY}
            x2={g.x(0) - notchBotHalf - 12}
            y2={breachBotY}
            stroke="#d92d20"
            strokeWidth="0.9"
          />
          {label(g.x(0) - notchTopHalf - 20, (breachTopY + breachBotY) / 2 + 3, `${num(breachDepth, 1)} m`, '#d92d20', 'end', 600)}
        </svg>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2">
        {rows.map((r) => (
          <Metric key={r.label} label={r.label} value={r.value} unit={r.unit} />
        ))}
      </div>
    </div>
  )
}
