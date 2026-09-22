import { describe, it, expect } from 'vitest';
import { useInventoryStore } from './inventoryStore';
import { generateId, now } from '../utils/id';
import { CUTTINGS_PRODUCT_TYPE } from '../constants';
import type { InventoryItem } from '../types';

/**
 * Cuttings usage model (adjustUsedCuttings):
 *   endingQty = packed + needsPacking
 * Recording usage consumes physical stock from the pools — Needs Packing first,
 * then Packed (+ availableForSale) for any overflow — while incrementing the
 * lifetime `used` counter. The mutator returns how much spilled into Packed so
 * the UI can warn the user.
 */
describe('cuttings usage: draws needsPacking first, then packed', () => {
  function seedRow(over: Partial<InventoryItem> = {}): string {
    const id = generateId();
    useInventoryStore.setState({
      items: [
        {
          id,
          category: CUTTINGS_PRODUCT_TYPE,
          subcategory: 'Thai White',
          unit: 'piece',
          beginningQty: 0,
          purchased: 0,
          used: 0,
          sold: 0,
          endingQty: 0,
          unitCost: 0,
          packed: 0,
          needsPacking: 0,
          breedingStock: 0,
          availableForSale: 0,
          produced: 0,
          harvested: 0,
          notes: '',
          createdAt: now(),
          updatedAt: now(),
          ...over,
        },
      ],
      _seeded: 999,
    });
    // Recompute endingQty off the seeded pools via a no-op update.
    useInventoryStore.getState().updateItem(id, {});
    return id;
  }

  const row = (id: string) => useInventoryStore.getState().getItem(id)!;

  it('endingQty for a cuttings row is packed + needsPacking', () => {
    const id = seedRow({ packed: 8, availableForSale: 8, needsPacking: 5 });
    expect(row(id).endingQty).toBe(13);
  });

  it('usage within needsPacking only draws from needsPacking', () => {
    const id = seedRow({ packed: 8, availableForSale: 8, needsPacking: 5 });
    const fromPacked = useInventoryStore.getState().adjustUsedCuttings(id, 3);
    const r = row(id);
    expect(fromPacked).toBe(0);          // nothing spilled into packed
    expect(r.needsPacking).toBe(2);      // 5 − 3
    expect(r.packed).toBe(8);            // untouched
    expect(r.availableForSale).toBe(8);  // untouched
    expect(r.used).toBe(3);              // lifetime counter
    expect(r.endingQty).toBe(10);        // 8 + 2
  });

  it('usage beyond needsPacking spills into packed + availableForSale', () => {
    const id = seedRow({ packed: 8, availableForSale: 8, needsPacking: 5 });
    const fromPacked = useInventoryStore.getState().adjustUsedCuttings(id, 7);
    const r = row(id);
    expect(fromPacked).toBe(2);          // 7 − 5 needsPacking = 2 from packed
    expect(r.needsPacking).toBe(0);      // fully drained
    expect(r.packed).toBe(6);            // 8 − 2
    expect(r.availableForSale).toBe(6);  // kept in step
    expect(r.used).toBe(7);
    expect(r.endingQty).toBe(6);         // 6 + 0
  });

  it('usage is clamped to what is on hand (needsPacking + packed)', () => {
    const id = seedRow({ packed: 4, availableForSale: 4, needsPacking: 2 });
    const fromPacked = useInventoryStore.getState().adjustUsedCuttings(id, 99);
    const r = row(id);
    expect(fromPacked).toBe(4);          // all packed consumed
    expect(r.needsPacking).toBe(0);
    expect(r.packed).toBe(0);
    expect(r.availableForSale).toBe(0);
    expect(r.used).toBe(6);              // only the 6 on hand were used
    expect(r.endingQty).toBe(0);
  });
});
