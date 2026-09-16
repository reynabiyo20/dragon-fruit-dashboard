import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useExpenseStore } from './expenseStore';
import { useExpenseCategoryStore } from './expenseCategoryStore';
import { useVendorProductStore } from './vendorProductStore';
import { useUnitStore } from './optionStores';
import type { ExpenseItem } from '../types';

function eItem(over: Partial<ExpenseItem>): ExpenseItem {
  const quantity = over.quantity ?? 1;
  const unitPrice = over.unitPrice ?? 0;
  return {
    productId: '',
    name: over.name ?? 'Box',
    category: over.category ?? 'Packaging Materials',
    subcategory: over.subcategory ?? 'Box',
    quantity,
    unit: over.unit ?? 'box',
    unitPrice,
    total: quantity * unitPrice,
    ...over,
  };
}

beforeEach(() => {
  useExpenseStore.setState({ expenses: [] });
  useVendorProductStore.setState({ products: [], prices: [] });
  // A controlled category entry we can rename. quantifiable so multi-item is natural.
  useExpenseCategoryStore.setState({
    entries: [
      { id: 'c1', category: 'Packaging Materials', subcategory: 'Box', quantifiable: true, createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
});

describe('category rename cascades into expense items and the catalog', () => {
  it('renameCategory rewrites item category, updates the expense, moves catalog product', () => {
    const product = useVendorProductStore.getState().addProduct({
      name: 'Small Box', category: 'Packaging Materials', subcategory: 'Box', unit: 'box',
    });
    const e = useExpenseStore.getState().addExpense({
      date: '2026-01-01', vendorId: 'v1', vendorName: 'Acme',
      category: 'Packaging Materials', subcategory: 'Box',
      description: '', quantity: 0, unit: '', unitPrice: 0, amount: 0,
      paymentMethod: 'Cash', paid: false, notes: '',
      items: [eItem({ category: 'Packaging Materials', subcategory: 'Box', quantity: 2, unitPrice: 30 })],
    });

    useExpenseCategoryStore.getState().renameCategory('Packaging Materials', 'Packing');

    const updated = useExpenseStore.getState().getExpense(e.id)!;
    expect(updated.items![0].category).toBe('Packing');
    expect(updated.category).toBe('Packing');

    expect(useVendorProductStore.getState().getProduct(product.id)!.category).toBe('Packing');
  });

  it('subcategory rename (updateEntry) rewrites matching item + catalog product', () => {
    const product = useVendorProductStore.getState().addProduct({
      name: 'Small Box', category: 'Packaging Materials', subcategory: 'Box', unit: 'box',
    });
    const e = useExpenseStore.getState().addExpense({
      date: '2026-01-01', vendorId: 'v1', vendorName: 'Acme',
      category: 'Packaging Materials', subcategory: 'Box',
      description: '', quantity: 0, unit: '', unitPrice: 0, amount: 0,
      paymentMethod: 'Cash', paid: false, notes: '',
      items: [eItem({ category: 'Packaging Materials', subcategory: 'Box', quantity: 1, unitPrice: 30 })],
    });

    // Rename the 'Box' subcategory row to 'Carton' (category stays)
    useExpenseCategoryStore.getState().updateEntry('c1', 'Packaging Materials', 'Carton');

    const updated = useExpenseStore.getState().getExpense(e.id)!;
    expect(updated.items![0].subcategory).toBe('Carton');
    expect(updated.category).toBe('Packaging Materials');
    expect(useVendorProductStore.getState().getProduct(product.id)!.subcategory).toBe('Carton');
  });
});

describe('unit rename cascades into expense items and catalog products', () => {
  beforeEach(() => {
    // Ensure the unit exists in the list so rename has something to rename
    useUnitStore.setState({ values: ['box', 'sack'] });
  });

  it('renaming a unit updates item units and product units', () => {
    const product = useVendorProductStore.getState().addProduct({
      name: 'Small Box', category: 'Packaging Materials', subcategory: 'Box', unit: 'box',
    });
    const e = useExpenseStore.getState().addExpense({
      date: '2026-01-01', vendorId: 'v1', vendorName: 'Acme',
      category: 'Packaging Materials', subcategory: 'Box',
      description: '', quantity: 0, unit: '', unitPrice: 0, amount: 0,
      paymentMethod: 'Cash', paid: false, notes: '',
      items: [eItem({ category: 'Packaging Materials', subcategory: 'Box', unit: 'box', quantity: 2, unitPrice: 30 })],
    });

    useUnitStore.getState().rename('box', 'carton');

    expect(useExpenseStore.getState().getExpense(e.id)!.items![0].unit).toBe('carton');
    expect(useVendorProductStore.getState().getProduct(product.id)!.unit).toBe('carton');
  });
});
