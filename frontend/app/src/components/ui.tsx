import type { ReactNode } from 'react'
import { EM_DASH } from '../lib/format'

/* ------------------------------------------------------------------ icons */

const PATHS: Record<string, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  chevronRight: <path d="M9.5 5.5l6.5 6.5-6.5 6.5" />,
  chevronLeft: <path d="M14.5 5.5L8 12l6.5 6.5" />,
  chevronDown: <path d="M5.5 9.5L12 16l6.5-6.5" />,
  chevronUp: <path d="M5.5 14.5L12 8l6.5 6.5" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="M3.5 13l8.5 4.5 8.5-4.5" />
    </>
  ),
  check: <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  play: <path d="M7.5 4.5l11.5 7.5-11.5 7.5z" />,
  pause: <path d="M8.5 5v14M15.5 5v14" />,
  skipBack: (
    <>
      <path d="M18.5 5v14L9 12z" />
      <path d="M6 5v14" />
    </>
  ),
  skipFwd: (
    <>
      <path d="M5.5 5v14L15 12z" />
      <path d="M18 5v14" />
    </>
  ),
  expand: <path d="M4 9.5V4h5.5M20 14.5V20h-5.5M4 4l6 6M20 20l-6-6" />,
  river: <path d="M3 7.5c3 0 3 4.5 6 4.5s3-4.5 6-4.5 3 4.5 6 4.5" />,
  dam: (
    <>
      <path d="M4 6.5h16M4 17.5h16" />
      <path d="M7 6.5v11M12 6.5v11M17 6.5v11" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19" />
    </>
  ),
  swap: <path d="M4 8.5h13l-3.5-3.5M20 15.5H7l3.5 3.5" />,
  ruler: (
    <>
      <path d="M3 15.5l12.5-12.5 5.5 5.5L8.5 21z" />
      <path d="M7 11.5l2 2M10 8.5l2 2M13 5.5l2 2" />
    </>
  ),
  camera: (
    <>
      <path d="M3.5 7.5h4l1.5-2h6l1.5 2h4v11h-17z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21.5s7-6.6 7-11.5a7 7 0 1 0-14 0c0 4.9 7 11.5 7 11.5z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" />
    </>
  ),
  cursor: <path d="M5.5 3.5l13 7.5-5.8 1.3-2.6 5.9z" />,
  download: <path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19.5h14" />,
  image: (
    <>
      <path d="M3.5 4.5h17v15h-17z" />
      <circle cx="8.5" cy="9.5" r="1.8" />
      <path d="M3.5 16.5l5-4.5 4 3.5 3.5-3 4.5 4" />
    </>
  ),
  arrowLeft: <path d="M19.5 12h-15m0 0l6-6m-6 6l6 6" />,
  grid: (
    <>
      <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 6.5V12l4 2.5" />
    </>
  ),
  chart: <path d="M4 19.5V4.5m0 15h16M7 15l4-5 3.5 3L20 7" />,
  file: (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
    </>
  ),
  fullscreen: <path d="M4 9V4h5M20 15v5h-5M4 4l6.5 6.5M20 20l-6.5-6.5" />,
  measure: (
    <>
      <path d="M3 16.5L16.5 3 21 7.5 7.5 21z" />
      <path d="M7 12.5l2 2M10 9.5l2 2M13 6.5l2 2" />
    </>
  ),
  spinner: <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />,
}

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  className = '',
  size = 14,
  fill = false,
}: {
  name: string
  className?: string
  size?: number
  fill?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {PATHS[name] ?? null}
    </svg>
  )
}

/* ------------------------------------------------------------------ panels */

export function Panel({
  title,
  actions,
  children,
  className = '',
  bodyClass = '',
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={`panel flex min-h-0 flex-col overflow-hidden ${className}`}>
      {title && (
        <header className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--line)] px-3">
          <h2 className="text-[11px] font-semibold tracking-[0.04em] text-[var(--text)]">{title}</h2>
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className={`min-h-0 flex-1 overflow-auto ${bodyClass}`}>{children}</div>
    </section>
  )
}

