import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { InventoryForm } from './InventoryForm';
import { useInventoryStore } from '../../store/inventoryStore';
import { useProductStore } from '../../store/productStore';
import { useSaleStore } from '../../store/saleStore';
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
  useSaleStore.setState({ sales: [] });
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

  it('removes the Product when unchecked & confirmed on edit, even with a selling price set', async () => {
    // Pre-create the sellable product WITH a selling price — the common real case
    // the confirm+force-remove flow must handle (previously this was kept).
    useProductStore.getState().addProduct({
      category: 'Other', subcategory: 'Jacket',
      costPHP: 200, sellingPricePHP: 350, costUSD: 0, sellingPriceUSD: 0,
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

    // Un-selling an existing (safe-to-remove) product pauses for confirmation
    // before it's dropped from Products. Confirm it.
    const confirmBtn = await screen.findByRole('button', { name: /remove from products/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(useProductStore.getState().findByCategorySub('Other', 'Jacket')).toBeUndefined();
    // Inventory row is untouched by the un-sell.
    expect(useInventoryStore.getState().findByCategorySub('Other', 'Jacket')).toBeDefined();
  });

  it('keeps the Product when the un-sell confirmation is cancelled', async () => {
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
    fireEvent.click(checkbox); // uncheck
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    // Wait for the confirmation dialog, then cancel it — the product must remain
    // and the form stays open. (The dialog closes but doesn't remove anything.)
    await screen.findByText(/stop selling this item\?/i);
    const removeBtn = screen.getByRole('button', { name: /remove from products/i });
    // The dialog's Cancel is the sibling of the confirm button.
    const cancelBtn = removeBtn.parentElement!.querySelector('button')!;
    fireEvent.click(cancelBtn);

    expect(useProductStore.getState().findByCategorySub('Other', 'Jacket')).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a Product referenced by a sale (no prompt, saved directly)', async () => {
    const product = useProductStore.getState().addProduct({
      category: 'Other', subcategory: 'Jacket',
      costPHP: 200, sellingPricePHP: 350, costUSD: 0, sellingPriceUSD: 0,
      unit: 'piece', notes: '',
    });
    // A recorded sale references the product — it must never be deleted.
    useSaleStore.setState({
      sales: [{ id: 's1', items: [{ productId: product.id }] }] as never,
    });
    const item = savedItem('Other', 'Jacket', 200);
    useInventoryStore.setState({ items: [item], _seeded: 999 });
    const onClose = vi.fn();
    render(<InventoryForm item={item} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText(/Do you sell this\?/i)); // uncheck
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    // No confirmation dialog appears; the save goes straight through and the
    // product stays (it has sales history).
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/stop selling this item\?/i)).toBeNull();
    expect(useProductStore.getState().findByCategorySub('Other', 'Jacket')).toBeDefined();
  });

  it('honors unchecking on an always-sell category (Cuttings) — prompts & removes', async () => {
    // Cuttings is an "always-sell" category (checkbox defaults on). Unchecking it
    // must still be honored: confirm, then remove from Products.
    useProductStore.getState().addProduct({
      category: 'Cuttings', subcategory: 'Thai White',
      costPHP: 35, sellingPricePHP: 300, costUSD: 0, sellingPriceUSD: 0,
      unit: 'piece', notes: '',
    });
    const item = savedItem('Cuttings', 'Thai White', 35);
    useInventoryStore.setState({ items: [item], _seeded: 999 });
    const onClose = vi.fn();
    render(<InventoryForm item={item} onClose={onClose} />);

    const checkbox = screen.getByLabelText(/Do you sell this\?/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true); // always-sell → defaults on
    fireEvent.click(checkbox);           // uncheck
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    const confirmBtn = await screen.findByRole('button', { name: /remove from products/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(useProductStore.getState().findByCategorySub('Cuttings', 'Thai White')).toBeUndefined();
    // Inventory row stays.
    expect(useInventoryStore.getState().findByCategorySub('Cuttings', 'Thai White')).toBeDefined();
  });
});

describe('InventoryForm Cuttings packed vs needs-packing split (edit)', () => {
  /** A Cuttings row with a live pool split: 10 bare, 5 packed (all unsold). */
  function cuttingRow() {
    return {
      id: generateId(),
      category: 'Cuttings',
      subcategory: 'Thai White',
      unit: 'piece',
      beginningQty: 0,
      purchased: 0,
      used: 0,
      sold: 0,
      endingQty: 15,
      unitCost: 35,
      packed: 5,
      needsPacking: 10,
      breedingStock: 0,
      availableForSale: 5,
      notes: '',
      createdAt: now(),
      updatedAt: now(),
    };
  }

  it('packs more bare stock when Ready-for-Sale is increased', async () => {
    const item = cuttingRow();
    useInventoryStore.setState({ items: [item], _seeded: 999 });
    // Product exists so the "sell" checkbox stays on (no unlink prompt).
    useProductStore.getState().addProduct({
      category: 'Cuttings', subcategory: 'Thai White',
      costPHP: 35, sellingPricePHP: 300, costUSD: 0, sellingPriceUSD: 0,
      unit: 'piece', notes: '',
    });
    render(<InventoryForm item={item} onClose={vi.fn()} />);

    // Movable = needsPacking(10) + availableForSale(5) = 15; currently 5 ready.
    // InputField doesn't associate label/input, so locate via the label text.
    const label = screen.getByText(/Packed \(of on-hand cuttings\)/i);
    const input = label.parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12' } }); // +7 → pack 7 more

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      const r = useInventoryStore.getState().findByCategorySub('Cuttings', 'Thai White')!;
      expect(r.availableForSale).toBe(12);
      expect(r.packed).toBe(12);
      expect(r.needsPacking).toBe(3);
      expect(r.endingQty).toBe(15); // unchanged
    });
  });

  it('splits a Cuttings row whose stock is only in beginningQty (empty pools)', async () => {
    // A seeded/legacy row: 20 on hand as beginningQty, no packed/needsPacking yet.
    const item = {
      ...cuttingRow(),
      beginningQty: 20,
      packed: 0,
      needsPacking: 0,
      availableForSale: 0,
      endingQty: 20,
    };
    useInventoryStore.setState({ items: [item], _seeded: 999 });
    useProductStore.getState().addProduct({
      category: 'Cuttings', subcategory: 'Thai White',
      costPHP: 35, sellingPricePHP: 300, costUSD: 0, sellingPriceUSD: 0,
      unit: 'piece', notes: '',
    });
    render(<InventoryForm item={item} onClose={vi.fn()} />);

    // Field is visible (movable = 20) even though the pools are empty.
    const label = screen.getByText(/Packed \(of on-hand cuttings\)/i);
    const input = label.parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '8' } }); // 8 ready, 12 need packing

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      const r = useInventoryStore.getState().findByCategorySub('Cuttings', 'Thai White')!;
      expect(r.beginningQty).toBe(0);       // folded into the pools
      expect(r.availableForSale).toBe(8);
      expect(r.packed).toBe(8);
      expect(r.needsPacking).toBe(12);
      expect(r.endingQty).toBe(20);         // unchanged
    });
  });

  it('moves packed stock back to needs-packing when Ready-for-Sale is decreased', async () => {
    const item = cuttingRow();
    useInventoryStore.setState({ items: [item], _seeded: 999 });
    useProductStore.getState().addProduct({
      category: 'Cuttings', subcategory: 'Thai White',
      costPHP: 35, sellingPricePHP: 300, costUSD: 0, sellingPriceUSD: 0,
      unit: 'piece', notes: '',
    });
    render(<InventoryForm item={item} onClose={vi.fn()} />);

    const label = screen.getByText(/Packed \(of on-hand cuttings\)/i);
    const input = label.parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2' } }); // -3 → unpack 3

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      const r = useInventoryStore.getState().findByCategorySub('Cuttings', 'Thai White')!;
      expect(r.availableForSale).toBe(2);
      expect(r.packed).toBe(2);
      expect(r.needsPacking).toBe(13);
      expect(r.endingQty).toBe(15); // unchanged
    });
  });
});
