/**
 * DashboardSlicers — the interactive filter bar for the executive dashboard.
 *
 * Slices every section at once by Product Category, Sale Channel, Season, and
 * Fulfillment status. (Region is intentionally absent — the app tracks none.)
 */
import { SlidersHorizontal, X } from 'lucide-react';
import { PRODUCT_CATEGORY_TYPES, SALE_TYPES } from '../../constants';
import {
  type DashboardFilters, DEFAULT_FILTERS, filtersAreDefault,
} from './dashboardFilters';
import { MONTH_LABELS } from '../../utils/period';

interface DashboardSlicersProps {
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  /** Distinct years present in the data (newest-first). */
  years: number[];
}

const selectClass =
  'text-sm border border-primary-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

export function DashboardSlicers({ filters, onChange, years }: DashboardSlicersProps) {
  const set = (patch: Partial<DashboardFilters>) => onChange({ ...filters, ...patch });
  const setPeriod = (patch: Partial<DashboardFilters['period']>) =>
    onChange({ ...filters, period: { ...filters.period, ...patch } });
  const isDefault = filtersAreDefault(filters);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary-100 bg-primary-50/40 px-4 py-3">
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-800">
        <SlidersHorizontal className="w-4 h-4" />
        Filters
      </span>

      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        Year
        <select
          className={selectClass}
          value={filters.period.year}
          onChange={(e) => setPeriod({ year: e.target.value === 'all' ? 'all' : Number(e.target.value) })}
          aria-label="Filter by year"
        >
          <option value="all">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        Month
        <select
          className={selectClass}
          value={filters.period.month}
          onChange={(e) => setPeriod({ month: e.target.value === 'all' ? 'all' : Number(e.target.value) })}
          aria-label="Filter by month"
        >
          <option value="all">All months</option>
          {MONTH_LABELS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        Product
        <select
          className={selectClass}
          value={filters.category}
          onChange={(e) => set({ category: e.target.value })}
          aria-label="Filter by product category"
        >
          <option value="all">All products</option>
          {PRODUCT_CATEGORY_TYPES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        Channel
        <select
          className={selectClass}
          value={filters.channel}
          onChange={(e) => set({ channel: e.target.value })}
          aria-label="Filter by sale channel"
        >
          <option value="all">All channels</option>
          {SALE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        Season
        <select
          className={selectClass}
          value={filters.season}
          onChange={(e) => set({ season: e.target.value as DashboardFilters['season'] })}
          aria-label="Filter by season"
        >
          <option value="all">All seasons</option>
          <option value="in-season">In season (May–Oct)</option>
          <option value="off-season">Off season (Nov–Apr)</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        Fulfillment
        <select
          className={selectClass}
          value={filters.fulfillment}
          onChange={(e) => set({ fulfillment: e.target.value as DashboardFilters['fulfillment'] })}
          aria-label="Filter by fulfillment status"
        >
          <option value="all">All statuses</option>
          <option value="delivered">Delivered</option>
          <option value="pending">Pending delivery</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </label>

      {!isDefault && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:text-primary-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded px-1.5 py-1"
        >
          <X className="w-3.5 h-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
