/** Breach cross-section: trapezoid notch drawn from the configured dimensions.
 *  No invented geometry — every number on the diagram is a live draft value. */
export function BreachDiagram({
  widthM,
  depthM,
  sideSlope,
}: {
  widthM: number
  depthM: number
  sideSlope: number
}) {
  const W = 300
  const H = 172
  const groundY = 108
  const cx = 150

  if (!(widthM > 0) || !(depthM > 0)) {
    return (
      <div className="mx-3 mb-2 rounded border border-dashed border-[var(--line-strong)] px-3 py-5 text-center">
        <p className="text-[11px] font-medium text-[var(--muted)]">Breach cross-section</p>
        <p className="mt-1 text-[10px] text-[var(--faint)]">
          Set a breach width and depth to draw the notch.
        </p>
      </div>
    )
  }

  // Uniform scale so the slope annotation stays honest.
  const k = Math.min(190 / widthM, 66 / depthM)
  const topHalf = (widthM * k) / 2
  const depthPx = depthM * k
  // Slopes that meet before full depth are drawn clamped — the validator flags it.
  const bottomHalf = Math.max(3, topHalf - depthPx * sideSlope)
  const bottomY = groundY + depthPx

  const damL = `${cx - 138},${groundY} ${cx - topHalf},${groundY} ${cx - bottomHalf},${bottomY} ${cx - 138},${bottomY}`
  const damR = `${cx + 138},${groundY} ${cx + topHalf},${groundY} ${cx + bottomHalf},${bottomY} ${cx + 138},${bottomY}`

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded border border-[var(--line)] bg-white">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Breach cross-section">
        <defs>
          <pattern id="breach-hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="7" height="7" fill="#eef2f7" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="#b6c2d2" strokeWidth="2" />
          </pattern>
          <marker id="breach-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#0b6bcb" strokeWidth="1.4" />
          </marker>
          <marker id="breach-arrow-r" markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto">
            <path d="M7,0 L0,3.5 L7,7" fill="none" stroke="#0b6bcb" strokeWidth="1.4" />
          </marker>
        </defs>

        {/* sky + reservoir hint */}
        <rect x="0" y="0" width={W} height={groundY} fill="#f7fbff" />

        {/* dam body */}
        <polygon points={damL} fill="url(#breach-hatch)" stroke="#8fa0b5" strokeWidth="1.2" />
        <polygon points={damR} fill="url(#breach-hatch)" stroke="#8fa0b5" strokeWidth="1.2" />
        {/* crest line */}
        <line x1="12" y1={groundY} x2={W - 12} y2={groundY} stroke="#33415c" strokeWidth="2" />
        {/* water surface at crest */}
        <line
          x1="12"
          y1={groundY - 7}
          x2={W - 12}
          y2={groundY - 7}
          stroke="#2e90fa"
          strokeWidth="1.6"
          strokeDasharray="5 3"
        />
        <text x={W - 14} y={groundY - 10} textAnchor="end" fontSize="8.5" fill="#2e90fa">
          reservoir · crest
        </text>

        {/* flowing notch */}
        <polygon
          points={`${cx - topHalf},${groundY} ${cx + topHalf},${groundY} ${cx + bottomHalf},${bottomY} ${cx - bottomHalf},${bottomY}`}
          fill="#bfe0ff"
          stroke="#2e90fa"
          strokeWidth="1.2"
        />

        {/* width dimension */}
        <line
          x1={cx - topHalf}
          y1={groundY - 16}
          x2={cx + topHalf}
          y2={groundY - 16}
          stroke="#0b6bcb"
          strokeWidth="1"
          markerStart="url(#breach-arrow-r)"
          markerEnd="url(#breach-arrow)"
        />
        <text x={cx} y={groundY - 20} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#0b6bcb" className="num">
          {widthM.toFixed(1)} m
        </text>

        {/* depth dimension */}
        <line
          x1={cx + topHalf + 12}
          y1={groundY}
          x2={cx + topHalf + 12}
          y2={bottomY}
          stroke="#0b6bcb"
          strokeWidth="1"
          markerStart="url(#breach-arrow-r)"
          markerEnd="url(#breach-arrow)"
        />
        <text
          x={cx + topHalf + 17}
          y={(groundY + bottomY) / 2 + 3}
          fontSize="9.5"
          fontWeight="600"
          fill="#0b6bcb"
          className="num"
        >
          {depthM.toFixed(1)} m
        </text>

        {/* slope callout */}
        <text x={cx - bottomHalf - 6} y={bottomY - 4} textAnchor="end" fontSize="8.5" fill="#64748b" className="num">
          1:{sideSlope}
        </text>
        <text x="14" y={H - 8} fontSize="8.5" fill="#94a3b8">
          trapezoidal breach · side slope H:V
        </text>
      </svg>
    </div>
  )
}
