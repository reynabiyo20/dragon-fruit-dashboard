/**
 * Pure aggregation helpers for the dashboard's "Financial Performance by
 * Location" charts. Kept out of the hook so they can be unit-tested directly
 * and so the reactive behavior (recomputing when a customer/vendor location
 * changes) is provable without rendering.
 *
 * Sales are attributed to the linked CUSTOMER's location, expenses to the
 * linked VENDOR's location — always by the entity's CURRENT location, joined
 * live via id. PHP and USD are never summed, so callers split local (PHP,
 * province/region) from international (USD, per country).
 */
import type { Sale, Expense, Customer, Vendor } from '../../types';
import { regionOf, isInternationalLocation, countryOf } from '../../constants/geography';

/** Fallback label for customers/vendors that have no location recorded yet. */
export const UNSPECIFIED_LOCATION = 'Unspecified';

export interface LocationPerformance {
  region: string;
  province: string;
  municipality: string;
  /** Display label ("Province · Municipality", province, or region name). */
  label: string;
  sales: number;
  expenses: number;
  net: number; // sales − expenses
}

export interface CountryPerformance {
  country: string;
  sales: number;    // USD
  expenses: number; // USD
  net: number;      // USD
}

const bySizeDesc = <T extends { sales: number; expenses: number }>(a: T, b: T) =>
  b.sales + b.expenses - (a.sales + a.expenses);

/**
 * Local (Philippine) province/municipality rollup — PHP only. International
 * records are skipped (handled by {@link countryPerformance}).
 */
export function localPerformanceByLocation(
  sales: Sale[],
  expenses: Expense[],
  customerById: Map<string, Customer>,
  vendorById: Map<string, Vendor>,
): LocationPerformance[] {
  const rollup = new Map<string, LocationPerformance>();
  const bucket = (province: string, municipality: string): LocationPerformance => {
    const prov = province.trim() || UNSPECIFIED_LOCATION;
    const muni = municipality.trim() || UNSPECIFIED_LOCATION;
    const region = regionOf(province.trim()) || UNSPECIFIED_LOCATION;
    const key = `${prov}|${muni}`;
    let row = rollup.get(key);
    if (!row) {
      row = { region, province: prov, municipality: muni, label: `${prov} · ${muni}`, sales: 0, expenses: 0, net: 0 };
      rollup.set(key, row);
    }
    return row;
  };

  sales.forEach((sale) => {
    const loc = customerById.get(sale.customerId)?.location;
    if (isInternationalLocation(loc)) return;
    bucket(loc?.province ?? '', loc?.municipality ?? '').sales += sale.subtotal;
  });

  expenses.forEach((exp) => {
    const loc = vendorById.get(exp.vendorId)?.location;
    if (isInternationalLocation(loc)) return;
    bucket(loc?.province ?? '', loc?.municipality ?? '').expenses += exp.amount;
  });

  return Array.from(rollup.values())
    .map((r) => ({ ...r, net: r.sales - r.expenses }))
    .sort(bySizeDesc);
}

/**
 * International per-country rollup — USD only. Includes only records whose
 * linked customer/vendor has a non-Philippine country on file.
 */
export function countryPerformance(
  sales: Sale[],
  expenses: Expense[],
  customerById: Map<string, Customer>,
  vendorById: Map<string, Vendor>,
): CountryPerformance[] {
  const rollup = new Map<string, CountryPerformance>();
  const bucket = (country: string): CountryPerformance => {
    let row = rollup.get(country);
    if (!row) {
      row = { country, sales: 0, expenses: 0, net: 0 };
      rollup.set(country, row);
    }
    return row;
  };

  sales.forEach((sale) => {
    const loc = customerById.get(sale.customerId)?.location;
    if (!isInternationalLocation(loc)) return;
    bucket(countryOf(loc)).sales += sale.subtotal;
  });

  expenses.forEach((exp) => {
    const loc = vendorById.get(exp.vendorId)?.location;
    if (!isInternationalLocation(loc)) return;
    bucket(countryOf(loc)).expenses += exp.amount;
  });

  return Array.from(rollup.values())
    .map((r) => ({ ...r, net: r.sales - r.expenses }))
    .sort(bySizeDesc);
}

/** Roll province/municipality rows up to province-level subtotals. */
export function rollUpToProvince(byLocation: LocationPerformance[]): LocationPerformance[] {
  const rollup = new Map<string, LocationPerformance>();
  byLocation.forEach((r) => {
    let row = rollup.get(r.province);
    if (!row) {
      row = { region: r.region, province: r.province, municipality: '', label: r.province, sales: 0, expenses: 0, net: 0 };
      rollup.set(r.province, row);
    }
    row.sales += r.sales;
    row.expenses += r.expenses;
  });
  return Array.from(rollup.values())
    .map((r) => ({ ...r, net: r.sales - r.expenses }))
    .sort(bySizeDesc);
}

/** Roll province/municipality rows up to region-level subtotals. */
export function rollUpToRegion(byLocation: LocationPerformance[]): LocationPerformance[] {
  const rollup = new Map<string, LocationPerformance>();
  byLocation.forEach((r) => {
    let row = rollup.get(r.region);
    if (!row) {
      row = { region: r.region, province: '', municipality: '', label: r.region, sales: 0, expenses: 0, net: 0 };
      rollup.set(r.region, row);
    }
    row.sales += r.sales;
    row.expenses += r.expenses;
  });
  return Array.from(rollup.values())
    .map((r) => ({ ...r, net: r.sales - r.expenses }))
    .sort(bySizeDesc);
}
