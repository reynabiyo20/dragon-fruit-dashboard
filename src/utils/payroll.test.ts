import { describe, it, expect } from 'vitest';
import { weekStart, weekEnd, weekDays, payoutDate, sumWorkedDays } from './payroll';

// Reference week: Wed 2026-01-07 → Mon 2026-01-05 … Sun 2026-01-11, Sat = 01-10.
const WED = '2026-01-07';

describe('payroll week math (Monday start)', () => {
  it('weekStart returns the Monday of the week', () => {
    expect(weekStart(WED)).toBe('2026-01-05');
    expect(weekStart('2026-01-05')).toBe('2026-01-05'); // Monday maps to itself
    expect(weekStart('2026-01-11')).toBe('2026-01-05'); // Sunday still same week
  });

  it('weekEnd returns the Sunday of the week', () => {
    expect(weekEnd(WED)).toBe('2026-01-11');
  });

  it('weekDays returns 7 days Monday → Sunday', () => {
    const days = weekDays(WED);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-01-05'); // Mon
    expect(days[6]).toBe('2026-01-11'); // Sun
  });

  it('payoutDate returns the Saturday of the pay week', () => {
    expect(payoutDate('2026-01-05')).toBe('2026-01-10');
  });
});

describe('sumWorkedDays', () => {
  it('sums full and half days', () => {
    expect(
      sumWorkedDays([
        { date: '2026-01-05', fraction: 1 },
        { date: '2026-01-06', fraction: 1 },
        { date: '2026-01-07', fraction: 0.5 },
      ])
    ).toBe(2.5);
  });

  it('returns 0 for empty or undefined', () => {
    expect(sumWorkedDays([])).toBe(0);
    expect(sumWorkedDays(undefined)).toBe(0);
  });
});
