import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useSaleStore } from './saleStore';
import { isDraftInvoice, isOfficialInvoice } from '../utils/invoice';

/**
 * Late-binding invoice numbering:
 *  - Pending (unpaid) sales get a throwaway DRAFT- id.
 *  - The official INV-<year>-<seq> number is allocated only at the moment the
 *    sale is finalized (paid), and is permanent thereafter.
 *  - Deleting drafts never consumes an official sequence slot.
 */
describe('late-binding invoice numbers', () => {
  const base = {
    date: '2026-05-10',
    invoiceNumber: '',
    customerId: '',
    customerName: 'X',
    saleType: '',
    items: [],
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

  it('assigns a DRAFT id to a pending (unpaid) sale', () => {
    const sale = useSaleStore.getState().addSale({ ...base, paid: false });
    expect(isDraftInvoice(sale.invoiceNumber)).toBe(true);
    expect(useSaleStore.getState().invoiceCounters['2026'] ?? 0).toBe(0);
  });

  it('assigns the next official number when a sale is created paid', () => {
    const sale = useSaleStore.getState().addSale({ ...base, paid: true });
    expect(sale.invoiceNumber).toBe('INV-2026-1001');
    expect(useSaleStore.getState().invoiceCounters['2026']).toBe(1001);
  });

  it('finalizes a draft into an official number the moment it is marked paid', () => {
    const sale = useSaleStore.getState().addSale({ ...base, paid: false });
    expect(isDraftInvoice(sale.invoiceNumber)).toBe(true);

    useSaleStore.getState().updateSale(sale.id, { paid: true });
    const updated = useSaleStore.getState().getSale(sale.id)!;
    expect(updated.invoiceNumber).toBe('INV-2026-1001');
    expect(isOfficialInvoice(updated.invoiceNumber)).toBe(true);
  });

  it('keeps the official number permanent even if the sale is later un-paid', () => {
    const sale = useSaleStore.getState().addSale({ ...base, paid: true });
    const official = sale.invoiceNumber;
    useSaleStore.getState().updateSale(sale.id, { paid: false });
    expect(useSaleStore.getState().getSale(sale.id)!.invoiceNumber).toBe(official);
    // Re-paying does NOT allocate a new number.
    useSaleStore.getState().updateSale(sale.id, { paid: true });
    expect(useSaleStore.getState().getSale(sale.id)!.invoiceNumber).toBe(official);
    expect(useSaleStore.getState().invoiceCounters['2026']).toBe(1001);
  });

  it('does not waste a sequence slot when a draft is deleted', () => {
    const draft = useSaleStore.getState().addSale({ ...base, paid: false });
    useSaleStore.getState().deleteSale(draft.id);
    // First finalized sale still gets 1001 — the deleted draft consumed nothing.
    const paid = useSaleStore.getState().addSale({ ...base, paid: true });
    expect(paid.invoiceNumber).toBe('INV-2026-1001');
  });

  it('issues sequential official numbers in finalization order', () => {
    const a = useSaleStore.getState().addSale({ ...base, paid: false });
    const b = useSaleStore.getState().addSale({ ...base, paid: false });
    // Finalize B first, then A → B gets 1001, A gets 1002.
    useSaleStore.getState().updateSale(b.id, { paid: true });
    useSaleStore.getState().updateSale(a.id, { paid: true });
    expect(useSaleStore.getState().getSale(b.id)!.invoiceNumber).toBe('INV-2026-1001');
    expect(useSaleStore.getState().getSale(a.id)!.invoiceNumber).toBe('INV-2026-1002');
  });

  it('scopes the sequence per year', () => {
    const a = useSaleStore.getState().addSale({ ...base, date: '2026-12-31', paid: true });
    const b = useSaleStore.getState().addSale({ ...base, date: '2027-01-02', paid: true });
    expect(a.invoiceNumber).toBe('INV-2026-1001');
    expect(b.invoiceNumber).toBe('INV-2027-1001');
  });
});
