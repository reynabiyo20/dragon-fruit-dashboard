import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useSaleStore } from './saleStore';

/**
 * Currency-scoped sale totals. PHP (local) and USD (international) are kept
 * strictly separate — totalRevenue/Paid/Unpaid filter by currency and never sum
 * across currencies. A missing currency is treated as PHP (back-compat).
 */
describe('currency-scoped sale totals', () => {
  const base = {
    date: '2026-05-10',
    invoiceNumber: '',
    customerId: '',
    customerName: 'X',
    country: '',
    saleType: '',
    items: [{ productId: 'p1', productName: 'Fruit – Thai White', quantity: 2, unitPrice: 100, surcharge: 0, total: 0 }],
    paymentMethod: '',
    paymentDetails: '',
    delivered: false,
    notes: '',
    soldByEmployeeId: '',
    soldByName: '',
  };

  beforeEach(() => {
    useSaleStore.setState({ sales: [], invoiceCounters: {} });
  });

  it('sums PHP and USD sales separately (never combined)', () => {
    // Local PHP sale: 2 × 100 = 200
    useSaleStore.getState().addSale({ ...base, currency: 'PHP', paid: true });
    // International USD sale: 3 × 10 = 30
    useSaleStore.getState().addSale({
      ...base,
      currency: 'USD',
      paid: true,
      items: [{ productId: 'p2', productName: 'Fruit – Thai White', quantity: 3, unitPrice: 10, surcharge: 0, total: 0 }],
    });

    const s = useSaleStore.getState();
    expect(s.totalRevenue('PHP')).toBe(200);
    expect(s.totalRevenue('USD')).toBe(30);
    // Default (no arg) is PHP — the USD sale must NOT leak into it.
    expect(s.totalRevenue()).toBe(200);
  });

  it('scopes paid/unpaid by currency', () => {
    useSaleStore.getState().addSale({ ...base, currency: 'PHP', paid: false }); // 200 unpaid PHP
    useSaleStore.getState().addSale({
      ...base, currency: 'USD', paid: false,
      items: [{ productId: 'p2', productName: 'X', quantity: 5, unitPrice: 10, surcharge: 0, total: 0 }], // 50 unpaid USD
    });

    const s = useSaleStore.getState();
    expect(s.totalUnpaid('PHP')).toBe(200);
    expect(s.totalUnpaid('USD')).toBe(50);
    expect(s.totalPaid('PHP')).toBe(0);
    expect(s.totalPaid('USD')).toBe(0);
  });

  it('treats a sale with no currency as PHP', () => {
    // Force a legacy sale with no currency field.
    useSaleStore.setState({
      sales: [{
        id: 's1', date: '2026-01-01', invoiceNumber: 'INV-2026-1001', customerId: '', customerName: 'X',
        saleType: '', items: [], subtotal: 500, paymentMethod: 'Cash', paymentDetails: '', paid: true,
        soldByEmployeeId: '', soldByName: '', notes: '', createdAt: '', updatedAt: '',
      }],
      invoiceCounters: {},
    });
    const s = useSaleStore.getState();
    expect(s.totalRevenue('PHP')).toBe(500);
    expect(s.totalRevenue('USD')).toBe(0);
  });
});
