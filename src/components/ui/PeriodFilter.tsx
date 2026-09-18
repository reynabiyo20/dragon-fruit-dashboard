/**
 * PeriodFilter — a shared, compact Year + Month picker used across pages
 * (Dashboard, Sales, Expenses, Payroll, Supply Forecast) so period filtering
 * looks and behaves identically everywhere.
 */
import { CalendarRange, X } from 'lucide-react';
import {
  type PeriodFilter as Period, MONTH_LABELS, periodIsAll, ALL_PERIODS,
} from '../../utils/period';

interface PeriodFilterProps {
  value: Period;
  onChange: (next: Period) => void;
  /** Years to offer (newest-first). Derive with availableYears(...). */
  years: number[];
  /** Optional label shown before the controls. Defaults to "Period". */
  label?: string;
  className?: string;
}

const selectClass =
  'text-sm border border-primary-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

export function PeriodFilter({ value, onChange, years, label = 'Period', className = '' }: PeriodFilterProps) {
  const set = (patch: Partial<Period>) => onChange({ ...value, ...patch });

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-800">
        <CalendarRange className="w-4 h-4" />
        {label}
      </span>

      <select
        className={selectClass}
        value={value.year}
        onChange={(e) => set({ year: e.target.value === 'all' ? 'all' : Number(e.target.value) })}
        aria-label="Filter by year"
      >
        <option value="all">All years</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>

      <select
        className={selectClass}
        value={value.month}
        onChange={(e) => set({ month: e.target.value === 'all' ? 'all' : Number(e.target.value) })}
        aria-label="Filter by month"
      >
        <option value="all">All months</option>
        {MONTH_LABELS.map((m, i) => (
          <option key={m} value={i + 1}>{m}</option>
        ))}
      </select>

      {!periodIsAll(value) && (
        <button
          type="button"
          onClick={() => onChange(ALL_PERIODS)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:text-primary-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded px-1.5 py-1"
        >
          <X className="w-3.5 h-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
