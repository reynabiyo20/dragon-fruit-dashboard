import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId, now } from '../utils/id';
import { DRAGON_FRUIT_VARIETIES, FERTILIZER_VARIETIES } from '../constants';
import { categoryLabel } from '../utils/format';
import { useExpenseStore } from './expenseStore';
import { useVendorStore } from './vendorStore';
import { useVendorProductStore } from './vendorProductStore';

/**
 * Compose the combined "Category – Subcategory" display label. Thin re-export of
 * the canonical helper so callers importing from this store keep working.
 */
export const expenseCategoryLabel = categoryLabel;

/**
 * Cascade a top-level category rename to every record that stored it:
 *  - Expenses: rewrite the top-level `category` (flat + per item).
 *  - Vendors: rewrite matching supplies[].category.
 *  - Vendor-product catalog: move products in the renamed category.
 * The combined "Category – Subcategory" string is derived at display time
 * (see categoryLabel), so nothing stores it and there's no label to recompose.
 */
function cascadeCategoryRename(from: string, to: string): void {
  const { expenses, updateExpense } = useExpenseStore.getState();
  expenses.forEach((e) => {
    const items = e.items ?? [];
    const itemMatch = items.some((it) => it.category === from);
    const flatMatch = e.category === from;
    if (!itemMatch && !flatMatch) return;

    const nextItems = itemMatch
      ? items.map((it) => (it.category === from ? { ...it, category: to } : it))
      : items;
    // For multi-item expenses the primary category follows the first item.
    const primary = nextItems[0];
    const nextCategory = primary ? primary.category : flatMatch ? to : e.category;
    const nextSub = primary ? primary.subcategory : e.subcategory;

    updateExpense(e.id, {
      items: nextItems.length ? nextItems : undefined,
      category: nextCategory,
      subcategory: nextSub,
    });
  });

  const { vendors, updateVendor } = useVendorStore.getState();
  vendors
    .filter((v) => v.supplies.some((s) => s.category === from))
    .forEach((v) =>
      updateVendor(v.id, {
        supplies: v.supplies.map((s) => (s.category === from ? { ...s, category: to } : s)),
      }),
    );

  // Vendor-product catalog entries carry the same category taxonomy.
  const { products, updateProductCategory } = useVendorProductStore.getState();
  products
    .filter((p) => p.category === from)
    .forEach((p) => updateProductCategory(p.id, to, p.subcategory));
}

/** Cascade a subcategory rename (within a fixed category) to expenses + vendors. */
function cascadeSubcategoryRename(
  category: string,
  fromSub: string,
  toCategory: string,
  toSub: string,
): void {
  const { expenses, updateExpense } = useExpenseStore.getState();
  const matchesLine = (cat: string, sub: string) => cat === category && sub === fromSub;
  expenses.forEach((e) => {
    const items = e.items ?? [];
    const itemMatch = items.some((it) => matchesLine(it.category, it.subcategory));
    const flatMatch = matchesLine(e.category, e.subcategory);
    if (!itemMatch && !flatMatch) return;

    const nextItems = itemMatch
      ? items.map((it) =>
          matchesLine(it.category, it.subcategory)
            ? { ...it, category: toCategory, subcategory: toSub }
            : it,
        )
      : items;
    const primary = nextItems[0];
    const nextCategory = primary ? primary.category : flatMatch ? toCategory : e.category;
    const nextSub = primary ? primary.subcategory : flatMatch ? toSub : e.subcategory;

    updateExpense(e.id, {
      items: nextItems.length ? nextItems : undefined,
      category: nextCategory,
      subcategory: nextSub,
    });
  });

  const { vendors, updateVendor } = useVendorStore.getState();
  vendors
    .filter((v) => v.supplies.some((s) => s.category === category && s.subcategory === fromSub))
    .forEach((v) =>
      updateVendor(v.id, {
        supplies: v.supplies.map((s) =>
          s.category === category && s.subcategory === fromSub
            ? { ...s, category: toCategory, subcategory: toSub }
            : s,
        ),
      }),
    );

  // Vendor-product catalog entries carry the same category taxonomy.
  const { products, updateProductCategory } = useVendorProductStore.getState();
  products
    .filter((p) => p.category === category && p.subcategory === fromSub)
    .forEach((p) => updateProductCategory(p.id, toCategory, toSub));
}

/** A single entry in the managed category/subcategory list */
export interface ExpenseCategoryEntry {
  id: string;
  category: string;
  subcategory: string;   // empty string means it's a top-level category with no sub
  quantifiable: boolean; // when true, the expense form shows Qty + Unit Price
  createdAt: string;
  updatedAt: string;
}

interface ExpenseCategoryState {
  entries: ExpenseCategoryEntry[];
  _seeded: number;
  addEntry: (category: string, subcategory: string, quantifiable?: boolean) => void;
  updateEntry: (id: string, category: string, subcategory: string) => void;
  /** Rename a category across ALL of its rows (keeps subcategories grouped together) */
  renameCategory: (from: string, to: string) => void;
  deleteEntry: (id: string) => void;
  /** Toggle quantifiable for ALL entries of a category */
  setQuantifiable: (category: string, quantifiable: boolean) => void;
  /** Whether a category's expenses should capture quantity + unit price */
  isQuantifiable: (category: string) => boolean;
  /** Distinct top-level category names */
  categories: () => string[];
  /** Subcategories for a given category */
  subcategoriesFor: (category: string) => string[];
}

