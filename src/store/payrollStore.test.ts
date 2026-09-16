import { describe, it, expect, beforeEach } from 'vitest';
import { usePayrollStore, workedDaysSignature, isPayrollEntryStale, isEmptyPayrollLine } from './payrollStore';
import { useTimesheetStore } from './timesheetStore';
import type { PayrollEntry, WorkedDay } from '../types';

beforeEach(() => {
  usePayrollStore.setState({ entries: [] });
  useTimesheetStore.setState({ days: {} });
});

const store = () => usePayrollStore.getState();

type Input = Omit<PayrollEntry, 'id' | 'grossPay' | 'netPay' | 'createdAt' | 'updatedAt'>;

function input(over: Partial<Input> = {}): Input {
  return {
    payPeriodStart: '2026-01-05',
    payPeriodEnd: '2026-01-11',
    employeeId: 'e1',
    employeeName: 'Alice',
    daysWorked: 0,
    rate: 500,
    deductions: 0,
    commissionAmount: 0,
    bonus: 0,
    notes: '',
    ...over,
  };
}

const fullDays = (dates: string[]): WorkedDay[] => dates.map((date) => ({ date, fraction: 1 }));

describe('payrollStore.addEntry', () => {
  it('derives daysWorked from workedDays and computes gross/net', () => {
    const wd: WorkedDay[] = [
      ...fullDays(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08']),
      { date: '2026-01-09', fraction: 0.5 },
    ]; // 4.5 days
    const e = store().addEntry(input({ workedDays: wd, rate: 500, commissionAmount: 200, bonus: 100, deductions: 50 }));
    expect(e.daysWorked).toBe(4.5);
    expect(e.grossPay).toBe(4.5 * 500 + 200 + 100); // 2550
    expect(e.netPay).toBe(2550 - 50); // 2500
    expect(e.paid).toBe(false);
  });

  it('uses the raw daysWorked number when no workedDays (legacy/manual)', () => {
    const e = store().addEntry(input({ daysWorked: 6, rate: 400 }));
    expect(e.daysWorked).toBe(6);
    expect(e.grossPay).toBe(2400);
    expect(e.netPay).toBe(2400);
  });
});

describe('payrollStore.addBatch', () => {
  it('adds multiple entries at once', () => {
    const created = store().addBatch([
      input({ employeeId: 'e1', employeeName: 'Alice', daysWorked: 5, rate: 500 }),
      input({ employeeId: 'e2', employeeName: 'Bob', daysWorked: 4, rate: 450 }),
    ]);
    expect(created).toHaveLength(2);
    expect(store().entries).toHaveLength(2);
    expect(created[0].netPay).toBe(2500);
    expect(created[1].netPay).toBe(1800);
  });
});

describe('payrollStore paid tracking', () => {
  it('markPaid defaults the pay date to the week Saturday', () => {
    const e = store().addEntry(input({ payPeriodStart: '2026-01-05', daysWorked: 5 }));
    store().markPaid(e.id);
    const updated = store().getEntry(e.id)!;
    expect(updated.paid).toBe(true);
    expect(updated.paidDate).toBe('2026-01-10'); // Saturday
  });

  it('markPaid accepts an earlier custom date (emergency pay)', () => {
    const e = store().addEntry(input({ daysWorked: 5 }));
    store().markPaid(e.id, '2026-01-08');
    expect(store().getEntry(e.id)!.paidDate).toBe('2026-01-08');
  });

  it('markManyPaid flips several entries', () => {
    const a = store().addEntry(input({ employeeId: 'e1', daysWorked: 5 }));
    const b = store().addEntry(input({ employeeId: 'e1', payPeriodStart: '2026-01-12', payPeriodEnd: '2026-01-18', daysWorked: 5 }));
    store().markManyPaid([a.id, b.id], '2026-01-18');
    expect(store().getEntry(a.id)!.paid).toBe(true);
    expect(store().getEntry(b.id)!.paid).toBe(true);
    expect(store().getEntry(b.id)!.paidDate).toBe('2026-01-18');
  });

  it('markUnpaid clears paid + paidDate', () => {
    const e = store().addEntry(input({ daysWorked: 5 }));
    store().markPaid(e.id);
    store().markUnpaid(e.id);
    const updated = store().getEntry(e.id)!;
    expect(updated.paid).toBe(false);
    expect(updated.paidDate).toBeUndefined();
  });
});

describe('payrollStore queries', () => {
  it('hasEntryForPeriod detects an existing employee+period', () => {
    store().addEntry(input({ employeeId: 'e1', payPeriodStart: '2026-01-05', daysWorked: 5 }));
    expect(store().hasEntryForPeriod('e1', '2026-01-05')).toBe(true);
    expect(store().hasEntryForPeriod('e1', '2026-01-12')).toBe(false);
    expect(store().hasEntryForPeriod('e2', '2026-01-05')).toBe(false);
  });

  it('unpaidForEmployee returns only unpaid entries, sorted by period ascending', () => {
    const later = store().addEntry(input({ employeeId: 'e1', payPeriodStart: '2026-01-12', payPeriodEnd: '2026-01-18', daysWorked: 5 }));
    const earlier = store().addEntry(input({ employeeId: 'e1', payPeriodStart: '2026-01-05', payPeriodEnd: '2026-01-11', daysWorked: 5 }));
    const paidOne = store().addEntry(input({ employeeId: 'e1', payPeriodStart: '2025-12-29', payPeriodEnd: '2026-01-04', daysWorked: 5 }));
    store().markPaid(paidOne.id);

    const unpaid = store().unpaidForEmployee('e1');
    expect(unpaid.map((e) => e.id)).toEqual([earlier.id, later.id]); // sorted asc, paid excluded
  });

  it('updateEntry recomputes daysWorked when workedDays change', () => {
    const e = store().addEntry(input({ workedDays: fullDays(['2026-01-05', '2026-01-06']), rate: 500 }));
    expect(e.daysWorked).toBe(2);
    store().updateEntry(e.id, { workedDays: fullDays(['2026-01-05', '2026-01-06', '2026-01-07']) });
    const updated = store().getEntry(e.id)!;
    expect(updated.daysWorked).toBe(3);
    expect(updated.grossPay).toBe(1500);
  });
});

describe('workedDaysSignature', () => {
  it('is order-independent', () => {
    const a: WorkedDay[] = [
      { date: '2026-01-06', fraction: 1 },
      { date: '2026-01-05', fraction: 1 },
    ];
    const b: WorkedDay[] = [
      { date: '2026-01-05', fraction: 1 },
      { date: '2026-01-06', fraction: 1 },
    ];
    expect(workedDaysSignature(a)).toBe(workedDaysSignature(b));
  });

  it('is sensitive to fraction changes', () => {
    const full: WorkedDay[] = [{ date: '2026-01-05', fraction: 1 }];
    const half: WorkedDay[] = [{ date: '2026-01-05', fraction: 0.5 }];
    expect(workedDaysSignature(full)).not.toBe(workedDaysSignature(half));
  });

  it('treats empty and undefined the same', () => {
    expect(workedDaysSignature([])).toBe(workedDaysSignature(undefined));
  });
});

describe('isPayrollEntryStale', () => {
  const WEEK = '2026-01-05';
  const EMP = 'e1';

  function seedTimesheet(days: WorkedDay[]) {
    days.forEach((d) => useTimesheetStore.getState().setDay(WEEK, EMP, d.date, d.fraction));
  }

  it('is not stale when the entry matches the current timesheet', () => {
    const wd: WorkedDay[] = [
      { date: '2026-01-05', fraction: 1 },
      { date: '2026-01-06', fraction: 0.5 },
    ];
    seedTimesheet(wd);
    const e = store().addEntry(input({ employeeId: EMP, payPeriodStart: WEEK, workedDays: wd }));
    expect(isPayrollEntryStale(e)).toBe(false);
  });

  it('is stale when the timesheet changed after generation', () => {
    const wd: WorkedDay[] = [{ date: '2026-01-05', fraction: 1 }];
    seedTimesheet(wd);
    const e = store().addEntry(input({ employeeId: EMP, payPeriodStart: WEEK, workedDays: wd }));
    // Timesheet edited afterward — add another worked day
    useTimesheetStore.getState().setDay(WEEK, EMP, '2026-01-07', 1);
    expect(isPayrollEntryStale(e)).toBe(true);
  });

  it('is stale when the timesheet was cleared after generation', () => {
    const wd: WorkedDay[] = [{ date: '2026-01-05', fraction: 1 }];
    seedTimesheet(wd);
    const e = store().addEntry(input({ employeeId: EMP, payPeriodStart: WEEK, workedDays: wd }));
    useTimesheetStore.getState().clearWeek(WEEK, EMP);
    expect(isPayrollEntryStale(e)).toBe(true);
  });
});

describe('isEmptyPayrollLine', () => {
  const line = (over: Partial<{ daysWorked: number; commissionAmount: number; bonus: number; deductions: number }>) => ({
    daysWorked: 0,
    commissionAmount: 0,
    bonus: 0,
    deductions: 0,
    ...over,
  });

  it('is empty with 0 days and no commission/bonus/deductions', () => {
    expect(isEmptyPayrollLine(line({}))).toBe(true);
  });

  it('is not empty when any component is present', () => {
    expect(isEmptyPayrollLine(line({ daysWorked: 1 }))).toBe(false);
    expect(isEmptyPayrollLine(line({ commissionAmount: 100 }))).toBe(false);
    expect(isEmptyPayrollLine(line({ bonus: 50 }))).toBe(false);
    // A deductions-only line is a real adjustment, so it is NOT hidden
    expect(isEmptyPayrollLine(line({ deductions: 20 }))).toBe(false);
  });

  it('treats a half-day as non-empty', () => {
    expect(isEmptyPayrollLine(line({ daysWorked: 0.5 }))).toBe(false);
  });
});