/** Small uppercase group heading used inside a panel body. */
export function Head({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)] px-3 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {children}
      </span>
      {right && <span className="ml-auto text-[10px] text-[var(--muted)]">{right}</span>}
    </div>
  )
}

/** label · value row. Value is monospace and carries its unit. */
export function Metric({
  label,
  value,
  unit,
  tone,
  title,
}: {
  label: ReactNode
  value: ReactNode
  unit?: string
  tone?: 'ok' | 'warn' | 'bad' | 'muted'
  title?: string
}) {
  const color =
    tone === 'ok'
      ? 'text-[var(--ok)]'
      : tone === 'warn'
        ? 'text-[var(--warn)]'
        : tone === 'bad'
          ? 'text-[var(--bad)]'
          : tone === 'muted'
            ? 'text-[var(--muted)]'
            : ''
  return (
    <div
      title={title}
      className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] px-3 py-[5px] last:border-b-0"
    >
      <span className="shrink-0 text-[11px] text-[var(--muted)]">{label}</span>
      <span className={`num truncate text-right text-[12px] font-medium ${color}`}>
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-normal text-[var(--faint)]">{unit}</span>}
      </span>
    </div>
  )
}

/** Honest empty / offline copy — never a placeholder number. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[64px] items-center justify-center px-4 py-5 text-center text-[11px] leading-relaxed text-[var(--faint)]">
      {children}
    </div>
  )
}

/** Provenance line: which endpoint / dataset a value came from. */
export function Prov({ children, offline }: { children: ReactNode; offline?: boolean }) {
  return (
    <p
      className={`border-t border-dashed border-[var(--line)] px-3 py-1.5 text-[10px] leading-snug ${
        offline ? 'text-[var(--warn)]' : 'text-[var(--faint)]'
      }`}
    >
      {children}
    </p>
  )
}

export function Pill({
  tone = 'muted',
  children,
}: {
  tone?: 'ok' | 'warn' | 'bad' | 'accent' | 'muted'
  children: ReactNode
}) {
  const map = {
    ok: 'border-[#a6e0cb] bg-[#e7f6f0] text-[var(--ok)]',
    warn: 'border-[#f0d2a8] bg-[#fdf3e6] text-[var(--warn)]',
    bad: 'border-[#f3c1bc] bg-[#fdeceb] text-[var(--bad)]',
    accent: 'border-[#b9d7f4] bg-[var(--accent-soft)] text-[var(--accent)]',
    muted: 'border-[var(--line)] bg-[var(--bg)] text-[var(--muted)]',
  } as const
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[10px] font-medium ${map[tone]}`}
    >
      {children}
    </span>
  )
}

/* --------------------------------------------------------------- controls */

export function Check({
  checked,
  onChange,
  label,
  hint,
  disabled,
  swatch,
}: {
  checked: boolean
  onChange?: () => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
  swatch?: string
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 px-3 py-[5px] text-[12px] hover:bg-[var(--bg)] ${
        disabled ? 'cursor-default opacity-70' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
      />
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
          checked ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--line-strong)] bg-white'
        }`}
      >
        {checked && <Icon name="check" size={9} />}
      </span>
      {swatch && (
        <span
          className="h-3 w-5 shrink-0 rounded-[2px] border border-[var(--line)]"
          style={{ background: swatch }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="num shrink-0 text-[10px] text-[var(--faint)]">{hint}</span>}
    </label>
  )
}

