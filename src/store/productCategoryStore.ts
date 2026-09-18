import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId, now } from '../utils/id';
import { PRODUCT_CATEGORY_SEED } from '../constants';
import { useProductStore } from './productStore';

/**
 * Managed two-level product taxonomy: category → subcategory (variety).
 *
 * Mirrors the expense-category store's shape so the Settings UI can manage it
 * the same way. The Products form and Sales form read their category/subcategory
 * dropdowns from here, so users can add categories and subcategories at runtime.
 */
export interface ProductCategoryEntry {
  id: string;
  category: string;
  subcategory: string; // '' means the category has no varieties (e.g. "Drink")
  createdAt: string;
  updatedAt: string;
}

interface ProductCategoryState {
  entries: ProductCategoryEntry[];
  _seeded: number;
  addEntry: (category: string, subcategory: string) => void;
  /** Rename a variety row; cascades the new name to matching product records. */
  updateEntry: (id: string, category: string, subcategory: string) => void;
  /** Rename a category across ALL of its rows; cascades to matching products. */
  renameCategory: (from: string, to: string) => void;
  /**
   * Remove a taxonomy row. Cascades: deleting a variety removes products with the
   * matching (category, variety); deleting a category's top-level row removes all
   * products of that category. Existing sales keep their saved line labels.
   */
  deleteEntry: (id: string) => void;
  /** Distinct category names */
  categories: () => string[];
  /** Subcategories/varieties for a given category */
  subcategoriesFor: (category: string) => string[];
}

// Bump to re-seed existing users with the updated taxonomy
// v2: 30 real dragon-fruit varieties from the bookkeeping sheet
const SEED_VERSION = 2;

function entry(category: string, subcategory: string): ProductCategoryEntry {
  return { id: generateId(), category, subcategory, createdAt: now(), updatedAt: now() };
}

const SEED_ENTRIES: ProductCategoryEntry[] = PRODUCT_CATEGORY_SEED.map(([c, s]) => entry(c, s));

export const useProductCategoryStore = create<ProductCategoryState>()(
  persist(
    (set, get) => ({
      entries: SEED_ENTRIES,
      _seeded: SEED_VERSION,

      addEntry: (category, subcategory) =>
        set((state) => {
          const cat = category.trim();
          const sub = subcategory.trim();
          if (!cat) return state;
          // Avoid duplicate (category, sub) rows — case-insensitive so "Fruit"
          // and "fruit" can't both exist (matches the expense taxonomy store).
          const norm = (s: string) => s.trim().toLowerCase();
          const exists = state.entries.some(
            (e) => norm(e.category) === norm(cat) && norm(e.subcategory) === norm(sub),
          );
          if (exists) return state;
          return { entries: [...state.entries, entry(cat, sub)] };
        }),

      updateEntry: (id, category, subcategory) => {
        const prev = get().entries.find((e) => e.id === id);
        const cat = category.trim();
        const sub = subcategory.trim();
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id ? { ...e, category: cat, subcategory: sub, updatedAt: now() } : e,
          ),
        }));
        // Cascade a variety rename to matching product records (full-pair match).
        if (prev && prev.subcategory !== '' && (prev.category !== cat || prev.subcategory !== sub)) {
          const { products, updateProduct } = useProductStore.getState();
          products
            .filter((p) => p.category === prev.category && p.subcategory === prev.subcategory)
            .forEach((p) => updateProduct(p.id, { category: cat, subcategory: sub }));
        }
      },

      renameCategory: (from, to) => {
        const target = to.trim();
        if (!target || target === from) return;
        set((state) => ({
          entries: state.entries.map((e) =>
            e.category === from ? { ...e, category: target, updatedAt: now() } : e,
          ),
        }));
        // Cascade the category rename to every product of that category.
        const { products, updateProduct } = useProductStore.getState();
        products
          .filter((p) => p.category === from)
          .forEach((p) => updateProduct(p.id, { category: target }));
      },

      deleteEntry: (id) => {
        const target = get().entries.find((e) => e.id === id);
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) }));
        if (!target) return;
        // Cascade the delete into product records so the option disappears from
        // the Sales/Products dropdowns. Historical sales keep their line labels.
        const { products, deleteProduct } = useProductStore.getState();
        const toRemove = products.filter((p) =>
          target.subcategory === ''
            ? p.category === target.category // deleting a whole category
            : p.category === target.category && p.subcategory === target.subcategory,
        );
        toRemove.forEach((p) => deleteProduct(p.id));
      },

      categories: () => {
        const seen = new Set<string>();
        get().entries.forEach((e) => seen.add(e.category));
        return Array.from(seen).sort();
      },

      subcategoriesFor: (category) => {
        const subs = get()
          .entries.filter((e) => e.category === category && e.subcategory !== '')
          .map((e) => e.subcategory);
        return [...new Set(subs)].sort();
      },
    }),
    {
      name: 'dfd-product-categories',
      onRehydrateStorage: () => (state) => {
        if (state && state._seeded < SEED_VERSION) {
          state.entries = SEED_ENTRIES;
          state._seeded = SEED_VERSION;
        }
      },
    },
  ),
);
