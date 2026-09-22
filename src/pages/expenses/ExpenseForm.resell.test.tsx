import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { ExpenseForm } from './ExpenseForm';
import { useExpenseStore } from '../../store/expenseStore';
import { useVendorStore } from '../../store/vendorStore';
import { useProductStore } from '../../store/productStore';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import { useUnitStore } from '../../store/optionStores';
import type { Expense } from '../../types';

/**
 * Rule: every purchase feeds Inventory, but only purchases flagged "We resell
 * this" cascade into the sellable Products list. This exercises the single-expense
 * (quantifiable) path via an edit submit (a saved expense already has a vendor,
 * so the form is valid on save).
 */
beforeEach(() => {
  useVendorStore.setState({
    vendors: [
      { id: 'v1', vendor: 'Acme', contact: '', phone: '', location: { province: '', municipality: '' }, supplies: [{ category: 'Fertilizer', subcategory: 'Magnesium' }], notes: '', createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
  useExpenseCategoryStore.setState({
    entries: [
      { id: 'c1', category: 'Fertilizer', subcategory: 'Magnesium', quantifiable: true, createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
  useUnitStore.setState({ values: ['sack', 'kg'] });
  useExpenseStore.setState({ expenses: [] });
  useProductStore.setState({ products: [], _seeded: 999 });
});

function savedExpense(): Expense {
  return {
    id: 'e1', date: '2020-01-15', vendorId: 'v1', vendorName: 'Acme',
    category: 'Fertilizer', subcategory: 'Magnesium', description: '',
    quantity: 5, unit: 'sack', unitPrice: 100, amount: 500,
    paymentMethod: 'Cash', paid: true, notes: '', createdAt: '', updatedAt: '',
  };
}

describe('ExpenseForm resell cascade (single quantifiable expense)', () => {
  it('cascades to Products when "We resell this" is checked', async () => {
    // Seed the expense so updateExpense (edit) path runs on submit.
    useExpenseStore.setState({ expenses: [savedExpense()] });
    const onClose = vi.fn();
    render(<ExpenseForm expense={savedExpense()} onClose={onClose} />);

    const checkbox = screen.getByLabelText(/We resell this/i) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    // RHF validation resolves asynchronously; wait for the submit to complete.
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const p = useProductStore.getState().findByCategorySub('Fertilizer', 'Magnesium');
    expect(p).toBeDefined();
    expect(p?.unit).toBe('sack');
    expect(p?.costPHP).toBe(100);
    expect(p?.sellingPricePHP).toBe(0);
  });

  it('does NOT cascade a non-resell category when "We resell this" is left off', async () => {
    // Construction Material is a consumable — opt-in only, not auto-cascaded.
    useVendorStore.setState({
      vendors: [
        { id: 'v1', vendor: 'Acme', contact: '', phone: '', location: { province: '', municipality: '' }, supplies: [{ category: 'Construction Material', subcategory: 'Cement' }], notes: '', createdAt: '', updatedAt: '' },
      ],
      _seeded: 999,
    });
    useExpenseCategoryStore.setState({
      entries: [
        { id: 'c2', category: 'Construction Material', subcategory: 'Cement', quantifiable: true, createdAt: '', updatedAt: '' },
      ],
      _seeded: 999,
    });
    useUnitStore.setState({ values: ['sack', 'bag'] });
    const consumable: Expense = {
      id: 'e2', date: '2020-01-15', vendorId: 'v1', vendorName: 'Acme',
      category: 'Construction Material', subcategory: 'Cement', description: '',
      quantity: 5, unit: 'bag', unitPrice: 250, amount: 1250,
      paymentMethod: 'Cash', paid: true, notes: '', createdAt: '', updatedAt: '',
    };
    useExpenseStore.setState({ expenses: [consumable] });
    const onClose = vi.fn();
    render(<ExpenseForm expense={consumable} onClose={onClose} />);

    // Leave the checkbox off; just save.
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(useProductStore.getState().findByCategorySub('Construction Material', 'Cement')).toBeUndefined();
  });

  it('ALWAYS cascades Fertilizer (a resellable category) even when the checkbox is off', async () => {
    useExpenseStore.setState({ expenses: [savedExpense()] });
    const onClose = vi.fn();
    render(<ExpenseForm expense={savedExpense()} onClose={onClose} />);

    // Do NOT check "We resell this" — Fertilizer cascades automatically.
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const p = useProductStore.getState().findByCategorySub('Fertilizer', 'Magnesium');
    expect(p).toBeDefined();
    expect(p?.costPHP).toBe(100);
  });
});