// Bump this to force existing users to receive the updated seed category list
const SEED_VERSION = 4;

/** Categories whose expenses are naturally per-unit (materials) */
const QUANTIFIABLE_CATEGORIES = new Set([
  'Cuttings',
  'Fruit',
  'Fertilizer',
  'Construction Material',
  'Marketing Supplies',
  'Grafting Supplies',
  'Packaging Materials',
]);

function entry(category: string, subcategory: string, quantifiable?: boolean): ExpenseCategoryEntry {
  return {
    id: generateId(),
    category,
    subcategory,
    quantifiable: quantifiable ?? QUANTIFIABLE_CATEGORIES.has(category),
    createdAt: now(),
    updatedAt: now(),
  };
}

// Full list from Excel — Category + Detail pairs
const SEED_ENTRIES: ExpenseCategoryEntry[] = [
  entry('Construction labor', ''),
  entry('Electricity', ''),
  entry('Water', ''),
  // NOTE: Payroll intentionally NOT an expense category — it lives in the Payroll
  // section and is already included separately in the Reports P&L calculation.
  // Cuttings & Fruit purchases from partners — carry the dragon-fruit varieties
  // so a purchase maps 1:1 to an inventory row (see expense→inventory link).
  ...DRAGON_FRUIT_VARIETIES.map((v) => entry('Cuttings', v)),
  ...DRAGON_FRUIT_VARIETIES.map((v) => entry('Fruit', v)),
  entry('Meals', 'Employee Recreation'),
  entry('Meals', 'Guest Food'),
  entry('Gas', ''),
  entry('Air Fare', ''),
  entry('Operational Transportation', ''),
  ...FERTILIZER_VARIETIES.map((v) => entry('Fertilizer', v)),
  entry('Construction Material', 'Roof'),
  entry('Construction Material', 'PVC'),
  entry('Construction Material', 'Cement'),
  entry('Construction Material', 'Nails'),
  entry('Construction Material', 'Tools'),
  entry('Construction Material', 'Etc'),
  entry('Marketing Supplies', 'Tarp'),
  entry('Marketing Supplies', 'Ink'),
  entry('Marketing Supplies', 'Printing Service'),
  entry('Marketing Supplies', 'Etc'),
  entry('Grafting Supplies', 'Masking Tape'),
  entry('Packaging Materials', 'Box'),
  entry('Packaging Materials', 'Bubble Wrap'),
  entry('Packaging Materials', 'Scotch Tape'),
  entry('Packaging Materials', 'Sharpie'),
  entry('Delivery', 'Lala Move'),
  entry('Delivery', 'LBC'),
  entry('Delivery', 'Etc'),
  entry('Other', ''),
];

export const useExpenseCategoryStore = create<ExpenseCategoryState>()(
  persist(
    (set, get) => ({
      entries: SEED_ENTRIES,
      _seeded: SEED_VERSION,

      addEntry: (category, subcategory, quantifiable) =>
        set((state) => {
          const cat = category.trim();
          const sub = subcategory.trim();
          if (!cat) return state;
          // Idempotent: don't create a duplicate (category, subcategory) row.
          // Case/whitespace-insensitive so "magnesium" won't duplicate "Magnesium".
          const norm = (s: string) => s.trim().toLowerCase();
          const dup = state.entries.some(
            (e) => norm(e.category) === norm(cat) && norm(e.subcategory) === norm(sub),
          );
          if (dup) return state;
          // New rows inherit the category's existing quantifiable setting if it exists
          const existing = state.entries.find((e) => norm(e.category) === norm(cat));
          const q = quantifiable ?? existing?.quantifiable ?? QUANTIFIABLE_CATEGORIES.has(cat);
          return { entries: [...state.entries, entry(cat, sub, q)] };
        }),

      updateEntry: (id, category, subcategory) => {
        const prev = get().entries.find((e) => e.id === id);
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id ? { ...e, category, subcategory, updatedAt: now() } : e
          ),
        }));
        // Cascade a subcategory rename (within the same category) to records that
        // stored the old (category, subcategory) pair.
        if (prev && prev.subcategory !== '' && (prev.category !== category || prev.subcategory !== subcategory)) {
          cascadeSubcategoryRename(prev.category, prev.subcategory, category, subcategory);
        }
      },

      renameCategory: (from, to) => {
        const target = to.trim();
        if (!target || target === from) return;
        set((state) => ({
          entries: state.entries.map((e) =>
            e.category === from ? { ...e, category: target, updatedAt: now() } : e
          ),
        }));
        cascadeCategoryRename(from, target);
      },

      deleteEntry: (id) =>
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),

      setQuantifiable: (category, quantifiable) =>
        set((state) => ({
          entries: state.entries.map((e) =>
            e.category === category ? { ...e, quantifiable, updatedAt: now() } : e
          ),
        })),

      isQuantifiable: (category) => {
        const match = get().entries.find((e) => e.category === category);
        return match?.quantifiable ?? false;
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
      name: 'dfd-expense-categories',
      onRehydrateStorage: () => (state) => {
        if (state && state._seeded < SEED_VERSION) {
          state.entries = SEED_ENTRIES;
          state._seeded = SEED_VERSION;
        }
      },
    }
  )
);
