import { startOfWeek, endOfWeek, eachDayOfInterval, addDays, parseISO, format } from 'date-fns';
import type { WorkedDay } from '../types';

/**
 * Payroll week conventions (verify with the business later):
 *  - The work week starts on Monday.
 *  - Payout is tied to Saturday of the pay week, but can be earlier (emergencies).
 */
const WEEK_STARTS_ON = 1 as const; // 0=Sun, 1=Mon
/** Saturday, counting from the Monday start (Mon=0 … Sat=5). */
const SATURDAY_OFFSET_FROM_MONDAY = 5;

const toISO = (d: Date) => format(d, 'yyyy-MM-dd');

/** Monday (start) of the week containing `date` (ISO string in, ISO out). */
export function weekStart(date: string): string {
  return toISO(startOfWeek(parseISO(date), { weekStartsOn: WEEK_STARTS_ON }));
}

/** Sunday (end) of the week containing `date`. */
export function weekEnd(date: string): string {
  return toISO(endOfWeek(parseISO(date), { weekStartsOn: WEEK_STARTS_ON }));
}

/** The 7 ISO date strings of the week containing `date`, Monday → Sunday. */
export function weekDays(date: string): string[] {
  const start = startOfWeek(parseISO(date), { weekStartsOn: WEEK_STARTS_ON });
  const end = endOfWeek(parseISO(date), { weekStartsOn: WEEK_STARTS_ON });
  return eachDayOfInterval({ start, end }).map(toISO);
}

/** Default payout date for a pay week: the Saturday of that week. */
export function payoutDate(periodStart: string): string {
  return toISO(addDays(parseISO(periodStart), SATURDAY_OFFSET_FROM_MONDAY));
}

/** Sum worked-day fractions into a numeric day count (e.g. 4 full + 1 half = 4.5). */
export function sumWorkedDays(days: WorkedDay[] | undefined): number {
  if (!days || days.length === 0) return 0;
  return days.reduce((sum, d) => sum + (d.fraction === 0.5 ? 0.5 : 1), 0);
}
