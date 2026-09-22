import { describe, it, expect, beforeEach, vi } from 'vitest';

// The inventory link (called from add/update/delete) surfaces toasts and reads
// other stores. Mock react-hot-toast so tests stay quiet and side-effect free.
vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useExpenseStore } from './expenseStore';
import type { Expense, ExpenseItem } from '../types';

/** Reset expenses before each test (partial setState keeps the actions). */
beforeEach(() => {
  useExpenseStore.setState({ expenses: [] });
});

const store = () => useExpenseStore.getState();

/** Build an ExpenseItem with total auto-computed. Uses non-inventory-linked cats. */
function item(partial: Partial<ExpenseItem>): ExpenseItem {
  const quantity = partial.quantity ?? 1;
  const unitPrice = partial.unitPrice ?? 0;
  return {
    productId: partial.productId ?? '',
    name: partial.name ?? 'Item',
    category: partial.category ?? 'Packaging Materials',
    subcategory: partial.subcategory ?? '',
    quantity,
    unit: partial.unit ?? '',
    unitPrice,
    total: partial.total ?? quantity * unitPrice,
  };
}

/** Minimal single-line (legacy-shaped) expense payload. */
function baseExpense(over: Partial<Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>> = {}) {
  return {
    date: '2026-01-10',
    vendorId: 'v1',
    vendorName: 'Acme',
    category: 'Packaging Materials',
    subcategory: 'Box',
    description: '',
    quantity: 0,
    unit: '',
    unitPrice: 0,
    amount: 0,
    paymentMethod: 'Cash',
    paid: false,
    notes: '',
    ...over,
  };
}

describe('expenseStore multi-item amount', () => {
  it('derives amount from item totals, ignoring a mismatched passed amount', () => {
    const e = store().addExpense(
      baseExpense({
        amount: 999, // wrong on purpose
        items: [
          item({ name: 'Box', category: 'Packaging Materials', subcategory: 'Box', quantity: 3, unitPrice: 30 }),
          item({ name: 'Tape', category: 'Packaging Materials', subcategory: 'Scotch Tape', quantity: 2, unitPrice: 25 }),
        ],
      })
    );
    expect(e.amount).toBe(3 * 30 + 2 * 25); // 140
  });

  it('recomputes amount from items on update', () => {
    const e = store().addExpense(
      baseExpense({ items: [item({ quantity: 1, unitPrice: 100 })] })
    );
    store().updateExpense(e.id, {
      items: [item({ quantity: 2, unitPrice: 100 }), item({ quantity: 1, unitPrice: 50 })],
    });
    expect(store().getExpense(e.id)!.amount).toBe(250);
  });

  it('keeps the passed amount for single-line (no items) expenses', () => {
    const e = store().addExpense(baseExpense({ amount: 500 }));
    expect(e.amount).toBe(500);
  });
});

describe('expenseStore totalByCategory', () => {
  it('splits a multi-item expense across each item category label', () => {
    store().addExpense(
      baseExpense({
        items: [
          item({ category: 'Packaging Materials', subcategory: 'Box', quantity: 3, unitPrice: 30 }),   // 90
          item({ category: 'Marketing Supplies', subcategory: 'Ink', quantity: 1, unitPrice: 60 }),      // 60
        ],
      })
    );
    const totals = store().totalByCategory();
    expect(totals['Packaging Materials – Box']).toBe(90);
    expect(totals['Marketing Supplies – Ink']).toBe(60);
  });

  it('attributes a single-line expense to its combined category label', () => {
    store().addExpense(baseExpense({ amount: 200, category: 'Electricity', subcategory: '' }));
    expect(store().totalByCategory()['Electricity']).toBe(200);
  });

  it('sums amounts across a mix of legacy and multi-item expenses', () => {
    store().addExpense(baseExpense({ amount: 100, category: 'Water', subcategory: '' }));
    store().addExpense(baseExpense({ items: [item({ category: 'Water', subcategory: '', quantity: 1, unitPrice: 40 })] }));
    // Both attribute to 'Water' (multi-item label has no subcategory → just base)
    expect(store().totalByCategory()['Water']).toBe(140);
    expect(store().totalExpenses()).toBe(140);
  });
});

