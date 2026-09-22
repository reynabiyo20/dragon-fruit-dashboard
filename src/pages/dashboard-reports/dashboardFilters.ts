/**
 * Dashboard slicer model.
 *
 * The executive dashboard supports interactive slicers that narrow every section
 * at once. Region is intentionally omitted — the app tracks no region/zone data.
 * Season is derived from a sale's month (the business has a tropical off-season
 * Nov–Apr and an early/main season otherwise).
 */
import { getMonth, parseISO } from 'date-fns';
import type { Sale } from '../../types';
import { OFF_SEASON_MONTHS } from '../../constants';
import { type PeriodFilter, ALL_PERIODS, periodIsAll, dateMatchesPeriod } from '../../utils/period';

export type SeasonFilter = 'all' | 'in-season' | 'off-season';
export type FulfillmentFilter = 'all' | 'delivered' | 'pending' | 'paid' | 'unpaid';

export interface DashboardFilters {
  /** Product/crop category, e.g. 'Cuttings' | 'Fruit' | … or 'all'. */
  category: string;
  /** Sale channel, from SALE_TYPES, or 'all'. */
  channel: string;
  /** Derived season bucket. */
  season: SeasonFilter;
  /** Fulfillment / payment status. */
  fulfillment: FulfillmentFilter;
  /** Year + month period constraint (keys off sale.date). */
  period: PeriodFilter;
}

export const DEFAULT_FILTERS: DashboardFilters = {
  category: 'all',
  channel: 'all',
  season: 'all',
  fulfillment: 'all',
  period: ALL_PERIODS,
};

/** True when no slicer is narrowing the view. */
export function filtersAreDefault(f: DashboardFilters): boolean {
  return (
    f.category === 'all' &&
    f.channel === 'all' &&
    f.season === 'all' &&
    f.fulfillment === 'all' &&
    periodIsAll(f.period)
  );
}

/** Does a sale match the year/month period slicer? */
export function saleMatchesPeriod(sale: Sale, period: PeriodFilter): boolean {
  return dateMatchesPeriod(sale.date, period);
}

/** Which season an ISO date falls in (off-season = Nov–Apr per OFF_SEASON_MONTHS). */
export function seasonOf(isoDate: string): 'in-season' | 'off-season' {
  try {
    const month1 = getMonth(parseISO(isoDate)) + 1;
    return OFF_SEASON_MONTHS.includes(month1) ? 'off-season' : 'in-season';
  } catch {
    return 'in-season';
  }
}

/** Does a sale match the season slicer? */
export function saleMatchesSeason(sale: Sale, season: SeasonFilter): boolean {
  if (season === 'all') return true;
  return seasonOf(sale.date) === season;
}

/** Does a sale match the channel slicer? */
export function saleMatchesChannel(sale: Sale, channel: string): boolean {
  if (channel === 'all') return true;
  return (sale.saleType || 'Other') === channel;
}

/** Does a sale match the fulfillment slicer? */
export function saleMatchesFulfillment(sale: Sale, fulfillment: FulfillmentFilter): boolean {
  switch (fulfillment) {
    case 'delivered': return sale.delivered === true;
    case 'pending':   return sale.delivered !== true;
    case 'paid':      return sale.paid === true;
    case 'unpaid':    return sale.paid !== true;
    default:          return true;
  }
}
