import { describe, it, expect } from 'vitest';
import { format, addDays, subDays } from 'date-fns';
import { todayISO, isFutureDate } from './date';

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

describe('isFutureDate', () => {
  it('is false for today', () => {
    expect(isFutureDate(todayISO())).toBe(false);
  });

  it('is false for a past date', () => {
    expect(isFutureDate(iso(subDays(new Date(), 1)))).toBe(false);
  });

  it('is true for a future date', () => {
    expect(isFutureDate(iso(addDays(new Date(), 1)))).toBe(true);
  });

  it('is false for an empty string', () => {
    expect(isFutureDate('')).toBe(false);
  });
});
