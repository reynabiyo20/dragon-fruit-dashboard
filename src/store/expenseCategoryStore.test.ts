import { describe, it, expect, beforeEach, vi } from 'vitest';

// The rename cascades touch other stores + toast; keep tests quiet.
vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useExpenseCategoryStore } from './expenseCategoryStore';

const store = () => useExpenseCategoryStore.getState();

beforeEach(() => {
  useExpenseCategoryStore.setState({
    entries: [
      { id: 'a', category: 'Fertilizer', subcategory: 'Magnesium', quantifiable: false, createdAt: '', updatedAt: '' },
      { id: 'b', category: 'Fertilizer', subcategory: 'Cocopeat', quantifiable: false, createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
});

describe('expenseCategoryStore.addEntry (subcategory add + dedupe)', () => {
  it('adds a new subcategory under an existing category', () => {
    store().addEntry('Fertilizer', 'Nordox');
    const subs = store().subcategoriesFor('Fertilizer');
    expect(subs).toContain('Nordox');
  });

  it('can create a new category flagged quantifiable (so the expense form shows qty/price)', () => {
    store().addEntry('Equipment Rental', '', true);
    expect(store().isQuantifiable('Equipment Rental')).toBe(true);
    expect(store().categories()).toContain('Equipment Rental');
  });

  it('defaults a brand-new subcategorized category to quantifiable', () => {
    // New category + subcategory in one step → quantifiable by default so the
    // purchase captures qty × price and cascades to inventory.
    store().addEntry('Packaging', 'Box');
    expect(store().isQuantifiable('Packaging')).toBe(true);
  });

  it('a top-level-only new category is NOT quantifiable by default', () => {
    store().addEntry('Consulting', '');
    expect(store().isQuantifiable('Consulting')).toBe(false);
  });

  it('returns subcategories in alphabetical order, including a newly added one', () => {
    store().addEntry('Fertilizer', 'Alfalfa'); // sorts to the front
    const subs = store().subcategoriesFor('Fertilizer');
    expect(subs).toEqual([...subs].sort());
    expect(subs[0]).toBe('Alfalfa');
  });

  it('does not create a duplicate (case/whitespace-insensitive)', () => {
    const before = store().entries.length;
    store().addEntry('Fertilizer', '  magnesium '); // same as existing "Magnesium"
    expect(store().entries.length).toBe(before);
    // Still just one Magnesium row
    const magRows = store().entries.filter(
      (e) => e.category === 'Fertilizer' && e.subcategory.toLowerCase() === 'magnesium',
    );
    expect(magRows).toHaveLength(1);
  });

  it('trims the stored subcategory value', () => {
    store().addEntry('Fertilizer', '  Neem Oil  ');
    expect(store().subcategoriesFor('Fertilizer')).toContain('Neem Oil');
  });

  it('ignores a blank category', () => {
    const before = store().entries.length;
    store().addEntry('   ', 'Whatever');
    expect(store().entries.length).toBe(before);
  });
});
