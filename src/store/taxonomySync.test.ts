import { describe, it, expect, beforeEach } from 'vitest';
import { syncTaxonomy } from './taxonomySync';
import { useProductCategoryStore } from './productCategoryStore';
import { useExpenseCategoryStore } from './expenseCategoryStore';

/** syncTaxonomy must register a (category, subcategory) in BOTH taxonomies. */
describe('syncTaxonomy', () => {
  beforeEach(() => {
    useProductCategoryStore.setState({ entries: [], _seeded: 999 });
    useExpenseCategoryStore.setState({ entries: [], _seeded: 999 });
  });

  const inProduct = (c: string, s: string) =>
    useProductCategoryStore.getState().entries.some((e) => e.category === c && e.subcategory === s);
  const inExpense = (c: string, s: string) =>
    useExpenseCategoryStore.getState().entries.some((e) => e.category === c && e.subcategory === s);

  it('writes a category + subcategory to both taxonomies', () => {
    syncTaxonomy('Fruit', 'Palora Yellow');
    expect(inProduct('Fruit', 'Palora Yellow')).toBe(true);
    expect(inExpense('Fruit', 'Palora Yellow')).toBe(true);
  });

  it('writes a top-level category (no subcategory) to both', () => {
    syncTaxonomy('Irrigation');
    expect(inProduct('Irrigation', '')).toBe(true);
    expect(inExpense('Irrigation', '')).toBe(true);
  });

  it('is idempotent — repeated calls do not duplicate rows', () => {
    syncTaxonomy('Cuttings', 'White Ecuador');
    syncTaxonomy('Cuttings', 'White Ecuador');
    const pCount = useProductCategoryStore.getState().entries.filter((e) => e.category === 'Cuttings' && e.subcategory === 'White Ecuador').length;
    const eCount = useExpenseCategoryStore.getState().entries.filter((e) => e.category === 'Cuttings' && e.subcategory === 'White Ecuador').length;
    expect(pCount).toBe(1);
    expect(eCount).toBe(1);
  });

  it('ignores an empty category', () => {
    syncTaxonomy('', 'X');
    expect(useProductCategoryStore.getState().entries).toHaveLength(0);
    expect(useExpenseCategoryStore.getState().entries).toHaveLength(0);
  });
});
