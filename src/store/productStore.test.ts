import { describe, it, expect, beforeEach } from 'vitest';
import { useProductStore } from './productStore';

const store = () => useProductStore.getState();

beforeEach(() => {
  useProductStore.setState({ products: [], _seeded: 999 });
});

describe('productStore.upsertFromPurchase', () => {
  it('creates a new sellable product from a purchase (cost seeded, selling price blank)', () => {
    const p = store().upsertFromPurchase({ category: 'Fertilizer', subcategory: 'Potassium', unit: 'sack', costPHP: 300 });
    expect(p.category).toBe('Fertilizer');
    expect(p.subcategory).toBe('Potassium');
    expect(p.unit).toBe('sack');
    expect(p.costPHP).toBe(300);
    expect(p.sellingPricePHP).toBe(0);
    expect(store().products).toHaveLength(1);
  });

  it('does not duplicate an existing (category, subcategory) — case/whitespace-insensitive', () => {
    store().upsertFromPurchase({ category: 'Fertilizer', subcategory: 'Potassium', unit: 'sack', costPHP: 300 });
    store().upsertFromPurchase({ category: ' fertilizer ', subcategory: ' potassium ', unit: 'sack', costPHP: 320 });
    expect(store().products).toHaveLength(1);
  });

  it('backfills a missing unit and a zero cost, but never overwrites set values', () => {
    const created = store().addProduct({
      category: 'Fertilizer', subcategory: 'Magnesium', costPHP: 0, sellingPricePHP: 1150,
      costUSD: 0, sellingPriceUSD: 0, unit: '', notes: '',
    });
    // First purchase backfills the empty unit and the zero cost
    store().upsertFromPurchase({ category: 'Fertilizer', subcategory: 'Magnesium', unit: 'bottle', costPHP: 410 });
    let row = store().getProduct(created.id)!;
    expect(row.unit).toBe('bottle');
    expect(row.costPHP).toBe(410);
    expect(row.sellingPricePHP).toBe(1150); // untouched

    // A later purchase must NOT overwrite the now-set unit/cost
    store().upsertFromPurchase({ category: 'Fertilizer', subcategory: 'Magnesium', unit: 'jug', costPHP: 999 });
    row = store().getProduct(created.id)!;
    expect(row.unit).toBe('bottle');
    expect(row.costPHP).toBe(410);
  });

  it('findByCategorySub matches tolerantly', () => {
    store().upsertFromPurchase({ category: 'Fertilizer', subcategory: 'Cocopeat', unit: 'sack', costPHP: 220 });
    expect(store().findByCategorySub('  FERTILIZER ', 'cocopeat')).toBeDefined();
    expect(store().findByCategorySub('Fertilizer', 'Nope')).toBeUndefined();
  });
});
