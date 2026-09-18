import { describe, it, expect, beforeEach } from 'vitest';
import { useInventoryStore } from './inventoryStore';

/** No duplicate (category, subcategory) rows: addItem merges into an existing row. */
describe('inventory: one row per (category, subcategory)', () => {
  beforeEach(() => {
    useInventoryStore.setState({ items: [], _seeded: 999 });
  });

  const add = (over: Partial<Parameters<ReturnType<typeof useInventoryStore.getState>['addItem']>[0]> = {}) =>
    useInventoryStore.getState().addItem({
      category: 'Fertilizer', subcategory: 'Magnesium', unit: 'sack',
      beginningQty: 0, purchased: 0, used: 0, sold: 0, unitCost: 0, notes: '',
      ...over,
    });

  it('adding the same (category, subcategory) merges instead of creating a duplicate', () => {
    add({ purchased: 5 });
    add({ purchased: 3 });
    const items = useInventoryStore.getState().items.filter((i) => i.subcategory === 'Magnesium');
    expect(items).toHaveLength(1);
    expect(items[0].purchased).toBe(8);
    expect(items[0].endingQty).toBe(8);
  });

  it('merges case-insensitively', () => {
    add({ purchased: 2 });
    add({ category: 'fertilizer', subcategory: 'magnesium', purchased: 4 });
    const items = useInventoryStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].purchased).toBe(6);
  });

  it('backfills unit + cost without clobbering set values', () => {
    add({ unit: '', unitCost: 0, purchased: 1 });
    add({ unit: 'sack', unitCost: 100, purchased: 1 });
    const row = useInventoryStore.getState().findByCategorySub('Fertilizer', 'Magnesium')!;
    expect(row.unit).toBe('sack');
    expect(row.unitCost).toBe(100);
  });
});
