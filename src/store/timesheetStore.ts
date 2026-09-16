import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkedDay } from '../types';

/**
 * A lightweight timesheet: which days each employee worked, per week.
 *
 * Keyed by `${weekStart}|${employeeId}` (weekStart = Monday ISO date). This is
 * the input to the "Run Payroll" step, which reads an employee's worked days for
 * a week and turns them into a PayrollEntry. Kept separate from payroll so a
 * timesheet can be filled ahead of (and independent from) an actual payroll run.
 *
 * Each day is tri-state: absent (didn't work) → full (1) → half (0.5).
 */

type Fraction = 0.5 | 1;

function key(weekStart: string, employeeId: string): string {
  return `${weekStart}|${employeeId}`;
}

interface TimesheetState {
  /** weekStart|employeeId → { date → fraction } */
  days: Record<string, Record<string, Fraction>>;

  /** The worked days for an employee in a week, as a WorkedDay[] (sorted by date). */
  getWorkedDays: (weekStart: string, employeeId: string) => WorkedDay[];
  /** The fraction set for a single day, or undefined if not worked. */
  getDay: (weekStart: string, employeeId: string, date: string) => Fraction | undefined;
  /**
   * Cycle a day's state: none → full (1) → half (0.5) → none.
   * This backs a single clickable day cell.
   */
  cycleDay: (weekStart: string, employeeId: string, date: string) => void;
  /** Explicitly set (or clear with undefined) a day's fraction. */
  setDay: (weekStart: string, employeeId: string, date: string, fraction: Fraction | undefined) => void;
  /** Clear a whole employee's week. */
  clearWeek: (weekStart: string, employeeId: string) => void;
}

export const useTimesheetStore = create<TimesheetState>()(
  persist(
    (set, get) => ({
      days: {},

      getWorkedDays: (weekStart, employeeId) => {
        const map = get().days[key(weekStart, employeeId)] ?? {};
        return Object.entries(map)
          .map(([date, fraction]) => ({ date, fraction }))
          .sort((a, b) => a.date.localeCompare(b.date));
      },

      getDay: (weekStart, employeeId, date) => get().days[key(weekStart, employeeId)]?.[date],

      cycleDay: (weekStart, employeeId, date) =>
        set((state) => {
          const k = key(weekStart, employeeId);
          const week = { ...(state.days[k] ?? {}) };
          const current = week[date];
          if (current === undefined) {
            week[date] = 1;         // none → full
          } else if (current === 1) {
            week[date] = 0.5;       // full → half
          } else {
            delete week[date];      // half → none
          }
          return { days: { ...state.days, [k]: week } };
        }),

      setDay: (weekStart, employeeId, date, fraction) =>
        set((state) => {
          const k = key(weekStart, employeeId);
          const week = { ...(state.days[k] ?? {}) };
          if (fraction === undefined) delete week[date];
          else week[date] = fraction;
          return { days: { ...state.days, [k]: week } };
        }),

      clearWeek: (weekStart, employeeId) =>
        set((state) => {
          const next = { ...state.days };
          delete next[key(weekStart, employeeId)];
          return { days: next };
        }),
    }),
    { name: 'dfd-timesheet' }
  )
);
