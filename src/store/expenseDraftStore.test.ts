import { describe, it, expect, beforeEach } from 'vitest';
import {
  useExpenseDraftStore,
  productDraftHasContent,
  serviceDraftHasContent,
} from './expenseDraftStore';

/** Reset the draft to its empty baseline before each test. */
beforeEach(() => {
  useExpenseDraftStore.getState().clear();
});

const store = () => useExpenseDraftStore.getState();

describe('expenseDraftStore', () => {
  it('starts empty with no content', () => {
    expect(store().kind).toBe('product');
    expect(store().product).toEqual({});
    expect(store().service).toEqual({});
    expect(productDraftHasContent(store().product)).toBe(false);
    expect(serviceDraftHasContent(store().service)).toBe(false);
  });

  it('patchProduct merges fields', () => {
    store().patchProduct({ category: 'Fertilizer', amount: 500 });
    expect(store().product.category).toBe('Fertilizer');
    expect(store().product.amount).toBe(500);

    // A second patch merges rather than replaces.
    store().patchProduct({ subcategory: 'Magnesium' });
    expect(store().product.category).toBe('Fertilizer');
    expect(store().product.subcategory).toBe('Magnesium');
  });

  it('patchService merges independently of the product draft', () => {
    store().patchProduct({ category: 'Fertilizer' });
    store().patchService({ category: 'Utilities', amount: 120 });
    expect(store().service.category).toBe('Utilities');
    expect(store().service.amount).toBe(120);
    expect(store().product.category).toBe('Fertilizer');
  });

  it('remembers the last-open kind', () => {
    store().setKind('service');
    expect(store().kind).toBe('service');
  });

  it('clear wipes everything back to the empty baseline', () => {
    store().setKind('service');
    store().patchProduct({ category: 'Fertilizer', items: [] });
    store().patchService({ amount: 99 });

    store().clear();
    expect(store().kind).toBe('product');
    expect(store().product).toEqual({});
    expect(store().service).toEqual({});
  });

  it('preserves itemized line items and inline vendor supplies in the product draft', () => {
    store().patchProduct({
      mode: 'itemized',
      items: [
        { productId: '', name: 'Box', category: 'Packaging Materials', subcategory: 'Box', quantity: 10, unit: 'pc', unitPrice: 5, total: 50 },
      ],
      newVendorSupplies: [{ category: 'Packaging Materials', subcategory: 'Box' }],
    });
    expect(store().product.mode).toBe('itemized');
    expect(store().product.items).toHaveLength(1);
    expect(store().product.items?.[0].name).toBe('Box');
    expect(store().product.newVendorSupplies?.[0].category).toBe('Packaging Materials');
  });
});

describe('productDraftHasContent', () => {
  it('is false for the empty draft', () => {
    expect(productDraftHasContent({})).toBe(false);
  });

  it('ignores fields that carry a non-empty DEFAULT on a fresh form', () => {
    // date, paymentMethod, mode, paid/isPaid, resell, cuttingState are all
    // present on an untouched form and must NOT count as user content.
    expect(
      productDraftHasContent({
        date: '2026-09-18',
        mode: 'single',
        paymentMethod: 'Cash',
        paid: false,
        isPaid: false,
        isResell: false,
        cuttingState: 'packed',
        quantity: 0,
        unitPrice: 0,
        amount: 0,
      }),
    ).toBe(false);
  });

  it('is true once a meaningful field is filled, and false again when cleared', () => {
    expect(productDraftHasContent({ category: 'Fertilizer' })).toBe(true);
    expect(productDraftHasContent({ vendorName: 'Acme' })).toBe(true);
    expect(productDraftHasContent({ amount: 500 })).toBe(true);
    expect(productDraftHasContent({ notes: 'note' })).toBe(true);
    expect(productDraftHasContent({ items: [{ productId: '', name: 'X', category: 'C', subcategory: '', quantity: 1, unit: '', unitPrice: 1, total: 1 }] })).toBe(true);
    // Cleared back to blank/zero → no content.
    expect(productDraftHasContent({ category: '', vendorName: '  ', amount: 0, items: [] })).toBe(false);
  });
});

describe('serviceDraftHasContent', () => {
  it('is false for the empty draft and for defaults-only', () => {
    expect(serviceDraftHasContent({})).toBe(false);
    expect(serviceDraftHasContent({ date: '2026-09-18', paymentMethod: 'Cash', paid: false, isPaid: false, amount: 0 })).toBe(false);
  });

  it('is true once a meaningful field is filled', () => {
    expect(serviceDraftHasContent({ category: 'Utilities' })).toBe(true);
    expect(serviceDraftHasContent({ amount: 120 })).toBe(true);
    expect(serviceDraftHasContent({ vendorName: 'PLDT' })).toBe(true);
  });
});
