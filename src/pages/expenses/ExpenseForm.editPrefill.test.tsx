import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { ExpenseForm } from './ExpenseForm';
import { useExpenseStore } from '../../store/expenseStore';
import { useVendorStore } from '../../store/vendorStore';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import { useUnitStore } from '../../store/optionStores';
import type { Expense } from '../../types';

/**
 * Bug B: editing a saved expense must show the previously-entered data, not the
 * empty/default view. The category-change reset effect must NOT wipe the restored
 * subcategory / vendor / qty / price — including when React StrictMode invokes
 * effects twice on mount (as it does in the real app, which renders in StrictMode).
 */
beforeEach(() => {
  useVendorStore.setState({
    vendors: [
      { id: 'v1', vendor: 'Acme', contact: '', phone: '', location: { province: '', municipality: '' }, supplies: [{ category: 'Fertilizer', subcategory: 'Nitrogen' }], notes: '', createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
  useExpenseCategoryStore.setState({
    entries: [
      { id: 'c1', category: 'Fertilizer', subcategory: 'Nitrogen', quantifiable: true, createdAt: '', updatedAt: '' },
      { id: 'c2', category: 'Fertilizer', subcategory: 'Potassium', quantifiable: true, createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
  useUnitStore.setState({ values: ['sack', 'kg'] });
  useExpenseStore.setState({ expenses: [] });
});

const savedExpense: Expense = {
  id: 'e1',
  date: '2026-01-15',
  vendorId: 'v1',
  vendorName: 'Acme',
  category: 'Fertilizer',
  subcategory: 'Nitrogen',
  description: 'Bought fertilizer',
  quantity: 5,
  unit: 'sack',
  unitPrice: 100,
  amount: 500,
  paymentMethod: 'Cash',
  paid: true,
  notes: 'urgent',
  createdAt: '',
  updatedAt: '',
};

describe('ExpenseForm edit prefill (Bug B)', () => {
  it('retains vendor, subcategory, quantity and unit price when editing under StrictMode', () => {
    const { container } = render(
      <StrictMode>
        <ExpenseForm expense={savedExpense} onClose={() => {}} />
      </StrictMode>
    );

    // RHF-registered fields are queryable by their `name` attribute.
    const byName = <T extends Element>(name: string) =>
      container.querySelector(`[name="${name}"]`) as T | null;

    // Category keeps the saved category. Rendered via CreatableSelect (a <select>
    // without a name attr), so locate it by the select carrying a 'Fertilizer' option.
    const catSelect = Array.from(container.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'Fertilizer')
    ) as HTMLSelectElement | undefined;
    expect(catSelect?.value).toBe('Fertilizer');

    // Subcategory keeps 'Nitrogen' (would be '' if the reset effect wiped it).
    // Rendered via CreatableSelect (a <select> without a name attr), so locate it
    // by the select that carries a 'Nitrogen' option.
    const subSelect = Array.from(container.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'Nitrogen')
    ) as HTMLSelectElement | undefined;
    expect(subSelect?.value).toBe('Nitrogen');

    // Vendor dropdown keeps the saved vendor selected (the reset effect would
    // clear vendorId → the select would fall back to the empty "Select vendor…").
    const vendorSelect = Array.from(container.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.textContent?.includes('Acme'))
    ) as HTMLSelectElement | undefined;
    expect(vendorSelect?.value).toBe('v1');

    // Quantity and unit price retained
    expect(Number((byName<HTMLInputElement>('quantity'))?.value)).toBe(5);
    expect(Number((byName<HTMLInputElement>('unitPrice'))?.value)).toBe(100);
  });
});
