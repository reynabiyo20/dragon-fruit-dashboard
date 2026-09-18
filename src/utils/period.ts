/**
 * Shared Year + Month period filtering.
 *
 * Several pages (Dashboard, Sales, Expenses, Payroll, Supply Forecast) let the
 * user narrow data to a specific year and/or month. This centralizes the filter
 * shape, the available-options derivation, and the match test so every page
 * behaves identically.
 */
import { getYear, getMonth, parseISO, isValid } from 'date-fns';

/** 'all' means no constraint; otherwise a 4-digit year / 1-based month (1–12). */
export interface PeriodFilter {
  year: number | 'all';
  month: number | 'all';
}

export const ALL_PERIODS: PeriodFilter = { year: 'all', month: 'all' };

export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** True when no period constraint is active. */
export function periodIsAll(p: PeriodFilter): boolean {
  return p.year === 'all' && p.month === 'all';
}

/** Parse an ISO date to {year, month(1-based)} or null if invalid/empty. */
function parts(isoDate: string): { year: number; month: number } | null {
  if (!isoDate) return null;
  try {
    const d = parseISO(isoDate);
    if (!isValid(d)) return null;
    return { year: getYear(d), month: getMonth(d) + 1 };
  } catch {
    return null;
  }
}

/** Does an ISO date fall within the selected year/month? Empty/invalid dates
 *  only pass when the filter is fully unset. */
export function dateMatchesPeriod(isoDate: string, p: PeriodFilter): boolean {
  if (periodIsAll(p)) return true;
  const parsed = parts(isoDate);
  if (!parsed) return false;
  if (p.year !== 'all' && parsed.year !== p.year) return false;
  if (p.month !== 'all' && parsed.month !== p.month) return false;
  return true;
}

/**
 * Collect the distinct years present across one or more ISO-date lists, newest
 * first — used to populate the Year dropdown so it only offers years with data.
 * Always includes the current year so a fresh dataset still has a usable option.
 */
export function availableYears(...dateLists: string[][]): number[] {
  const years = new Set<number>([getYear(new Date())]);
  dateLists.forEach((list) => {
    list.forEach((iso) => {
      const parsed = parts(iso);
      if (parsed) years.add(parsed.year);
    });
  });
  return Array.from(years).sort((a, b) => b - a);
}
