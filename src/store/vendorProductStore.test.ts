import { describe, it, expect, beforeEach } from 'vitest';
import { useVendorProductStore } from './vendorProductStore';

/**
 * Reset only the data fields before each test. A partial (merge) setState keeps
 * the action functions intact — a replacing setState would wipe them out.
 */
beforeEach(() => {
  useVendorProductStore.setState({ products: [], prices: [] });
});

const store = () => useVendorProductStore.getState();

describe('vendorProductStore.addProduct', () => {
  it('creates a new product with trimmed fields', () => {
    const p = store().addProduct({ name: '  Cement  ', category: ' Construction Material ', subcategory: ' Bag ', unit: ' bag ' });
    expect(p.name).toBe('Cement');
    expect(p.category).toBe('Construction Material');
    expect(p.subcategory).toBe('Bag');
    expect(p.unit).toBe('bag');
    expect(store().products).toHaveLength(1);
  });

  it('finds the existing product instead of duplicating (case/space-insensitive)', () => {
    const a = store().addProduct({ name: 'Cement', category: 'Construction Material', subcategory: 'Bag', unit: 'bag' });
    const b = store().addProduct({ name: '  cement ', category: 'construction material', subcategory: 'BAG', unit: '' });
    expect(b.id).toBe(a.id);
    expect(store().products).toHaveLength(1);
  });

  it('backfills a missing unit on an existing product without overwriting a set one', () => {
    const a = store().addProduct({ name: 'Nails', category: 'Construction Material', subcategory: '', unit: '' });
    expect(a.unit).toBe('');

    // Second observation supplies a unit → backfilled
    const b = store().addProduct({ name: 'Nails', category: 'Construction Material', subcategory: '', unit: 'kg' });
    expect(b.id).toBe(a.id);
    expect(store().getProduct(a.id)?.unit).toBe('kg');

    // A later different unit does NOT overwrite the set one
    store().addProduct({ name: 'Nails', category: 'Construction Material', subcategory: '', unit: 'box' });
    expect(store().getProduct(a.id)?.unit).toBe('kg');
  });

  it('treats different categories/subcategories as distinct products', () => {
    store().addProduct({ name: 'Tape', category: 'Grafting Supplies', subcategory: 'Masking Tape', unit: 'roll' });
    store().addProduct({ name: 'Tape', category: 'Packaging Materials', subcategory: 'Scotch Tape', unit: 'roll' });
    expect(store().products).toHaveLength(2);
  });
});

describe('vendorProductStore vendor price links', () => {
  it('linkVendorPrice creates then updates the same link', () => {
    const p = store().addProduct({ name: 'Cement', category: 'Construction Material', subcategory: 'Bag', unit: 'bag' });
    store().linkVendorPrice('v1', p.id, 250);
    expect(store().prices).toHaveLength(1);
    expect(store().priceFor('v1', p.id)).toBe(250);

    store().linkVendorPrice('v1', p.id, 275);
    expect(store().prices).toHaveLength(1); // still one link, updated
    expect(store().priceFor('v1', p.id)).toBe(275);
  });

  it('linkVendorPrice defaults an omitted price to 0', () => {
    const p = store().addProduct({ name: 'Cement', category: 'Construction Material', subcategory: 'Bag', unit: 'bag' });
    store().linkVendorPrice('v1', p.id);
    expect(store().priceFor('v1', p.id)).toBe(0);
  });

  it('priceFor returns undefined when no link exists', () => {
    const p = store().addProduct({ name: 'Cement', category: 'Construction Material', subcategory: 'Bag', unit: 'bag' });
    expect(store().priceFor('nope', p.id)).toBeUndefined();
  });

  it('unlinkVendorPrice removes only that vendor-product link', () => {
    const p = store().addProduct({ name: 'Cement', category: 'Construction Material', subcategory: 'Bag', unit: 'bag' });
    store().linkVendorPrice('v1', p.id, 250);
    store().linkVendorPrice('v2', p.id, 260);
    store().unlinkVendorPrice('v1', p.id);
    expect(store().priceFor('v1', p.id)).toBeUndefined();
    expect(store().priceFor('v2', p.id)).toBe(260);
  });
});

describe('vendorProductStore queries', () => {
  it('productsFor returns only products a vendor is linked to, filtered by category', () => {
    const cement = store().addProduct({ name: 'Cement', category: 'Construction Material', subcategory: 'Bag', unit: 'bag' });
    const box = store().addProduct({ name: 'Box', category: 'Packaging Materials', subcategory: 'Box', unit: 'box' });
    const unlinked = store().addProduct({ name: 'Ink', category: 'Marketing Supplies', subcategory: 'Ink', unit: 'bottle' });

    store().linkVendorPrice('v1', cement.id, 250);
    store().linkVendorPrice('v1', box.id, 30);
    // `unlinked` has no link for v1

    const all = store().productsFor('v1');
    expect(all.map((p) => p.id).sort()).toEqual([cement.id, box.id].sort());
    expect(all.map((p) => p.id)).not.toContain(unlinked.id);

    const construction = store().productsFor('v1', 'Construction Material');
    expect(construction).toHaveLength(1);
    expect(construction[0].id).toBe(cement.id);
  });

  it('categoriesFor returns distinct categories the vendor offers', () => {
    const cement = store().addProduct({ name: 'Cement', category: 'Construction Material', subcategory: 'Bag', unit: 'bag' });
    const nails = store().addProduct({ name: 'Nails', category: 'Construction Material', subcategory: '', unit: 'kg' });
    const box = store().addProduct({ name: 'Box', category: 'Packaging Materials', subcategory: 'Box', unit: 'box' });
    store().linkVendorPrice('v1', cement.id, 250);
    store().linkVendorPrice('v1', nails.id, 80);
    store().linkVendorPrice('v1', box.id, 30);

    expect(store().categoriesFor('v1')).toEqual(['Construction Material', 'Packaging Materials']);
  });
});

describe('vendorProductStore mutations', () => {
  it('updateProduct changes name/unit only', () => {
    const p = store().addProduct({ name: 'Cement', category: 'Construction Material', subcategory: 'Bag', unit: 'bag' });
    store().updateProduct(p.id, { name: 'Portland Cement', unit: 'sack' });
    const next = store().getProduct(p.id)!;
    expect(next.name).toBe('Portland Cement');
    expect(next.unit).toBe('sack');
    expect(next.category).toBe('Construction Material'); // unchanged
  });

  it('updateProductCategory moves a product to a new category/subcategory', () => {
    const p = store().addProduct({ name: 'Cement', category: 'Construction Material', subcategory: 'Bag', unit: 'bag' });
    store().updateProductCategory(p.id, 'Building Supplies', 'Sack');
    const next = store().getProduct(p.id)!;
    expect(next.category).toBe('Building Supplies');
    expect(next.subcategory).toBe('Sack');
  });

  it('deleteProduct removes the product and cascades its price links', () => {
    const p = store().addProduct({ name: 'Cement', category: 'Construction Material', subcategory: 'Bag', unit: 'bag' });
    const other = store().addProduct({ name: 'Box', category: 'Packaging Materials', subcategory: 'Box', unit: 'box' });
    store().linkVendorPrice('v1', p.id, 250);
    store().linkVendorPrice('v2', p.id, 260);
    store().linkVendorPrice('v1', other.id, 30);

    store().deleteProduct(p.id);
    expect(store().getProduct(p.id)).toBeUndefined();
    expect(store().prices.some((pr) => pr.productId === p.id)).toBe(false);
    // The unrelated link survives
    expect(store().priceFor('v1', other.id)).toBe(30);
  });
});
