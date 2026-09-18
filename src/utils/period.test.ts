import { describe, it, expect } from 'vitest';
import {
  ALL_PERIODS, periodIsAll, dateMatchesPeriod, availableYears, MONTH_LABELS,
} from './period';

describe('periodIsAll', () => {
  it('is true for the default (no constraint)', () => {
    expect(periodIsAll(ALL_PERIODS)).toBe(true);
  });
  it('is false when a year is set', () => {
    expect(periodIsAll({ year: 2026, month: 'all' })).toBe(false);
  });
  it('is false when a month is set', () => {
    expect(periodIsAll({ year: 'all', month: 5 })).toBe(false);
  });
});

describe('dateMatchesPeriod', () => {
  const d = '2026-07-15';

  it('matches everything when unconstrained', () => {
    expect(dateMatchesPeriod(d, ALL_PERIODS)).toBe(true);
    expect(dateMatchesPeriod('', ALL_PERIODS)).toBe(true);
  });

  it('matches on year only', () => {
    expect(dateMatchesPeriod(d, { year: 2026, month: 'all' })).toBe(true);
    expect(dateMatchesPeriod(d, { year: 2025, month: 'all' })).toBe(false);
  });

  it('matches on month only (1-based)', () => {
    expect(dateMatchesPeriod(d, { year: 'all', month: 7 })).toBe(true);
    expect(dateMatchesPeriod(d, { year: 'all', month: 6 })).toBe(false);
  });

  it('matches on both year and month', () => {
    expect(dateMatchesPeriod(d, { year: 2026, month: 7 })).toBe(true);
    expect(dateMatchesPeriod(d, { year: 2026, month: 8 })).toBe(false);
    expect(dateMatchesPeriod(d, { year: 2025, month: 7 })).toBe(false);
  });

  it('excludes empty/invalid dates when a constraint is active', () => {
    expect(dateMatchesPeriod('', { year: 2026, month: 'all' })).toBe(false);
    expect(dateMatchesPeriod('not-a-date', { year: 2026, month: 'all' })).toBe(false);
  });

  it('treats January as month 1 and December as month 12', () => {
    expect(dateMatchesPeriod('2026-01-01', { year: 'all', month: 1 })).toBe(true);
    expect(dateMatchesPeriod('2026-12-31', { year: 'all', month: 12 })).toBe(true);
    expect(dateMatchesPeriod('2026-12-31', { year: 'all', month: 1 })).toBe(false);
  });
});

describe('availableYears', () => {
  it('always includes the current year, newest first', () => {
    const current = new Date().getFullYear();
    const years = availableYears([]);
    expect(years).toContain(current);
  });

  it('collects distinct years across lists, sorted descending', () => {
    const years = availableYears(
      ['2024-03-01', '2026-01-01', '2024-11-01'],
      ['2025-06-01'],
    );
    // Descending, de-duplicated
    expect(years).toEqual([...years].sort((a, b) => b - a));
    expect(new Set(years).size).toBe(years.length);
    expect(years).toContain(2024);
    expect(years).toContain(2025);
    expect(years).toContain(2026);
  });

  it('ignores empty/invalid dates', () => {
    const current = new Date().getFullYear();
    const years = availableYears(['', 'bad', '2023-05-05']);
    expect(years).toContain(2023);
    expect(years).toContain(current);
    // No NaN leaked in
    expect(years.every((y) => Number.isFinite(y))).toBe(true);
  });
});

describe('MONTH_LABELS', () => {
  it('has 12 months in order', () => {
    expect(MONTH_LABELS).toHaveLength(12);
    expect(MONTH_LABELS[0]).toBe('January');
    expect(MONTH_LABELS[11]).toBe('December');
  });
});