/** Segmented control (2D/3D, playback speed, comparison mode …). */
export function Seg({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: string; label: ReactNode; title?: string }[]
  value: string
  onChange: (v: string) => void
  size?: 'sm' | 'md'
}) {
  const h = size === 'sm' ? 'h-5' : 'h-6'
  return (
    <div className={`inline-flex ${h} items-center rounded border border-[var(--line-strong)] bg-white p-[2px]`}>
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`h-full rounded-[3px] px-2 text-[11px] leading-none ${
            value === o.value
              ? 'bg-[var(--accent)] font-medium text-white'
              : 'text-[var(--muted)] hover:bg-[var(--bg)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({
  label,
  value,
  onChange,
  suffix,
  placeholder,
  type = 'number',
  min,
  max,
  step,
}: {
  label: ReactNode
  value: string
  onChange: (v: string) => void
  suffix?: string
  placeholder?: string
  type?: string
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="flex items-center gap-2 px-3 py-[5px] text-[11px]">
      <span className="flex-1 text-[var(--muted)]">{label}</span>
      <span className="flex h-6 w-[104px] items-center rounded border border-[var(--line-strong)] bg-white px-1.5 focus-within:border-[var(--accent)]">
        <input
          type={type}
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="num w-full bg-transparent text-right text-[12px] outline-none placeholder:text-[var(--faint)]"
        />
        {suffix && <span className="ml-1 shrink-0 text-[10px] text-[var(--faint)]">{suffix}</span>}
      </span>
    </label>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  display: string
}) {
  return (
    <div className="px-3 py-[6px]">
      <div className="mb-1 flex items-baseline justify-between text-[11px]">
        <span className="text-[var(--muted)]">{label}</span>
        <span className="num text-[11px] font-medium">{display}</span>
      </div>
      <input
        type="range"
        aria-label={typeof label === 'string' ? label : undefined}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded bg-[var(--line)] accent-[var(--accent)]"
      />
    </div>
  )
}

/** Large counter cell used by Pan India Overview / Key Statistics. */
export function StatCell({
  label,
  value,
  unit,
  tone,
  offline,
}: {
  label: string
  value: string
  unit?: string
  tone?: 'ok' | 'warn' | 'bad'
  offline?: boolean
}) {
  const color =
    tone === 'bad'
      ? 'text-[var(--bad)]'
      : tone === 'warn'
        ? 'text-[var(--warn)]'
        : tone === 'ok'
          ? 'text-[var(--ok)]'
          : 'text-[var(--text)]'
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-r border-[var(--line)] px-3 py-2 last:border-r-0">
      <span className="truncate text-[10px] uppercase tracking-[0.05em] text-[var(--muted)]">
        {label}
      </span>
      <span className={`num text-[19px] font-semibold leading-none ${offline ? 'text-[var(--faint)]' : color}`}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-[var(--faint)]">{unit}</span>}
      </span>
    </div>
  )
}

/** `n results`, `Coverage %` … compact mono count. */
export function Count({ children }: { children: ReactNode }) {
  return <span className="num text-[11px] text-[var(--muted)]">{children}</span>
}

export function IconButton({
  name,
  title,
  onClick,
  active,
  className = '',
}: {
  name: string
  title: string
  onClick?: () => void
  active?: boolean
  className?: string
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded border border-[var(--line-strong)] bg-white text-[var(--muted)] shadow-[var(--shadow)] hover:text-[var(--accent)] ${
        active ? 'text-[var(--accent)]' : ''
      } ${className}`}
    >
      <Icon name={name} size={14} />
    </button>
  )
}

/** Link-style action used by panel headers (`Manage`, `View All`, …). */
export function LinkBtn({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-0.5 text-[10px] font-medium text-[var(--accent)] hover:underline"
    >
      {children}
      <Icon name="chevronRight" size={10} />
    </button>
  )
}

/** A table shell matching the dense spec tables. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="border-b border-[var(--line)] bg-[var(--bg)]">
          {head.map((h, i) => (
            <th
              key={i}
              className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--muted)]"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-4 text-center text-[11px] text-[var(--faint)]">
        {children}
      </td>
    </tr>
  )
}

export { EM_DASH }
