import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { InventoryForm } from './InventoryForm';
import { useInventoryStore } from '../../store/inventoryStore';
import { useProductStore } from '../../store/productStore';
import { useInventoryCategoryStore, useUnitStore } from '../../store/optionStores';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import type { InventoryItem } from '../../types';
import { generateId, now } from '../../utils/id';

/**
 * Rule: the inventory item form asks "Do you sell this?". When checked, the item
 * is mirrored into Products for sale, seeding the cost from its unit cost and
 * leaving the selling price for the user. Unchecking on edit removes the
 * auto-created product if it's safe. Inventory is never touched by that toggle.
 *
 * We drive this through EDIT mode: a saved item already has its identity fields
 * populated, so the form validates on Save without needing to script the custom
 * category/variety CreatableSelects.
 */
function savedItem(category: string, subcategory: string, unitCost: number): InventoryItem {
  return {
    id: generateId(),
    category,
    subcategory,
    unit: 'piece',
    beginningQty: 0,
    purchased: 0,
    used: 0,
    sold: 0,
    endingQty: 0,
    unitCost,
    packed: 0,
    breedingStock: 0,
    availableForSale: 0,
    notes: '',
    createdAt: now(),
    updatedAt: now(),
  };
}

beforeEach(() => {
  useInventoryStore.setState({ items: [], _seeded: 999 });
  useProductStore.setState({ products: [], _seeded: 999 });
  useInventoryCategoryStore.setState({ values: ['Packing Material', 'Tools', 'Other'] });
  useUnitStore.setState({ values: ['piece', 'kg'] });
  useProductCategoryStore.setState({ entries: [], _seeded: 999 });
  useExpenseCategoryStore.setState({ entries: [], _seeded: 999 });
});

describe('InventoryForm "Do you sell this?" product cascade', () => {
  it('creates a sellable Product when checked (Other → Jacket)', async () => {
    const item = savedItem('Other', 'Jacket', 200);
    useInventoryStore.setState({ items: [item], _seeded: 999 });
    const onClose = vi.fn();
    render(<InventoryForm item={item} onClose={onClose} />);

    const checkbox = screen.getByLabelText(/Do you sell this\?/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(false); // no product yet, not an always-sell category
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const p = useProductStore.getState().findByCategorySub('Other', 'Jacket');
    expect(p).toBeDefined();
    expect(p?.unit).toBe('piece');
    expect(p?.costPHP).toBe(200);
    expect(p?.sellingPricePHP).toBe(0);
  });

  it('does NOT create a Product when left unchecked (Other → Gloves)', async () => {
    const item = savedItem('Other', 'Gloves', 50);
    useInventoryStore.setState({ items: [item], _seeded: 999 });
    const onClose = vi.fn();
    render(<InventoryForm item={item} onClose={onClose} />);

    // Leave the checkbox off; just save.
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(useProductStore.getState().findByCategorySub('Other', 'Gloves')).toBeUndefined();
  });

  it('defaults the checkbox ON when editing an always-sell category (Cuttings)', () => {
    const item = savedItem('Cuttings', 'Thai White', 10);
    useInventoryStore.setState({ items: [item], _seeded: 999 });
    render(<InventoryForm item={item} onClose={vi.fn()} />);

    const checkbox = screen.getByLabelText(/Do you sell this\?/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('removes the auto-created Product when unchecked on edit (safe: no price, no sales)', async () => {
    // Pre-create the sellable product (as if it was made earlier).
    useProductStore.getState().addProduct({
      category: 'Other', subcategory: 'Jacket',
      costPHP: 200, sellingPricePHP: 0, costUSD: 0, sellingPriceUSD: 0,
      unit: 'piece', notes: '',
    });
    const item = savedItem('Other', 'Jacket', 200);
    useInventoryStore.setState({ items: [item], _seeded: 999 });
    const onClose = vi.fn();
    render(<InventoryForm item={item} onClose={onClose} />);

    const checkbox = screen.getByLabelText(/Do you sell this\?/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true); // defaulted on because a product exists
    fireEvent.click(checkbox);           // uncheck it
    expect(checkbox.checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(useProductStore.getState().findByCategorySub('Other', 'Jacket')).toBeUndefined();
    // Inventory row is untouched by the un-sell.
    expect(useInventoryStore.getState().findByCategorySub('Other', 'Jacket')).toBeDefined();
  });
});
