import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PayrollEntry, WorkedDay } from '../types';
import { generateId, now } from '../utils/id';
import { sumWorkedDays, payoutDate } from '../utils/payroll';
import { useTimesheetStore } from './timesheetStore';

/** Bucket for payroll entries missing a labor type / accounting classification. */
const UNCLASSIFIED_LABEL = 'Unclassified';

/**
 * An "empty" payroll line: no days worked and no commission/bonus/deductions —
 * i.e. nothing owed and nothing to adjust (net pay of 0). These add only noise,
 * so Run Payroll skips generating them and the ledger hides any that exist.
 */
export function isEmptyPayrollLine(
  line: Pick<PayrollEntry, 'daysWorked' | 'commissionAmount' | 'bonus' | 'deductions'>
): boolean {
  return (
    (Number(line.daysWorked) || 0) === 0 &&
    (Number(line.commissionAmount) || 0) === 0 &&
    (Number(line.bonus) || 0) === 0 &&
    (Number(line.deductions) || 0) === 0
  );
}

/** Normalize worked days into a stable comparable signature (sorted date:fraction). */
export function workedDaysSignature(days: WorkedDay[] | undefined): string {
  return (days ?? [])
    .map((d) => `${d.date}:${d.fraction}`)
    .sort()
    .join('|');
}

/**
 * Whether a generated entry no longer matches the timesheet it came from.
 * Entries are snapshots taken at Run-Payroll time; if the week's timesheet is
 * later edited, the entry is "stale" and should be re-generated (delete + re-run)
 * rather than silently updated — this keeps already-paid entries trustworthy.
 */
export function isPayrollEntryStale(entry: Pick<PayrollEntry, 'employeeId' | 'payPeriodStart' | 'workedDays'>): boolean {
  const current = useTimesheetStore.getState().getWorkedDays(entry.payPeriodStart, entry.employeeId);
  return workedDaysSignature(entry.workedDays) !== workedDaysSignature(current);
}

/** Auto-calculate gross and net pay */
function calcPayroll(daysWorked: number, rate: number, deductions: number, commissionAmount: number, bonus: number) {
  const grossPay = daysWorked * rate + commissionAmount + bonus;
  const netPay = grossPay - deductions;
  return { grossPay, netPay };
}

/**
 * The effective day count for pay math: derived from the per-day timesheet
 * (workedDays) when present, otherwise the raw daysWorked number (legacy / quick
 * manual entries).
 */
function effectiveDaysWorked(data: Pick<PayrollEntry, 'daysWorked' | 'workedDays'>): number {
  if (data.workedDays && data.workedDays.length > 0) return sumWorkedDays(data.workedDays);
  return data.daysWorked ?? 0;
}

type NewPayrollInput = Omit<PayrollEntry, 'id' | 'grossPay' | 'netPay' | 'createdAt' | 'updatedAt'>;

interface PayrollState {
  entries: PayrollEntry[];
  addEntry: (data: NewPayrollInput) => PayrollEntry;
  /** Add several entries at once (batch "Run Payroll"); returns the created entries. */
  addBatch: (rows: NewPayrollInput[]) => PayrollEntry[];
  updateEntry: (id: string, data: Partial<Omit<PayrollEntry, 'id' | 'createdAt'>>) => void;
  deleteEntry: (id: string) => void;
  getEntry: (id: string) => PayrollEntry | undefined;
  /** Mark an entry paid. Date defaults to the pay week's Saturday, but can be earlier. */
  markPaid: (id: string, paidDate?: string) => void;
  /** Mark several entries paid at once (e.g. a combined catch-up payslip). */
  markManyPaid: (ids: string[], paidDate?: string) => void;
  markUnpaid: (id: string) => void;
  /** Whether an employee already has an entry for a given pay-period start. */
  hasEntryForPeriod: (employeeId: string, payPeriodStart: string) => boolean;
  /** Unpaid entries for an employee, sorted by period start ascending. */
  unpaidForEmployee: (employeeId: string) => PayrollEntry[];
  totalPayroll: () => number;
  totalByEmployee: () => Record<string, number>;
  /**
   * Net pay grouped by labor type (Direct / Indirect / Selling / Administrative),
   * snapshotted on each entry at Run-Payroll time. Entries without one fall into
   * `Unclassified`.
   */
  totalByLaborType: () => Record<string, number>;
  /**
   * Net pay grouped by accounting classification (COGS vs OpEx variants), so
   * payroll cost can be split the same way expenses are. Entries without one
   * fall into `Unclassified`.
   */
  totalByAccountingClassification: () => Record<string, number>;
}

