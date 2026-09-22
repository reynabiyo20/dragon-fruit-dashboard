import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { ExpenseForm } from './ExpenseForm';
import { useExpenseStore } from '../../store/expenseStore';
import { useVendorStore } from '../../store/vendorStore';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import { useUnitStore } from '../../store/optionStores';
import { useInventoryStore } from '../../store/inventoryStore';
import { generateId, now } from '../../utils/id';
import type { Expense, InventoryItem } from '../../types';

function invRow(category: string, subcategory: string): InventoryItem {
  return {
    id: generateId(), category, subcategory, unit: 'sack',
    beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 0,
    unitCost: 0, packed: 0, breedingStock: 0, availableForSale: 0,
    notes: '', createdAt: now(), updatedAt: now(),
  };
}

beforeEach(() => {
  useVendorStore.setState({
    vendors: [
      { id: 'v1', vendor: 'Acme', contact: '', phone: '', location: { province: '', municipality: '' }, supplies: [{ category: 'Fertilizer', subcategory: 'Magnesium' }], notes: '', createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
  // Category flagged NON-quantifiable on purpose — the fix should still capture
  // qty for a subcategorized product and cascade to inventory.
  useExpenseCategoryStore.setState({
    entries: [
      { id: 'c1', category: 'Fertilizer', subcategory: 'Magnesium', quantifiable: false, createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
  useUnitStore.setState({ values: ['sack', 'kg'] });
  useExpenseStore.setState({ expenses: [] });
  // Seed the inventory row as if the original purchase already recorded its +7
  // (which addExpense would have done). Editing reverses then re-applies.
  useInventoryStore.setState({
    items: [{ ...invRow('Fertilizer', 'Magnesium'), purchased: 7, endingQty: 7 }],
    _seeded: 999,
  });
});

const savedExpense: Expense = {
  id: 'e1', date: '2026-01-15', vendorId: 'v1', vendorName: 'Acme',
  category: 'Fertilizer', subcategory: 'Magnesium', description: '',
  quantity: 7, unit: 'sack', unitPrice: 100, amount: 700,
  paymentMethod: 'Cash', paid: true, notes: '', createdAt: '', updatedAt: '',
};

describe('ExpenseForm → inventory cascade (subcategorized product)', () => {
  it('editing/saving a subcategorized product purchase accounts for it in inventory', async () => {
    useExpenseStore.setState({ expenses: [savedExpense] });
    const onClose = vi.fn();
    render(<ExpenseForm expense={savedExpense} onClose={onClose} />);

    // Save the (edited) expense — the quantity fields show because a subcategory
    // is selected, even though the category is non-quantifiable.
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // The purchase is accounted for in inventory (edit reverses old then re-applies).
    const row = useInventoryStore.getState().findByCategorySub('Fertilizer', 'Magnesium');
    expect(row?.purchased).toBe(7);
    expect(row?.endingQty).toBe(7);
  });
});
