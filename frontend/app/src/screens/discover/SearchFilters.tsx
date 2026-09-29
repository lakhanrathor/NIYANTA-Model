import { Check } from '../../components/ui'

export interface DiscoverFilters {
  showDams: boolean
  showBoxes: boolean
}

export const DEFAULT_FILTERS: DiscoverFilters = {
  showDams: true,
  showBoxes: true,
}

/** How many toggles sit away from their default, for the collapsed badge. */
export function countFilters(f: DiscoverFilters): number {
  return (f.showDams ? 0 : 1) + (f.showBoxes ? 0 : 1)
}

interface Props {
  filters: DiscoverFilters
  onChange: (patch: Partial<DiscoverFilters>) => void
  onClear: () => void
}

/** Map layer switches. River narrowing is search's job — a name query answers
 *  faster than any dropdown, and the list ships no geometry to filter on. */
export function SearchFilters({ filters, onChange, onClear }: Props) {
  return (
    <div className="border-b border-[var(--line)] bg-[var(--bg)]">
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)]">
          Map layers
        </span>
        <button onClick={onClear} className="text-[10px] text-[var(--accent)] hover:underline">
          Reset
        </button>
      </div>
      <div className="space-y-1 px-3 pb-2 pt-1.5">
        <Check
          checked={filters.showDams}
          onChange={() => onChange({ showDams: !filters.showDams })}
          label="Show Dams"
        />
        <Check
          checked={filters.showBoxes}
          onChange={() => onChange({ showBoxes: !filters.showBoxes })}
          label="Show Watch Boxes"
        />
      </div>
    </div>
  )
}
