import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { recordExpenseInventory, reverseExpenseInventory } from './inventoryLink';
import { useInventoryStore } from './inventoryStore';
import type { InventoryItem, ExpenseItem, Expense } from '../types';

/** A minimal inventory row (endingQty derived by the store on add). */
function seedRow(subcategory: string, category: string): InventoryItem {
  return {
    id: `${category}-${subcategory}`,
    subcategory,
    category,
    unit: 'sack',
    beginningQty: 0,
    purchased: 0,
    used: 0,
    sold: 0,
    endingQty: 0,
    unitCost: 0,
    notes: '',
    createdAt: '',
    updatedAt: '',
  };
}

beforeEach(() => {
  // Controlled inventory: one Fertilizer row we can assert on.
  useInventoryStore.setState({
    items: [seedRow('Magnesium', 'Fertilizer')],
    _seeded: 999,
  });
});

const inv = () => useInventoryStore.getState();
const rowOf = (subcategory: string, category: string) => inv().findByCategorySub(category, subcategory);
const purchasedOf = (subcategory: string, category: string) => rowOf(subcategory, category)?.purchased ?? 0;

function eItem(over: Partial<ExpenseItem>): ExpenseItem {
  const quantity = over.quantity ?? 1;
  const unitPrice = over.unitPrice ?? 0;
  return {
    productId: '',
    name: over.name ?? 'X',
    category: over.category ?? 'Fertilizer',
    subcategory: over.subcategory ?? 'Magnesium',
    quantity,
    unit: over.unit ?? 'sack',
    unitPrice,
    total: quantity * unitPrice,
    ...over,
  };
}

/** Build a flat (single-line) expense-inventory input. */
function flat(over: Partial<Pick<Expense, 'category' | 'subcategory' | 'quantity' | 'unit' | 'unitPrice'>>) {
  return {
    category: over.category ?? 'Fertilizer',
    subcategory: over.subcategory ?? 'Magnesium',
    quantity: over.quantity ?? 0,
    unit: over.unit ?? 'sack',
    unitPrice: over.unitPrice ?? 0,
  };
}

describe('inventoryLink — multi-item purchases', () => {
  it('adds each item quantity to the matching row', () => {
    recordExpenseInventory({
      ...flat({ quantity: 0 }),
      items: [
        eItem({ category: 'Fertilizer', subcategory: 'Magnesium', quantity: 3 }),
        eItem({ category: 'Fertilizer', subcategory: 'Magnesium', quantity: 2 }),
      ],
    });
    expect(purchasedOf('Magnesium', 'Fertilizer')).toBe(5);
  });

  it('reverses per-item quantities (edit/delete)', () => {
    const expense = {
      ...flat({ quantity: 0 }),
      items: [eItem({ category: 'Fertilizer', subcategory: 'Magnesium', quantity: 4 })],
    };
    recordExpenseInventory(expense);
    expect(purchasedOf('Magnesium', 'Fertilizer')).toBe(4);
    reverseExpenseInventory(expense);
    expect(purchasedOf('Magnesium', 'Fertilizer')).toBe(0);
  });

  it('auto-creates rows for ANY category (not just inventory-linked ones)', () => {
    recordExpenseInventory({
      ...flat({ category: 'Packaging Materials', subcategory: 'Box', quantity: 0 }),
      items: [eItem({ category: 'Packaging Materials', subcategory: 'Box', quantity: 10, unit: 'box', unitPrice: 5 })],
    });
    const row = rowOf('Box', 'Packaging Materials');
    expect(row).toBeDefined();
    expect(row?.purchased).toBe(10);
    expect(row?.unit).toBe('box');   // seeded from the purchase
    expect(row?.unitCost).toBe(5);   // seeded from the purchase
    // The pre-existing Fertilizer row is untouched
    expect(purchasedOf('Magnesium', 'Fertilizer')).toBe(0);
  });
});

describe('inventoryLink — single-line (flat) purchases', () => {
  it('adds a flat purchase quantity to an existing row', () => {
    recordExpenseInventory(flat({ quantity: 7 }));
    expect(purchasedOf('Magnesium', 'Fertilizer')).toBe(7);
  });

  it('auto-creates a row for a flat purchase in a new (category, subcategory)', () => {
    recordExpenseInventory(flat({ category: 'Construction Material', subcategory: 'Cement', quantity: 4, unit: 'bag', unitPrice: 250 }));
    const row = rowOf('Cement', 'Construction Material');
    expect(row?.purchased).toBe(4);
    expect(row?.unit).toBe('bag');
    expect(row?.unitCost).toBe(250);
  });

  it('does nothing for a flat purchase with zero quantity', () => {
    recordExpenseInventory(flat({ quantity: 0 }));
    expect(purchasedOf('Magnesium', 'Fertilizer')).toBe(0);
    expect(inv().items).toHaveLength(1); // no new row created
  });
});