describe('expenseStore bookkeeping breakdowns', () => {
  it('groups spend by accounting classification, pooling missing into Unclassified', () => {
    store().addExpense(baseExpense({ amount: 100, accountingClassification: 'Operating Expense (OpEx)' }));
    store().addExpense(baseExpense({ amount: 250, accountingClassification: 'Operating Expense (OpEx)' }));
    store().addExpense(baseExpense({ amount: 400, accountingClassification: 'Capital Expenditure (CapEx)' }));
    store().addExpense(baseExpense({ amount: 50 })); // no classification
    const totals = store().totalByAccountingClassification();
    expect(totals['Operating Expense (OpEx)']).toBe(350);
    expect(totals['Capital Expenditure (CapEx)']).toBe(400);
    expect(totals['Unclassified']).toBe(50);
  });

  it('groups spend by expense type / cost behavior', () => {
    store().addExpense(baseExpense({ amount: 300, expenseType: 'Fixed' }));
    store().addExpense(baseExpense({ amount: 200, expenseType: 'Variable' }));
    store().addExpense(baseExpense({ amount: 100, expenseType: 'Variable' }));
    const totals = store().totalByExpenseType();
    expect(totals['Fixed']).toBe(300);
    expect(totals['Variable']).toBe(300);
  });

  it('uses the full expense amount (incl. multi-item) for the breakdown', () => {
    store().addExpense(
      baseExpense({
        accountingClassification: 'Cost of Goods Sold (COGS)',
        expenseType: 'Variable',
        items: [
          item({ quantity: 2, unitPrice: 50 }), // 100
          item({ quantity: 1, unitPrice: 25 }), // 25
        ],
      })
    );
    expect(store().totalByAccountingClassification()['Cost of Goods Sold (COGS)']).toBe(125);
    expect(store().totalByExpenseType()['Variable']).toBe(125);
  });
});

describe('expenseStore price observations', () => {
  it('pricedSupplies lists distinct supplies from multi-item + legacy expenses', () => {
    store().addExpense(
      baseExpense({
        items: [
          item({ category: 'Packaging Materials', subcategory: 'Box', quantity: 2, unitPrice: 30 }),
          item({ category: 'Packaging Materials', subcategory: 'Box', quantity: 1, unitPrice: 32 }), // dup supply
        ],
      })
    );
    store().addExpense(
      baseExpense({ quantity: 1, unitPrice: 15, category: 'Marketing Supplies', subcategory: 'Ink' })
    );
    const supplies = store().pricedSupplies();
    const labels = supplies.map((s) => s.label).sort();
    expect(labels).toEqual(['Marketing Supplies – Ink', 'Packaging Materials – Box']);
  });

  it('supplyPriceHistory returns one point per priced item, sorted by date asc', () => {
    store().addExpense(
      baseExpense({
        date: '2026-02-01',
        items: [item({ category: 'Packaging Materials', subcategory: 'Box', quantity: 2, unitPrice: 30 })],
      })
    );
    store().addExpense(
      baseExpense({
        date: '2026-01-01',
        items: [item({ category: 'Packaging Materials', subcategory: 'Box', quantity: 5, unitPrice: 28 })],
      })
    );
    const history = store().supplyPriceHistory('Packaging Materials', 'Box');
    expect(history).toHaveLength(2);
    expect(history[0].date).toBe('2026-01-01'); // sorted ascending
    expect(history[0].unitPrice).toBe(28);
    expect(history[1].unitPrice).toBe(30);
  });

  it('latestUnitPrice prefers the same vendor, else most recent', () => {
    store().addExpense(
      baseExpense({
        date: '2026-01-01',
        vendorId: 'v1',
        items: [item({ category: 'Packaging Materials', subcategory: 'Box', quantity: 1, unitPrice: 30 })],
      })
    );
    store().addExpense(
      baseExpense({
        date: '2026-03-01',
        vendorId: 'v2',
        items: [item({ category: 'Packaging Materials', subcategory: 'Box', quantity: 1, unitPrice: 40 })],
      })
    );
    // Most recent overall is v2 @ 40
    expect(store().latestUnitPrice('Packaging Materials', 'Box')).toBe(40);
    // But prefer v1's own history when v1 is given
    expect(store().latestUnitPrice('Packaging Materials', 'Box', 'v1')).toBe(30);
  });

  it('legacy single-line expense still contributes a price observation', () => {
    store().addExpense(
      baseExpense({ quantity: 4, unitPrice: 12, category: 'Packaging Materials', subcategory: 'Sharpie' })
    );
    expect(store().latestUnitPrice('Packaging Materials', 'Sharpie')).toBe(12);
    expect(store().pricedSupplies().some((s) => s.label === 'Packaging Materials – Sharpie')).toBe(true);
  });

  it('ignores items with no unit price in observations', () => {
    store().addExpense(
      baseExpense({
        items: [
          item({ category: 'Packaging Materials', subcategory: 'Box', quantity: 2, unitPrice: 0 }), // unpriced
        ],
      })
    );
    expect(store().pricedSupplies()).toHaveLength(0);
    expect(store().latestUnitPrice('Packaging Materials', 'Box')).toBeUndefined();
  });
});
