import { addDays, getWeekOfMonth, isValid, parseISO, format } from 'date-fns';
import { FRUIT_DAYS_FLOWER_TO_HARVEST } from '../constants';

/** Today's date as an ISO date string (YYYY-MM-DD), local time. */
export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** A fruit's estimated harvest window, expressed as a Month + Week-of-month. */
export interface HarvestWindow {
  /** Estimated harvest date (ISO). */
  date: string;
  /** Full month name, e.g. "July". */
  month: string;
  /** Week of the month (1-based). */
  week: number;
  /** Human label, e.g. "July, Week 2". */
  label: string;
}

/**
 * Estimate the harvest window from a flowering date: flowering + ~30 days,
 * reported as the Month and Week-of-month it falls in. Returns null when there's
 * no valid flowering date.
 */
export function estimateHarvestWindow(floweringDate: string | undefined): HarvestWindow | null {
  if (!floweringDate) return null;
  let flower: Date;
  try {
    flower = parseISO(floweringDate);
  } catch {
    return null;
  }
  if (!isValid(flower)) return null;

  const harvest = addDays(flower, FRUIT_DAYS_FLOWER_TO_HARVEST);
  const month = format(harvest, 'MMMM');
  const week = getWeekOfMonth(harvest);
  return {
    date: harvest.toISOString(),
    month,
    week,
    label: `${month}, Week ${week}`,
  };
}

/**
 * Whether "now" falls in the same calendar month AND week-of-month as the given
 * harvest window — i.e. the batch has entered its harvest window and should be
 * flagged ready to harvest.
 */
export function isInHarvestWindow(window: HarvestWindow | null, reference: Date = new Date()): boolean {
  if (!window) return false;
  const nowMonth = format(reference, 'MMMM');
  const nowWeek = getWeekOfMonth(reference);
  return nowMonth === window.month && nowWeek === window.week;
}

/**
 * Whether an ISO date string (YYYY-MM-DD) is later than today.
 * Used to confirm before recording a sale/expense dated in the future.
 * String comparison is safe here since both are zero-padded ISO dates.
 */
export function isFutureDate(isoDate: string): boolean {
  if (!isoDate) return false;
  return isoDate > todayISO();
}
