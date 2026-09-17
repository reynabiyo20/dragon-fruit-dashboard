/**
 * Wholesale forecasting engine.
 *
 * Projects future fruit supply (pieces + kilograms) from cuttings that have been
 * *deployed* — an internal batch marked Planted, or a customer/partner batch
 * whose sale was marked Delivered. Each deployment yields fruit a fixed number of
 * days later; harvests landing in the tropical off-season are rolled forward to
 * the start of the next season.
 */
import { addDays, getMonth, getYear, parseISO, isValid, format, setMonth, setDate } from 'date-fns';
import {
  FRUIT_WEIGHT_KG,
  YIELD_FRUITS_GRAFTED,
  YIELD_FRUITS_UNROOTED,
  HARVEST_DAYS_GRAFTED,
  HARVEST_DAYS_UNROOTED,
  OFF_SEASON_MONTHS,
  EARLY_SEASON_LABEL,
  CUTTING_TYPE_UNROOTED,
  normalizeCuttingType,
} from '../constants';

/** Which pool a deployment's supply belongs to. */
export type ForecastPool = 'internal' | 'partner';

/** A single deployed batch feeding the forecast. */
export interface Deployment {
  pool: ForecastPool;
  cuttingType: string;        // grafted vs unrooted — drives yield & timeline
  quantity: number;           // number of cuttings deployed
  deploymentDate: string;     // ISO date deployed (planted / delivered)
  variety: string;
  label?: string;             // human source label (e.g. customer name / batch note)
}

/** Fruits yielded by a single cutting of the given type, first harvest. */
export function fruitsPerCutting(cuttingType: string): number {
  return normalizeCuttingType(cuttingType) === CUTTING_TYPE_UNROOTED ? YIELD_FRUITS_UNROOTED : YIELD_FRUITS_GRAFTED;
}

/** Days from deployment to first harvest for the given cutting type. */
export function harvestDays(cuttingType: string): number {
  return normalizeCuttingType(cuttingType) === CUTTING_TYPE_UNROOTED ? HARVEST_DAYS_UNROOTED : HARVEST_DAYS_GRAFTED;
}

/** Is a 1-based month in the tropical off-season (Nov–Apr)? */
function isOffSeason(month1Based: number): boolean {
  return OFF_SEASON_MONTHS.includes(month1Based);
}

/**
 * The projected harvest window for a deployment, as a sortable key + display
 * label. A raw harvest date in the off-season is rolled forward to May of the
 * appropriate year and labelled "May (Early Season)".
 */
export interface HarvestWindow {
  /** Sortable YYYY-MM key for grouping/ordering windows. */
  key: string;
  /** Human label, e.g. "May (Early Season)" or "July 2026". */
  label: string;
  /** The effective (possibly rolled-forward) harvest date, ISO. */
  date: string;
}

export function projectHarvestWindow(deploymentDate: string, cuttingType: string): HarvestWindow | null {
  let deployed: Date;
  try {
    deployed = parseISO(deploymentDate);
  } catch {
    return null;
  }
  if (!isValid(deployed)) return null;

  const raw = addDays(deployed, harvestDays(cuttingType));
  const month1 = getMonth(raw) + 1; // getMonth is 0-based

  if (isOffSeason(month1)) {
    // Roll forward to May (Early Season). If the raw harvest is in Nov/Dec, the
    // next May is the following year; for Jan–Apr it's May of the same year.
    const seasonYear = month1 >= 11 ? getYear(raw) + 1 : getYear(raw);
    const may = setDate(setMonth(new Date(seasonYear, 0, 1), 4), 1); // May 1 of seasonYear
    return {
      key: `${seasonYear}-05`,
      label: `${EARLY_SEASON_LABEL} ${seasonYear}`,
      date: may.toISOString(),
    };
  }

  return {
    key: format(raw, 'yyyy-MM'),
    label: format(raw, 'MMMM yyyy'),
    date: raw.toISOString(),
  };
}

/** Per-pool totals within a harvest window. */
export interface PoolTotals {
  pieces: number;
  kg: number;
  cuttings: number;
}

/** Aggregated supply for one harvest window. */
export interface ForecastWindow {
  key: string;
  label: string;
  date: string;
  internal: PoolTotals;
  partner: PoolTotals;
  /** Combined weight (internal.kg + partner.kg), the wholesale-contractable total. */
  totalKg: number;
  totalPieces: number;
}

function emptyTotals(): PoolTotals {
  return { pieces: 0, kg: 0, cuttings: 0 };
}

/**
 * Aggregate deployments into projected harvest windows, split by pool. Windows
 * are returned sorted chronologically by their sort key.
 */
export function buildForecast(deployments: Deployment[]): ForecastWindow[] {
  const windows = new Map<string, ForecastWindow>();

  deployments.forEach((d) => {
    const qty = Number(d.quantity) || 0;
    if (qty <= 0) return;
    const window = projectHarvestWindow(d.deploymentDate, d.cuttingType);
    if (!window) return;

    const pieces = qty * fruitsPerCutting(d.cuttingType);
    const kg = pieces * FRUIT_WEIGHT_KG;

    let entry = windows.get(window.key);
    if (!entry) {
      entry = {
        key: window.key,
        label: window.label,
        date: window.date,
        internal: emptyTotals(),
        partner: emptyTotals(),
        totalKg: 0,
        totalPieces: 0,
      };
      windows.set(window.key, entry);
    }

    const bucket = d.pool === 'internal' ? entry.internal : entry.partner;
    bucket.pieces += pieces;
    bucket.kg += kg;
    bucket.cuttings += qty;
    entry.totalPieces += pieces;
    entry.totalKg += kg;
  });

  return [...windows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Grand totals across every window (for KPI summaries). */
export function forecastTotals(windows: ForecastWindow[]): {
  internalKg: number;
  partnerKg: number;
  totalKg: number;
  totalPieces: number;
} {
  return windows.reduce(
    (acc, w) => ({
      internalKg: acc.internalKg + w.internal.kg,
      partnerKg: acc.partnerKg + w.partner.kg,
      totalKg: acc.totalKg + w.totalKg,
      totalPieces: acc.totalPieces + w.totalPieces,
    }),
    { internalKg: 0, partnerKg: 0, totalKg: 0, totalPieces: 0 },
  );
}
