import { describe, it, expect, beforeEach, vi } from 'vitest';

// Cross-store writes may surface toasts (via inventoryLink); keep tests quiet.
vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useProductStore } from './productStore';
import { useInventoryStore } from './inventoryStore';
import { useVendorProductStore } from './vendorProductStore';
import { useExpenseStore } from './expenseStore';

const products = () => useProductStore.getState();
const inv = () => useInventoryStore.getState();
const vp = () => useVendorProductStore.getState();
const exp = () => useExpenseStore.getState();

beforeEach(() => {
  useProductStore.setState({ products: [], _seeded: 999 });
  useInventoryStore.setState({ items: [], _seeded: 999 });
  useVendorProductStore.setState({ products: [], prices: [] });
  useExpenseStore.setState({ expenses: [] });
});

describe('product unit cascade (updateProduct)', () => {
  it('cascades a changed unit to the matching inventory + vendor-product + expense rows', () => {
    // A product plus matching rows in the other stores (all category=Fruit, sub=Thai White).
    const product = products().addProduct({
      category: 'Fruit', subcategory: 'Thai White', costPHP: 0, sellingPricePHP: 0, costUSD: 0, sellingPriceUSD: 0, unit: 'Kg', notes: '',
    });
    const invRow = inv().ensureRow('Fruit', 'Thai White', 'Kg');
    const vProd = vp().addProduct({ name: 'Thai White', category: 'Fruit', subcategory: 'Thai White', unit: 'Kg' });
    const e = exp().addExpense({
      date: '2026-01-01', vendorId: '', vendorName: '', category: 'Fruit', subcategory: 'Thai White',
      description: '', quantity: 3, unit: 'Kg', unitPrice: 100, amount: 300, paymentMethod: 'Cash', paid: false, notes: '',
    });

    // Change the product's unit → cascades everywhere for that (category, sub).
    products().updateProduct(product.id, { unit: 'crate' });

    expect(inv().getItem(invRow.id)!.unit).toBe('crate');
    expect(vp().getProduct(vProd.id)!.unit).toBe('crate');
    expect(exp().getExpense(e.id)!.unit).toBe('crate');
  });

  it('cascades to per-item expense units, leaving other-variety lines untouched', () => {
    const product = products().addProduct({
      category: 'Fruit', subcategory: 'Thai White', costPHP: 0, sellingPricePHP: 0, costUSD: 0, sellingPriceUSD: 0, unit: 'Kg', notes: '',
    });
    const e = exp().addExpense({
      date: '2026-01-01', vendorId: 'v1', vendorName: 'Acme', category: 'Fruit', subcategory: 'Thai White',
      description: '', quantity: 0, unit: '', unitPrice: 0, amount: 0, paymentMethod: 'Cash', paid: false, notes: '',
      items: [
        { productId: '', name: 'Thai White', category: 'Fruit', subcategory: 'Thai White', quantity: 2, unit: 'Kg', unitPrice: 100, total: 200 },
        { productId: '', name: 'Moroccan Red', category: 'Fruit', subcategory: 'Moroccan Red', quantity: 1, unit: 'Kg', unitPrice: 90, total: 90 },
      ],
    });

    products().updateProduct(product.id, { unit: 'box' });

    const saved = exp().getExpense(e.id)!;
    expect(saved.items!.find((i) => i.subcategory === 'Thai White')!.unit).toBe('box');
    // The other variety's line is unchanged.
    expect(saved.items!.find((i) => i.subcategory === 'Moroccan Red')!.unit).toBe('Kg');
  });

  it('does not cascade when the unit is unchanged (only cost edited)', () => {
    const product = products().addProduct({
      category: 'Fruit', subcategory: 'Thai White', costPHP: 0, sellingPricePHP: 0, costUSD: 0, sellingPriceUSD: 0, unit: 'Kg', notes: '',
    });
    const invRow = inv().ensureRow('Fruit', 'Thai White', 'sack'); // deliberately different
    products().updateProduct(product.id, { costPHP: 250 });
    // Unit wasn't touched → inventory row keeps its own unit.
    expect(inv().getItem(invRow.id)!.unit).toBe('sack');
  });
});
