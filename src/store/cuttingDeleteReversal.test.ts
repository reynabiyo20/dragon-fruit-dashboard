import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useCuttingStore } from './cuttingStore';
import { useInventoryStore } from './inventoryStore';
import { generateId, now } from '../utils/id';
import {
  CUTTINGS_PRODUCT_TYPE, CUTTING_ALLOCATION_DELIVERY, CUTTING_ALLOCATION_REPLANT,
} from '../constants';

/**
 * Deleting a cutting batch must reverse whatever inventory pools it credited,
 * mirroring the reversals in allocateBatch / unmarkPacked / unmarkPlanted. This
 * guards against orphaned stock left in Inventory after a batch is deleted.
 */
describe('deleteBatch reverses the batch inventory footprint', () => {
  beforeEach(() => {
    useCuttingStore.setState({ batches: [] });
    useInventoryStore.setState({
      items: [
        {
          id: generateId(), category: CUTTINGS_PRODUCT_TYPE, subcategory: 'American Beauty',
          unit: 'piece', beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 0,
          unitCost: 0, packed: 0, needsPacking: 0, breedingStock: 0, availableForSale: 0,
          produced: 0, harvested: 0, notes: '', createdAt: now(), updatedAt: now(),
        },
      ],
      _seeded: 999,
    });
  });

  const row = () => useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'American Beauty')!;

  function addRootedBatch(qty: number) {
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return useCuttingStore.getState().addBatch({
      subcategory: 'American Beauty', cuttingType: 'Grafted with Roots',
      harvestDate: longAgo, dateSourced: longAgo, dateGrafted: '',
      quantitySourced: qty, sourceCostPerCutting: 0, graftCostPerCutting: 0,
      rootWeeks: 3, notes: '',
    });
  }

  it('deleting a PACKED batch clears packed + availableForSale', () => {
    const b = addRootedBatch(100);
    useCuttingStore.getState().markPacked(b.id);
    expect(row().availableForSale).toBe(100);

    useCuttingStore.getState().deleteBatch(b.id);
    const r = row();
    expect(r.packed).toBe(0);
    expect(r.availableForSale).toBe(0);
    expect(r.endingQty).toBe(0);
  });

  it('deleting a QUEUED-for-delivery batch clears needsPacking', () => {
    const b = addRootedBatch(100);
    useCuttingStore.getState().allocateBatch(b.id, CUTTING_ALLOCATION_DELIVERY);
    expect(row().needsPacking).toBe(100);

    useCuttingStore.getState().deleteBatch(b.id);
    const r = row();
    expect(r.needsPacking).toBe(0);
    expect(r.endingQty).toBe(0);
  });

  it('deleting a RESERVED-for-replant batch clears breedingStock', () => {
    const b = addRootedBatch(100);
    useCuttingStore.getState().allocateBatch(b.id, CUTTING_ALLOCATION_REPLANT);
    expect(row().breedingStock).toBe(100);

    useCuttingStore.getState().deleteBatch(b.id);
    expect(row().breedingStock).toBe(0);
  });

  it('deleting an unallocated rooted batch leaves inventory pools at zero', () => {
    const b = addRootedBatch(100);
    useCuttingStore.getState().deleteBatch(b.id);
    const r = row();
    expect(r.needsPacking).toBe(0);
    expect(r.breedingStock).toBe(0);
    expect(r.packed).toBe(0);
    expect(r.availableForSale).toBe(0);
  });
});
