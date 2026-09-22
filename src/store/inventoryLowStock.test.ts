import { describe, it, expect, beforeEach } from 'vitest';
import { useInventoryStore } from './inventoryStore';
import { LOW_STOCK_THRESHOLD } from '../constants';

/**
 * `lowStockItems` marks a row low stock when it's physical stock at/under the
 * threshold:
 *   endingQty <= threshold AND (endingQty <= 0 OR unitCost > 0)
 * i.e. a positive-but-low qty must be priced to count, but an out-of-stock row
 * (endingQty <= 0) always counts regardless of price.
 * AND it's not excluded:
 *   - service categories (auto — never physical stock)
 *   - rows manually flagged `ignoreLowStock` ("ok to be low")
 */
beforeEach(() => {
  useInventoryStore.setState({ items: [], _seeded: 999 });
});

/** Add a positive-but-low (endingQty 2), priced row and return it. */
function addLowRow(category: string, subcategory: string, extra: Record<string, unknown> = {}) {
  return useInventoryStore.getState().addItem({
    category,
    subcategory,
    unit: 'piece',
    beginningQty: 2,
    purchased: 0,
    used: 0,
    sold: 0,
    unitCost: 100, // priced → eligible for low-stock
    notes: '',
    ...extra,
  });
}

describe('inventory lowStockItems exclusions', () => {
  it('flags a priced, low, physical-stock item', () => {
    addLowRow('Fertilizer', 'Cocopeat');
    const low = useInventoryStore.getState().lowStockItems(LOW_STOCK_THRESHOLD);
    expect(low.map((i) => i.subcategory)).toContain('Cocopeat');
  });

  it('never flags a service category (e.g. Delivery), even when low & priced', () => {
    addLowRow('Delivery', 'Courier run');
    const low = useInventoryStore.getState().lowStockItems(LOW_STOCK_THRESHOLD);
    expect(low.some((i) => i.category === 'Delivery')).toBe(false);
  });

  it('does not flag a row manually marked ignoreLowStock', () => {
    const row = addLowRow('Fertilizer', 'Neem Oil');
    expect(useInventoryStore.getState().lowStockItems(LOW_STOCK_THRESHOLD).some((i) => i.id === row.id)).toBe(true);

    useInventoryStore.getState().updateItem(row.id, { ignoreLowStock: true });
    expect(useInventoryStore.getState().lowStockItems(LOW_STOCK_THRESHOLD).some((i) => i.id === row.id)).toBe(false);

    // Toggling it back re-enables the alert.
    useInventoryStore.getState().updateItem(row.id, { ignoreLowStock: false });
    expect(useInventoryStore.getState().lowStockItems(LOW_STOCK_THRESHOLD).some((i) => i.id === row.id)).toBe(true);
  });

  it('ignores unpriced rows that still have positive stock', () => {
    // endingQty 2 (positive) + unitCost 0 → not tracked, shouldn't nag.
    addLowRow('Fertilizer', 'Freebie', { unitCost: 0 });
    const low = useInventoryStore.getState().lowStockItems(LOW_STOCK_THRESHOLD);
    expect(low.some((i) => i.subcategory === 'Freebie')).toBe(false);
  });

  it('always flags an out-of-stock row (endingQty <= 0) even when unpriced', () => {
    // A row with 0 ending qty is out of stock — an alert regardless of price.
    addLowRow('Cuttings', 'Asunta 5 Paco', {
      beginningQty: 0,
      unitCost: 0,
    });
    const low = useInventoryStore.getState().lowStockItems(LOW_STOCK_THRESHOLD);
    expect(low.some((i) => i.subcategory === 'Asunta 5 Paco')).toBe(true);
  });
});
