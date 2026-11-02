import type { ButtonHTMLAttributes, ReactNode } from 'react'

/* NIYANTA v2 design kit — the guided-wizard look. Small on purpose: cards,
   buttons, badges, stats and tabs; screens compose these and nothing else. */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-[var(--accent)] text-white shadow-sm hover:brightness-110 disabled:bg-slate-300 disabled:text-slate-500',
  secondary:
    'border border-[var(--line-strong)] bg-white text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-45',
  ghost: 'text-[var(--muted)] hover:bg-slate-100 hover:text-[var(--text)] disabled:opacity-45',
  danger: 'bg-[var(--bad)] text-white shadow-sm hover:brightness-110 disabled:opacity-45',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'h-11 px-5 text-[14px]' : size === 'sm' ? 'h-8 px-3 text-[12px]' : 'h-9 px-4 text-[13px]'
  return (
    <button
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:cursor-not-allowed ${sz} ${VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  pad = true,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <section className={`rounded-xl border border-[var(--line)] bg-white shadow-[var(--shadow)] ${className}`}>
      {(title || actions) && (
        <header className="flex items-start gap-3 px-5 pt-4">
          <div className="min-w-0 flex-1">
            {title && <h3 className="text-[14px] font-semibold text-[var(--text)]">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[12px] leading-snug text-[var(--muted)]">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={pad ? 'px-5 pt-3 pb-5' : ''}>{children}</div>
    </section>
  )
}

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad'
const TONE: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  ok: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  )
}

/** One headline number. `value` is already formatted (EM_DASH when missing). */
export function Stat({ label, value, unit, hint }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white px-4 py-3 shadow-[var(--shadow)]">
      <div className="text-[11px] font-medium text-[var(--muted)]">{label}</div>
      <div className="num mt-0.5 text-[20px] font-semibold leading-tight">
        {value}
        {unit && <span className="ml-1 text-[12px] font-medium text-[var(--faint)]">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-[var(--faint)]">{hint}</div>}
    </div>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="tablist" className="flex gap-1 rounded-lg bg-slate-100 p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${
            t.value === value ? 'bg-white text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line-strong)] px-6 py-10 text-center">
      <div className="text-[13.5px] font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-sm text-[12px] leading-relaxed text-[var(--muted)]">{children}</div>}
    </div>
  )
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-10 w-full rounded-lg border border-[var(--line-strong)] bg-white px-3 text-[13.5px] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] ${props.className ?? ''}`}
    />
  )
}
