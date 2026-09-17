import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useExpenseStore } from './expenseStore';
import { useInventoryStore } from './inventoryStore';
import { generateId, now } from '../utils/id';
import type { InventoryItem } from '../types';

/**
 * Expensing a category-subcategory product must cascade into inventory: the
 * matching row's `purchased` (and endingQty) increases; a missing row is
 * auto-created; matching is case-insensitive.
 */
function invRow(category: string, subcategory: string): InventoryItem {
  return {
    id: generateId(), category, subcategory, unit: 'sack',
    beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 0,
    unitCost: 0, packed: 0, breedingStock: 0, availableForSale: 0,
    notes: '', createdAt: now(), updatedAt: now(),
  };
}

describe('expense → inventory cascade', () => {
  beforeEach(() => {
    useExpenseStore.setState({ expenses: [] });
    useInventoryStore.setState({ items: [invRow('Fertilizer', 'Magnesium')], _seeded: 999 });
  });

  const rowOf = (c: string, s: string) => useInventoryStore.getState().findByCategorySub(c, s);

  function baseExpense() {
    return {
      date: '2026-01-01', vendorId: 'v1', vendorName: 'Acme',
      category: 'Fertilizer', subcategory: 'Magnesium', description: '',
      quantity: 4, unit: 'sack', unitPrice: 100, amount: 400,
      paymentMethod: 'Cash', paid: true, notes: '',
    };
  }

  it('increments purchased + endingQty on the matching row', () => {
    useExpenseStore.getState().addExpense(baseExpense());
    const row = rowOf('Fertilizer', 'Magnesium')!;
    expect(row.purchased).toBe(4);
    expect(row.endingQty).toBe(4);
  });

  it('matches case-insensitively', () => {
    useExpenseStore.getState().addExpense({ ...baseExpense(), category: 'fertilizer', subcategory: 'magnesium' });
    const row = rowOf('Fertilizer', 'Magnesium')!;
    expect(row.purchased).toBe(4);
  });

  it('auto-creates a row when none exists for the (category, subcategory)', () => {
    useExpenseStore.getState().addExpense({
      ...baseExpense(), category: 'Construction Material', subcategory: 'Cement', quantity: 6, unit: 'bag', unitPrice: 250,
    });
    const row = rowOf('Construction Material', 'Cement');
    expect(row).toBeDefined();
    expect(row?.purchased).toBe(6);
    expect(row?.unit).toBe('bag');
  });

  it('reverses on delete', () => {
    const e = useExpenseStore.getState().addExpense(baseExpense());
    expect(rowOf('Fertilizer', 'Magnesium')?.purchased).toBe(4);
    useExpenseStore.getState().deleteExpense(e.id);
    expect(rowOf('Fertilizer', 'Magnesium')?.purchased).toBe(0);
  });

  it('cascades each line of an itemized expense', () => {
    useExpenseStore.getState().addExpense({
      ...baseExpense(), quantity: 0, unit: '', unitPrice: 0, amount: 900,
      items: [
        { productId: '', name: 'Magnesium', category: 'Fertilizer', subcategory: 'Magnesium', quantity: 3, unit: 'sack', unitPrice: 100, total: 300 },
        { productId: '', name: 'Cocopeat', category: 'Fertilizer', subcategory: 'Cocopeat', quantity: 2, unit: 'sack', unitPrice: 300, total: 600 },
      ],
    });
    expect(rowOf('Fertilizer', 'Magnesium')?.purchased).toBe(3);
    expect(rowOf('Fertilizer', 'Cocopeat')?.purchased).toBe(2);
  });
});
