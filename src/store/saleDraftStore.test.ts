import { describe, it, expect, beforeEach } from 'vitest';
import { useSaleDraftStore, saleDraftHasContent } from './saleDraftStore';

/** Reset the draft to its empty baseline before each test. */
beforeEach(() => {
  useSaleDraftStore.getState().clear();
});

const store = () => useSaleDraftStore.getState();

describe('saleDraftStore', () => {
  it('starts empty with no content', () => {
    expect(store().draft).toEqual({});
    expect(saleDraftHasContent(store().draft)).toBe(false);
  });

  it('patch merges fields', () => {
    store().patch({ customerName: 'Acme', saleType: 'Walk-in' });
    expect(store().draft.customerName).toBe('Acme');
    expect(store().draft.saleType).toBe('Walk-in');

    store().patch({ paid: true });
    expect(store().draft.customerName).toBe('Acme');
    expect(store().draft.paid).toBe(true);
  });

  it('preserves line items with their _key alongside the surcharge/quantity maps', () => {
    store().patch({
      items: [
        { _key: 'k1', productId: 'p1', productName: 'Fruit – Red', quantity: 3, unitPrice: 50, surcharge: 0, total: 150 },
      ],
      surchargeOverridden: { k1: true },
      quantityEntered: { k1: true },
      isDelivered: true,
    });
    expect(store().draft.items).toHaveLength(1);
    expect(store().draft.items?.[0]._key).toBe('k1');
    expect(store().draft.surchargeOverridden?.k1).toBe(true);
    expect(store().draft.quantityEntered?.k1).toBe(true);
    expect(store().draft.isDelivered).toBe(true);
  });

  it('clear wipes everything back to the empty baseline', () => {
    store().patch({ customerName: 'Acme', items: [], isPaid: true });
    store().clear();
    expect(store().draft).toEqual({});
  });
});

describe('saleDraftHasContent', () => {
  it('is false for the empty draft and for defaults-only', () => {
    expect(saleDraftHasContent({})).toBe(false);
    // date, paymentMethod, country, paid/isPaid are present on a fresh form and
    // must NOT count as user content.
    expect(
      saleDraftHasContent({
        date: '2026-09-18',
        paymentMethod: 'Cash',
        country: 'Philippines',
        paid: false,
        isPaid: false,
        items: [],
      }),
    ).toBe(false);
  });

  it('is true once a meaningful field is filled, and false again when cleared', () => {
    expect(saleDraftHasContent({ customerName: 'Acme' })).toBe(true);
    expect(saleDraftHasContent({ saleType: 'Walk-in' })).toBe(true);
    expect(saleDraftHasContent({ notes: 'urgent' })).toBe(true);
    expect(
      saleDraftHasContent({
        items: [{ _key: 'k1', productId: 'p1', productName: 'X', quantity: 1, unitPrice: 1, surcharge: 0, total: 1 }],
      }),
    ).toBe(true);
    // Cleared back to blank → no content.
    expect(saleDraftHasContent({ customerName: '  ', saleType: '', items: [] })).toBe(false);
  });
});
