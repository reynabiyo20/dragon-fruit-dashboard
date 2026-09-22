import { describe, it, expect } from 'vitest';
import type { Sale, Expense, Customer, Vendor } from '../../types';
import {
  localPerformanceByLocation, countryPerformance, rollUpToRegion, rollUpToProvince,
  UNSPECIFIED_LOCATION,
} from './locationAggregation';

// ── Minimal factories ────────────────────────────────────────────────────────
function customer(id: string, province: string, municipality = '', country = 'Philippines'): Customer {
  return {
    id, customerName: id, contactPerson: '', phone: '', fbMessengerName: '', email: '', address: '',
    location: { country, province, municipality },
    farmPartner: false, farmPartnerCategory: '', farmPartnerSubcategory: '',
    notes: '', createdAt: '', updatedAt: '',
  };
}
function vendor(id: string, province: string, country = 'Philippines'): Vendor {
  return {
    id, vendor: id, contact: '', phone: '',
    location: { country, province, municipality: '' },
    supplies: [], notes: '', createdAt: '', updatedAt: '',
  };
}
function sale(id: string, customerId: string, subtotal: number, currency: 'PHP' | 'USD' = 'PHP'): Sale {
  return {
    id, date: '2026-01-01', invoiceNumber: '', customerId, customerName: '', saleType: '',
    items: [], subtotal, currency, paymentMethod: 'Cash', paymentDetails: '', paid: true, delivered: true,
    soldByEmployeeId: '', soldByName: '', notes: '', createdAt: '', updatedAt: '',
  };
}
function expense(id: string, vendorId: string, amount: number, currency: 'PHP' | 'USD' = 'PHP'): Expense {
  return {
    id, date: '2026-01-01', vendorId, vendorName: '', category: 'X', subcategory: '', description: '',
    quantity: 0, unit: '', unitPrice: 0, amount, currency, paymentMethod: 'Cash', paid: true, notes: '',
    createdAt: '', updatedAt: '',
  };
}

const mapById = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

describe('localPerformanceByLocation', () => {
  it('attributes a sale to its customer province and derived region', () => {
    const customers = [customer('c1', 'Bulacan', 'Santa Maria')];
    const rows = localPerformanceByLocation([sale('s1', 'c1', 1000)], [], mapById(customers), new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].province).toBe('Bulacan');
    expect(rows[0].region).toBe('Region III (Central Luzon)');
    expect(rows[0].sales).toBe(1000);
  });

  it('REACTIVITY: moving the customer to a new province moves their sales region', () => {
    const sales = [sale('s1', 'c1', 1000)];
    // Before: customer in Bulacan → Central Luzon.
    const before = rollUpToRegion(
      localPerformanceByLocation(sales, [], mapById([customer('c1', 'Bulacan', 'Santa Maria')]), new Map()),
    );
    expect(before.map((r) => r.region)).toContain('Region III (Central Luzon)');

    // After: same sale, customer edited to Oriental Mindoro → MIMAROPA.
    const after = rollUpToRegion(
      localPerformanceByLocation(sales, [], mapById([customer('c1', 'Oriental Mindoro', 'Pinamalayan')]), new Map()),
    );
    expect(after.map((r) => r.region)).toEqual(['Region IV-B (MIMAROPA)']);
    expect(after.map((r) => r.region)).not.toContain('Region III (Central Luzon)');
    expect(after[0].sales).toBe(1000);
  });

  it('buckets sales with no linked customer under Unspecified', () => {
    const rows = localPerformanceByLocation([sale('s1', '', 500)], [], new Map(), new Map());
    expect(rows[0].province).toBe(UNSPECIFIED_LOCATION);
    expect(rows[0].region).toBe(UNSPECIFIED_LOCATION);
  });

  it('excludes international records from the PHP rollup', () => {
    const customers = [customer('c1', '', '', 'United States')];
    const rows = localPerformanceByLocation([sale('s1', 'c1', 900, 'USD')], [], mapById(customers), new Map());
    expect(rows).toHaveLength(0);
  });

  it('attributes expenses to the vendor province', () => {
    const vendors = [vendor('v1', 'Cebu')];
    const rows = localPerformanceByLocation([], [expense('e1', 'v1', 300)], new Map(), mapById(vendors));
    expect(rows[0].province).toBe('Cebu');
    expect(rows[0].expenses).toBe(300);
    expect(rows[0].net).toBe(-300);
  });
});

describe('countryPerformance', () => {
  it('rolls international sales & expenses up by country (USD)', () => {
    const customers = [customer('c1', '', '', 'United States')];
    const vendors = [vendor('v1', '', 'United States')];
    const rows = countryPerformance(
      [sale('s1', 'c1', 900, 'USD')], [expense('e1', 'v1', 100, 'USD')],
      mapById(customers), mapById(vendors),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].country).toBe('United States');
    expect(rows[0].sales).toBe(900);
    expect(rows[0].expenses).toBe(100);
    expect(rows[0].net).toBe(800);
  });

  it('ignores local (Philippine) records', () => {
    const customers = [customer('c1', 'Bulacan', 'Santa Maria')];
    const rows = countryPerformance([sale('s1', 'c1', 900)], [], mapById(customers), new Map());
    expect(rows).toHaveLength(0);
  });
});

describe('rollUpToProvince', () => {
  it('merges municipalities within a province', () => {
    const byLocation = localPerformanceByLocation(
      [sale('s1', 'c1', 100), sale('s2', 'c2', 200)],
      [],
      mapById([customer('c1', 'Cebu', 'Consolacion'), customer('c2', 'Cebu', 'Consolacion')]),
      new Map(),
    );
    const provinces = rollUpToProvince(byLocation);
    expect(provinces).toHaveLength(1);
    expect(provinces[0].province).toBe('Cebu');
    expect(provinces[0].sales).toBe(300);
  });
});
