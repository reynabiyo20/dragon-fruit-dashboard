import { describe, it, expect, beforeEach, vi } from 'vitest';

// The harvest→inventory cascade path may surface toasts elsewhere; keep tests quiet.
vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useProductionStore } from './productionStore';
import { useInventoryStore } from './inventoryStore';
import { useCuttingStore } from './cuttingStore';
import { FRUIT_PRODUCT_TYPE, CUTTINGS_PRODUCT_TYPE, CUTTING_SOURCE_INTERNAL } from '../constants';

const prod = () => useProductionStore.getState();
const inv = () => useInventoryStore.getState();
const cut = () => useCuttingStore.getState();

const base = (over = {}) => ({
  date: '2026-06-01',
  farmBlock: '',
  plants: 10,
  fruitsHarvested: 0,
  goodFruits: 0,
  weightKg: 0,
  notes: '',
  ...over,
});

beforeEach(() => {
  useProductionStore.setState({ entries: [] });
  useInventoryStore.setState({ items: [], _seeded: 999 });
  useCuttingStore.setState({ batches: [] });
});

describe('production → inventory (harvest cascade)', () => {
  it('a Fruit harvest credits the Fruit row harvested pool (kg) and endingQty', () => {
    prod().addEntry(base({ harvestKind: 'Fruit', subcategory: 'Thai White', weightKg: 12.5, fruitsHarvested: 30, goodFruits: 28 }));
    const row = inv().findByCategorySub(FRUIT_PRODUCT_TYPE, 'Thai White')!;
    expect(row).toBeTruthy();
    expect(row.harvested).toBe(12.5);
    expect(row.endingQty).toBe(12.5);
  });

  it('a Cuttings harvest creates an internal batch (owns the lifecycle) and does NOT credit sellable inventory pools', () => {
    prod().addEntry(base({ harvestKind: 'Cuttings', subcategory: 'Thai White', goodFruits: 40, fruitsHarvested: 45 }));
    // A linked internal batch is created, sized to the good cutting count.
    const batch = cut().batches.find((b) => b.subcategory === 'Thai White');
    expect(batch).toBeTruthy();
    expect(batch!.source).toBe(CUTTING_SOURCE_INTERNAL);
    expect(batch!.quantitySourced).toBe(40);
    expect(batch!.quantityAvailable).toBe(40);
    // The batch ensures the inventory row exists, but sellable pools stay at zero —
    // the batch lifecycle (pack / reserve / plant) owns them, so no double-count.
    const row = inv().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Thai White')!;
    expect(row.packed ?? 0).toBe(0);
    expect(row.availableForSale ?? 0).toBe(0);
    expect(row.needsPacking ?? 0).toBe(0);
    expect(row.breedingStock ?? 0).toBe(0);
  });

  it('editing a Cuttings harvest keeps its linked batch in sync (quantity + variety)', () => {
    const e = prod().addEntry(base({ harvestKind: 'Cuttings', subcategory: 'Thai Red', goodFruits: 15, fruitsHarvested: 15 }));
    prod().updateEntry(e.id, { goodFruits: 22, subcategory: 'Thai White' });
    const batches = cut().batches.filter((b) => b.productionEntryId === e.id);
    expect(batches).toHaveLength(1); // still one batch, not duplicated
    expect(batches[0].subcategory).toBe('Thai White');
    expect(batches[0].quantitySourced).toBe(22);
  });

  it('flipping a Cuttings harvest to Fruit removes its linked batch', () => {
    const e = prod().addEntry(base({ harvestKind: 'Cuttings', subcategory: 'Thai Red', goodFruits: 15, fruitsHarvested: 15 }));
    expect(cut().batches).toHaveLength(1);
    prod().updateEntry(e.id, { harvestKind: 'Fruit', weightKg: 5 });
    expect(cut().batches.filter((b) => b.productionEntryId === e.id)).toHaveLength(0);
  });

  it('deleting a Cuttings harvest removes its linked internal batch', () => {
    const e = prod().addEntry(base({ harvestKind: 'Cuttings', subcategory: 'Thai Red', goodFruits: 15, fruitsHarvested: 15 }));
    expect(cut().batches).toHaveLength(1);
    prod().deleteEntry(e.id);
    expect(cut().batches).toHaveLength(0);
  });

  it('does NOT credit inventory when the entry has no variety', () => {
    prod().addEntry(base({ harvestKind: 'Fruit', weightKg: 10 }));
    expect(inv().items).toHaveLength(0);
  });

  it('editing the weight reconciles the harvested pool (reverse old, apply new)', () => {
    const e = prod().addEntry(base({ harvestKind: 'Fruit', subcategory: 'Thai White', weightKg: 10 }));
    prod().updateEntry(e.id, { weightKg: 25 });
    const row = inv().findByCategorySub(FRUIT_PRODUCT_TYPE, 'Thai White')!;
    expect(row.harvested).toBe(25);
  });

  it('a notes-only edit leaves the harvested pool unchanged', () => {
    const e = prod().addEntry(base({ harvestKind: 'Fruit', subcategory: 'Thai White', weightKg: 10 }));
    prod().updateEntry(e.id, { notes: 'sunny day' });
    const row = inv().findByCategorySub(FRUIT_PRODUCT_TYPE, 'Thai White')!;
    expect(row.harvested).toBe(10);
  });

  it('deleting a harvest reverses its inventory credit', () => {
    const e = prod().addEntry(base({ harvestKind: 'Fruit', subcategory: 'Thai White', weightKg: 10 }));
    prod().deleteEntry(e.id);
    const row = inv().findByCategorySub(FRUIT_PRODUCT_TYPE, 'Thai White')!;
    expect(row.harvested).toBe(0);
    expect(row.endingQty).toBe(0);
  });
});
