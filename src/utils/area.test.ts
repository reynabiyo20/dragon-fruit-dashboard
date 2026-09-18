import { describe, it, expect } from 'vitest';
import { toHectares, totalHectares, formatHectares } from './area';

describe('toHectares', () => {
  it('passes hectares through unchanged', () => {
    expect(toHectares(2, 'Hectare')).toBe(2);
    expect(toHectares(1.5, 'ha')).toBe(1.5);
  });

  it('converts square meters (10,000 sqm = 1 ha)', () => {
    expect(toHectares(10000, 'Sqm')).toBe(1);
    expect(toHectares(5000, 'sqm')).toBeCloseTo(0.5, 6);
  });

  it('converts acres (1 acre ≈ 0.4047 ha)', () => {
    expect(toHectares(1, 'Acre')).toBeCloseTo(0.404686, 6);
    expect(toHectares(2, 'acres')).toBeCloseTo(0.809372, 6);
  });

  it('treats TBD / unknown / empty units as no measurable area', () => {
    expect(toHectares(1000, 'TBD')).toBe(0);
    expect(toHectares(1000, '')).toBe(0);
    expect(toHectares(1000, 'Post')).toBe(0);
  });

  it('returns 0 for non-positive areas', () => {
    expect(toHectares(0, 'Hectare')).toBe(0);
    expect(toHectares(-5, 'Sqm')).toBe(0);
  });

  it('is case-insensitive on the unit', () => {
    expect(toHectares(10000, 'SQM')).toBe(1);
    expect(toHectares(1, 'HECTARE')).toBe(1);
  });
});

describe('totalHectares', () => {
  it('sums mixed-unit sections into hectares', () => {
    const sections = [
      { area: 10000, unit: 'Sqm' },   // 1 ha
      { area: 1, unit: 'Hectare' },    // 1 ha
      { area: 1, unit: 'Acre' },       // ~0.4047 ha
      { area: 500, unit: 'TBD' },      // 0
    ];
    expect(totalHectares(sections)).toBeCloseTo(1 + 1 + 0.404686, 6);
  });

  it('is 0 for an empty list', () => {
    expect(totalHectares([])).toBe(0);
  });
});

describe('formatHectares', () => {
  it('formats with 2 decimals and a ha suffix', () => {
    expect(formatHectares(1.5)).toBe('1.50 ha');
    expect(formatHectares(0)).toBe('0.00 ha');
  });
});