/** Build a fully-computed PayrollEntry from input (shared by add + addBatch). */
function buildEntry(data: NewPayrollInput): PayrollEntry {
  const daysWorked = effectiveDaysWorked(data);
  const { grossPay, netPay } = calcPayroll(
    daysWorked, data.rate, data.deductions, data.commissionAmount ?? 0, data.bonus ?? 0
  );
  return {
    ...data,
    daysWorked,
    commissionAmount: data.commissionAmount ?? 0,
    bonus: data.bonus ?? 0,
    paid: data.paid ?? false,
    grossPay,
    netPay,
    id: generateId(),
    createdAt: now(),
    updatedAt: now(),
  };
}

export const usePayrollStore = create<PayrollState>()(
  persist(
    (set, get) => ({
      entries: [],

      addEntry: (data) => {
        const entry = buildEntry(data);
        set((state) => ({ entries: [...state.entries, entry] }));
        return entry;
      },

      addBatch: (rows) => {
        const created = rows.map(buildEntry);
        set((state) => ({ entries: [...state.entries, ...created] }));
        return created;
      },

      updateEntry: (id, data) =>
        set((state) => ({
          entries: state.entries.map((e) => {
            if (e.id !== id) return e;
            const updated = { ...e, ...data, updatedAt: now() };
            // Recompute daysWorked from the timesheet when it changed / is present
            updated.daysWorked = effectiveDaysWorked(updated);
            const { grossPay, netPay } = calcPayroll(
              updated.daysWorked, updated.rate, updated.deductions,
              updated.commissionAmount ?? 0, updated.bonus ?? 0
            );
            return { ...updated, grossPay, netPay };
          }),
        })),

      deleteEntry: (id) =>
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),

      getEntry: (id) => get().entries.find((e) => e.id === id),

      markPaid: (id, paidDate) =>
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id
              ? { ...e, paid: true, paidDate: paidDate ?? payoutDate(e.payPeriodStart), updatedAt: now() }
              : e
          ),
        })),

      markManyPaid: (ids, paidDate) =>
        set((state) => {
          const idSet = new Set(ids);
          return {
            entries: state.entries.map((e) =>
              idSet.has(e.id)
                ? { ...e, paid: true, paidDate: paidDate ?? payoutDate(e.payPeriodStart), updatedAt: now() }
                : e
            ),
          };
        }),

      markUnpaid: (id) =>
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id ? { ...e, paid: false, paidDate: undefined, updatedAt: now() } : e
          ),
        })),

      hasEntryForPeriod: (employeeId, payPeriodStart) =>
        get().entries.some((e) => e.employeeId === employeeId && e.payPeriodStart === payPeriodStart),

      unpaidForEmployee: (employeeId) =>
        get().entries
          .filter((e) => e.employeeId === employeeId && !e.paid)
          .sort((a, b) => a.payPeriodStart.localeCompare(b.payPeriodStart)),

      totalPayroll: () => get().entries.reduce((sum, e) => sum + e.netPay, 0),

      totalByEmployee: () =>
        get().entries.reduce<Record<string, number>>((acc, e) => {
          acc[e.employeeName] = (acc[e.employeeName] ?? 0) + e.netPay;
          return acc;
        }, {}),

      totalByLaborType: () =>
        get().entries.reduce<Record<string, number>>((acc, e) => {
          const label = (e.laborType ?? '').trim() || UNCLASSIFIED_LABEL;
          acc[label] = (acc[label] ?? 0) + e.netPay;
          return acc;
        }, {}),

      totalByAccountingClassification: () =>
        get().entries.reduce<Record<string, number>>((acc, e) => {
          const label = (e.accountingClassification ?? '').trim() || UNCLASSIFIED_LABEL;
          acc[label] = (acc[label] ?? 0) + e.netPay;
          return acc;
        }, {}),
    }),
    { name: 'dfd-payroll' }
  )
);
