'use client';

export type SortDirection = 'asc' | 'desc';

export function SortableHeader({ active, className, direction, label, onClick }: { active: boolean; className?: string; direction: SortDirection; label: string; onClick: () => void }) {
  return <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={className} scope="col"><button className="table-sort-button" onClick={onClick} type="button">{label}<span aria-hidden="true">{active ? direction === 'asc' ? '↑' : '↓' : '↕'}</span></button></th>;
}

export function MobileSortControl<T extends string>({ value, direction, options, label, ascendingLabel, descendingLabel, onSortChange, onDirectionChange }: { value: T; direction: SortDirection; options: Array<{ value: T; label: string }>; label: string; ascendingLabel: string; descendingLabel: string; onSortChange: (value: T) => void; onDirectionChange: () => void }) {
  return <div className="mobile-sort-control"><label>{label}<select value={value} onChange={(event) => onSortChange(event.target.value as T)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button aria-label={direction === 'asc' ? ascendingLabel : descendingLabel} className="secondary-button" onClick={onDirectionChange} type="button">{direction === 'asc' ? '↑' : '↓'}</button></div>;
}
