import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useCuttingStore } from './cuttingStore';
import { useInventoryStore } from './inventoryStore';
import { generateId, now } from '../utils/id';
import { CUTTINGS_PRODUCT_TYPE } from '../constants';

/**
 * Undoing a "pack" from Propagation (Cuttings) must cascade back through the same
 * inventory pools the pack credited, so the derived KPIs stay in lockstep:
 *   - `availableForSale`  → drives the Propagation "Packed & Ready to Sell" KPI
 *   - `packed` → endingQty → drives the Inventory value / low-stock KPIs
 * This guards the symmetry of markPacked ⇄ unmarkPacked.
 */
describe('undo pack cascades to inventory pools and KPI inputs', () => {
  beforeEach(() => {
    useCuttingStore.setState({ batches: [] });
    useInventoryStore.setState({
      items: [
        {
          id: generateId(), category: CUTTINGS_PRODUCT_TYPE, subcategory: 'American Beauty',
          unit: 'piece', beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 0,
          unitCost: 12, packed: 0, needsPacking: 0, breedingStock: 0, availableForSale: 0,
          produced: 0, harvested: 0, notes: '', createdAt: now(), updatedAt: now(),
        },
      ],
      _seeded: 999,
    });
  });

  const row = () => useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'American Beauty')!;
  // The Propagation "Packed & Ready to Sell" KPI = Σ availableForSale over Cuttings rows.
  const packedReadyKpi = () =>
    useInventoryStore
      .getState()
      .items.filter((i) => i.category === CUTTINGS_PRODUCT_TYPE)
      .reduce((sum, i) => sum + (i.availableForSale ?? 0), 0);

  function addRootedBatch(qty: number) {
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return useCuttingStore.getState().addBatch({
      subcategory: 'American Beauty', cuttingType: 'Grafted with Roots',
      harvestDate: longAgo, dateSourced: longAgo, dateGrafted: '',
      quantitySourced: qty, sourceCostPerCutting: 0, graftCostPerCutting: 0,
      rootWeeks: 3, notes: '',
    });
  }

  it('undoing a clean pack returns pools and both KPIs to zero', () => {
    const b = addRootedBatch(80);
    useCuttingStore.getState().markPacked(b.id);
    expect(packedReadyKpi()).toBe(80);
    expect(row().endingQty).toBe(80);
    expect(useInventoryStore.getState().totalValue()).toBe(80 * 12);

    const ok = useCuttingStore.getState().unmarkPacked(b.id);
    expect(ok).toBe(true);

    const r = row();
    expect(r.packed).toBe(0);
    expect(r.availableForSale).toBe(0);
    expect(r.endingQty).toBe(0);              // → Inventory value / low-stock KPIs
    expect(packedReadyKpi()).toBe(0);         // → Propagation "Packed & Ready to Sell" KPI
    expect(useInventoryStore.getState().totalValue()).toBe(0);
    expect(useCuttingStore.getState().getBatch(b.id)?.packed).toBe(false);
  });

  it('undo is blocked (no partial cascade) once some packed stock is sold', () => {
    const b = addRootedBatch(80);
    useCuttingStore.getState().markPacked(b.id);
    // Simulate 30 delivered/sold, leaving 50 sellable.
    useInventoryStore.getState().adjustAvailableForSale(row().id, -30);
    expect(packedReadyKpi()).toBe(50);

    const ok = useCuttingStore.getState().unmarkPacked(b.id);
    expect(ok).toBe(false);                   // can't cleanly reverse 80 from a 50 pool
    // Nothing changed — the batch is still packed and the KPI is untouched.
    expect(packedReadyKpi()).toBe(50);
    expect(useCuttingStore.getState().getBatch(b.id)?.packed).toBe(true);
  });
});
