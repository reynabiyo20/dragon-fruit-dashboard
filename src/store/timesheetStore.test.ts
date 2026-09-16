import { describe, it, expect, beforeEach } from 'vitest';
import { useTimesheetStore } from './timesheetStore';

beforeEach(() => {
  useTimesheetStore.setState({ days: {} });
});

const store = () => useTimesheetStore.getState();
const WEEK = '2026-01-05';
const EMP = 'e1';

describe('timesheetStore.cycleDay', () => {
  it('cycles none → full(1) → half(0.5) → none', () => {
    const date = '2026-01-05';
    expect(store().getDay(WEEK, EMP, date)).toBeUndefined();

    store().cycleDay(WEEK, EMP, date);
    expect(store().getDay(WEEK, EMP, date)).toBe(1);

    store().cycleDay(WEEK, EMP, date);
    expect(store().getDay(WEEK, EMP, date)).toBe(0.5);

    store().cycleDay(WEEK, EMP, date);
    expect(store().getDay(WEEK, EMP, date)).toBeUndefined();
  });
});

describe('timesheetStore.getWorkedDays', () => {
  it('returns worked days sorted by date', () => {
    store().setDay(WEEK, EMP, '2026-01-07', 0.5);
    store().setDay(WEEK, EMP, '2026-01-05', 1);
    store().setDay(WEEK, EMP, '2026-01-06', 1);
    const worked = store().getWorkedDays(WEEK, EMP);
    expect(worked.map((d) => d.date)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
    expect(worked.find((d) => d.date === '2026-01-07')!.fraction).toBe(0.5);
  });

  it('is isolated per employee and per week', () => {
    store().setDay(WEEK, 'e1', '2026-01-05', 1);
    store().setDay(WEEK, 'e2', '2026-01-05', 0.5);
    store().setDay('2026-01-12', 'e1', '2026-01-12', 1);

    expect(store().getWorkedDays(WEEK, 'e1')).toHaveLength(1);
    expect(store().getWorkedDays(WEEK, 'e2')[0].fraction).toBe(0.5);
    expect(store().getWorkedDays('2026-01-12', 'e1')).toHaveLength(1);
  });
});

describe('timesheetStore.setDay / clearWeek', () => {
  it('setDay with undefined clears a single day', () => {
    store().setDay(WEEK, EMP, '2026-01-05', 1);
    store().setDay(WEEK, EMP, '2026-01-05', undefined);
    expect(store().getDay(WEEK, EMP, '2026-01-05')).toBeUndefined();
  });

  it('clearWeek removes all of an employee\'s days for the week', () => {
    store().setDay(WEEK, EMP, '2026-01-05', 1);
    store().setDay(WEEK, EMP, '2026-01-06', 1);
    store().clearWeek(WEEK, EMP);
    expect(store().getWorkedDays(WEEK, EMP)).toHaveLength(0);
  });
});
