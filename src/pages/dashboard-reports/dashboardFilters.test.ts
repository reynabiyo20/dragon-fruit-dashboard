import { describe, it, expect } from 'vitest';
import type { Sale } from '../../types';
import {
  DEFAULT_FILTERS, filtersAreDefault, seasonOf,
  saleMatchesSeason, saleMatchesChannel, saleMatchesFulfillment, saleMatchesPeriod,
} from './dashboardFilters';

/** Minimal Sale factory — only the fields the filters read matter. */
function sale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 's1', date: '2026-07-15', invoiceNumber: '', customerId: '', customerName: '',
    saleType: 'Walk-In Consumer', items: [], subtotal: 0,
    paymentMethod: 'Cash', paymentDetails: '', paid: false,
    soldByEmployeeId: '', soldByName: '', notes: '', createdAt: '', updatedAt: '',
    ...overrides,
  };
}

describe('filtersAreDefault', () => {
  it('is true for the default filters', () => {
    expect(filtersAreDefault(DEFAULT_FILTERS)).toBe(true);
  });
  it('is false when any slicer is set', () => {
    expect(filtersAreDefault({ ...DEFAULT_FILTERS, category: 'Fruit' })).toBe(false);
    expect(filtersAreDefault({ ...DEFAULT_FILTERS, channel: 'Wholesale' })).toBe(false);
    expect(filtersAreDefault({ ...DEFAULT_FILTERS, season: 'in-season' })).toBe(false);
    expect(filtersAreDefault({ ...DEFAULT_FILTERS, fulfillment: 'paid' })).toBe(false);
    expect(filtersAreDefault({ ...DEFAULT_FILTERS, period: { year: 2026, month: 'all' } })).toBe(false);
  });
});

describe('seasonOf', () => {
  it('classifies off-season months (Nov–Apr)', () => {
    expect(seasonOf('2026-11-10')).toBe('off-season');
    expect(seasonOf('2026-01-10')).toBe('off-season');
    expect(seasonOf('2026-04-30')).toBe('off-season');
  });
  it('classifies in-season months (May–Oct)', () => {
    expect(seasonOf('2026-05-01')).toBe('in-season');
    expect(seasonOf('2026-07-15')).toBe('in-season');
    expect(seasonOf('2026-10-31')).toBe('in-season');
  });
});

describe('saleMatchesSeason', () => {
  it('matches all when season is "all"', () => {
    expect(saleMatchesSeason(sale(), 'all')).toBe(true);
  });
  it('filters by derived season', () => {
    expect(saleMatchesSeason(sale({ date: '2026-07-15' }), 'in-season')).toBe(true);
    expect(saleMatchesSeason(sale({ date: '2026-07-15' }), 'off-season')).toBe(false);
    expect(saleMatchesSeason(sale({ date: '2026-12-15' }), 'off-season')).toBe(true);
  });
});

describe('saleMatchesChannel', () => {
  it('matches all when channel is "all"', () => {
    expect(saleMatchesChannel(sale({ saleType: 'Wholesale' }), 'all')).toBe(true);
  });
  it('matches the exact saleType', () => {
    expect(saleMatchesChannel(sale({ saleType: 'Wholesale' }), 'Wholesale')).toBe(true);
    expect(saleMatchesChannel(sale({ saleType: 'Wholesale' }), 'Retailer')).toBe(false);
  });
  it('treats an empty saleType as "Other"', () => {
    expect(saleMatchesChannel(sale({ saleType: '' }), 'Other')).toBe(true);
  });
});

describe('saleMatchesFulfillment', () => {
  it('matches all when "all"', () => {
    expect(saleMatchesFulfillment(sale(), 'all')).toBe(true);
  });
  it('filters delivered vs pending', () => {
    expect(saleMatchesFulfillment(sale({ delivered: true }), 'delivered')).toBe(true);
    expect(saleMatchesFulfillment(sale({ delivered: false }), 'delivered')).toBe(false);
    expect(saleMatchesFulfillment(sale({ delivered: undefined }), 'pending')).toBe(true);
  });
  it('filters paid vs unpaid', () => {
    expect(saleMatchesFulfillment(sale({ paid: true }), 'paid')).toBe(true);
    expect(saleMatchesFulfillment(sale({ paid: false }), 'unpaid')).toBe(true);
    expect(saleMatchesFulfillment(sale({ paid: true }), 'unpaid')).toBe(false);
  });
});

describe('saleMatchesPeriod', () => {
  it('matches when unconstrained', () => {
    expect(saleMatchesPeriod(sale({ date: '2026-07-15' }), { year: 'all', month: 'all' })).toBe(true);
  });
  it('filters by year and month', () => {
    expect(saleMatchesPeriod(sale({ date: '2026-07-15' }), { year: 2026, month: 7 })).toBe(true);
    expect(saleMatchesPeriod(sale({ date: '2026-07-15' }), { year: 2026, month: 8 })).toBe(false);
    expect(saleMatchesPeriod(sale({ date: '2025-07-15' }), { year: 2026, month: 'all' })).toBe(false);
  });
});
