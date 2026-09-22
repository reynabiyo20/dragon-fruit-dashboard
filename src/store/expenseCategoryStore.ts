import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId, now } from '../utils/id';
import {
  DRAGON_FRUIT_VARIETIES,
  FERTILIZER_VARIETIES,
  ACCOUNTING_CLASSIFICATIONS,
  EXPENSE_TYPES,
} from '../constants';
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

/**
 * One-time data migration (seed v8): fold the old top-level Electricity / Water /
 * Internet categories into (Utilities, <name>) across every record that stored
 * them — expenses (flat + per item), vendor supplies, and the vendor-product
 * catalog — so no historical record is orphaned by the recategorization.
 */
function migrateUtilities(): void {
  const norm = (s: string) => s.trim().toLowerCase();
  const mapped = (cat: string): { category: string; subcategory: string } | null => {
    const sub = UTILITIES_MIGRATION[norm(cat)];
    return sub ? { category: UTILITIES_CATEGORY, subcategory: sub } : null;
  };

  // Expenses (flat fields + per-item lines).
  const { expenses, updateExpense } = useExpenseStore.getState();
  expenses.forEach((e) => {
    const items = e.items ?? [];
    const itemHit = items.some((it) => mapped(it.category));
    const flatHit = !!mapped(e.category);
    if (!itemHit && !flatHit) return;
    const nextItems = itemHit
      ? items.map((it) => {
          const m = mapped(it.category);
          return m ? { ...it, category: m.category, subcategory: m.subcategory } : it;
        })
      : items;
    const flatMap = mapped(e.category);
    updateExpense(e.id, {
      items: nextItems.length ? nextItems : undefined,
      category: flatMap ? flatMap.category : e.category,
      subcategory: flatMap ? flatMap.subcategory : e.subcategory,
    });
  });

  // Vendor supplies.
  const { vendors, updateVendor } = useVendorStore.getState();
  vendors
    .filter((v) => v.supplies.some((s) => mapped(s.category)))
    .forEach((v) =>
      updateVendor(v.id, {
        supplies: v.supplies.map((s) => {
          const m = mapped(s.category);
          return m ? { ...s, category: m.category, subcategory: m.subcategory } : s;
        }),
      }),
    );

  // Vendor-product catalog.
  const { products, updateProductCategory } = useVendorProductStore.getState();
  products
    .filter((p) => mapped(p.category))
    .forEach((p) => {
      const m = mapped(p.category)!;
      updateProductCategory(p.id, m.category, m.subcategory);
    });
}

/** A single entry in the managed category/subcategory list */
export interface ExpenseCategoryEntry {
  id: string;
  category: string;
  subcategory: string;   // empty string means it's a top-level category with no sub
  quantifiable: boolean; // when true, the expense form shows Qty + Unit Price
  /**
   * Bookkeeping attributes synced from the "Expense Categories" sheet (all its
   * columns except the free-text Notes). They act as the DEFAULT that prefills
   * the Expense form when this (category, subcategory) is chosen, and the values
   * come from the same editable option lists the Expense form uses:
   *  - accountingClassification: CapEx / OpEx / COGS (+ OpEx sub-variants).
   *  - expenseType: cost behavior — Fixed / Variable / Semi-Variable.
   * Optional for back-compat with entries created before this field existed.
   */
  accountingClassification?: string;
  expenseType?: string;
  createdAt: string;
  updatedAt: string;
}

interface ExpenseCategoryState {
  entries: ExpenseCategoryEntry[];
  _seeded: number;
  addEntry: (
    category: string,
    subcategory: string,
    quantifiable?: boolean,
    bookkeeping?: { accountingClassification?: string; expenseType?: string },
  ) => void;
  updateEntry: (id: string, category: string, subcategory: string) => void;
  /** Rename a category across ALL of its rows (keeps subcategories grouped together) */
  renameCategory: (from: string, to: string) => void;
  deleteEntry: (id: string) => void;
  /** Toggle quantifiable for ALL entries of a category */
  setQuantifiable: (category: string, quantifiable: boolean) => void;
  /** Whether a category's expenses should capture quantity + unit price */
  isQuantifiable: (category: string) => boolean;
  /**
   * Set the bookkeeping default (accounting classification + expense type) for a
   * single (category, subcategory) row. Empty strings clear the field.
   */
  setBookkeeping: (id: string, accountingClassification: string, expenseType: string) => void;
  /** The bookkeeping default for a (category, subcategory), for form prefilling. */
  bookkeepingFor: (
    category: string,
    subcategory: string,
  ) => { accountingClassification: string; expenseType: string };
  /** Distinct top-level category names */
  categories: () => string[];
  /** Subcategories for a given category */
  subcategoriesFor: (category: string) => string[];
}

// Bump this to force existing users to receive the updated seed category list
// v6: full expense-category list synced from the bookkeeping sheet (Land Costs,
// Crop Protection, Business Insurance, Financial Overhead, Storage & Logistics,
// Equipment Costs, Professional Services, Root Stock, J&T, …)
// v7: each category now carries its bookkeeping default — accounting
// classification + expense type — synced from the same sheet.
// v8: Electricity / Water / Internet recategorized as subcategories of a new
// "Utilities" category (a data migration rewrites existing records — see below).
// v9: removed Financial Overhead, Crop Protection, Storage & Logistics; added
// service subcategories (Construction labor Hourly/Contract, Air Fare
// Domestic/International, Business Insurance General Liability/Property/Vehicle).
const SEED_VERSION = 9;

/**
 * Top-level categories folded into "Utilities" as subcategories. Existing
 * expenses/vendors that used the old top-level category are migrated to
 * (Utilities, <old category>) on rehydrate so nothing is orphaned.
 */
const UTILITIES_MIGRATION: Record<string, string> = {
  electricity: 'Electricity',
  water: 'Water',
  internet: 'Internet',
};
const UTILITIES_CATEGORY = 'Utilities';

/**
 * The "Expense Categories" sheet writes classifications/types in a short form
 * (e.g. "Operating Expense", "Capital Expenditure / Operating Expense"). The app
 * stores the canonical option-list labels (e.g. "Operating Expense (OpEx)"). Map
 * the raw sheet strings onto those canonical values so a category's default lines
 * up 1:1 with the choices in the Expense form dropdowns.
 */
const CLASSIFICATION_ALIASES: Record<string, (typeof ACCOUNTING_CLASSIFICATIONS)[number]> = {
  'operating expense': 'Operating Expense (OpEx)',
  'capital expenditure': 'Capital Expenditure (CapEx)',
  'cost of goods sold': 'Cost of Goods Sold (COGS)',
  'operating expense / selling': 'Operating Expense (OpEx) / Selling',
  'operating expense / repair': 'Operating Expense (OpEx) / Repair',
  'operating expense / supply': 'Operating Expense (OpEx) / Supply',
  'operating expense / overhead': 'Operating Expense (OpEx) / Overhead',
  'operating expense / shipping': 'Operating Expense (OpEx) / Shipping',
  'capital expenditure / operating expense': 'Capital Expenditure or OpEx',
};

/** Normalize a raw sheet classification to a canonical option-list value. */
function canonicalClassification(raw: string): string {
  // Collapse whitespace (the sheet has stray double spaces) and lowercase.
  const key = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!key) return '';
  return CLASSIFICATION_ALIASES[key] ?? raw.trim().replace(/\s+/g, ' ');
}

/** Normalize a raw sheet expense type to a canonical EXPENSE_TYPES value. */
function canonicalExpenseType(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const match = EXPENSE_TYPES.find((t) => t.toLowerCase() === cleaned.toLowerCase());
  return match ?? cleaned;
}

/**
 * Generic bookkeeping fallback for a (category, subcategory) that has NO seeded
 * default anywhere — the most common treatment for a miscellaneous material or
 * supply. Ensures an expense is never saved unclassified; the user can still
 * override it in the form. Uses canonical option-list values.
 */
const DEFAULT_ACCOUNTING_CLASSIFICATION: (typeof ACCOUNTING_CLASSIFICATIONS)[number] = 'Operating Expense (OpEx)';
const DEFAULT_EXPENSE_TYPE: (typeof EXPENSE_TYPES)[number] = 'Variable';

/** Categories whose expenses are naturally per-unit (materials) */
const QUANTIFIABLE_CATEGORIES = new Set([
  'Cuttings',
  'Fruit',
  'Fertilizer',
  'Root Stock',
  'Construction Material',
  'Marketing Supplies',
  'Grafting Supplies',
  'Packaging Materials',
]);

function entry(
  category: string,
  subcategory: string,
  quantifiable?: boolean,
  bookkeeping?: { accountingClassification?: string; expenseType?: string },
): ExpenseCategoryEntry {
  return {
    id: generateId(),
    category,
    subcategory,
    quantifiable: quantifiable ?? QUANTIFIABLE_CATEGORIES.has(category),
    accountingClassification: canonicalClassification(bookkeeping?.accountingClassification ?? ''),
    expenseType: canonicalExpenseType(bookkeeping?.expenseType ?? ''),
    createdAt: now(),
    updatedAt: now(),
  };
}

/**
 * Sheet-defaulted entry helper. Cuttings/Fruit partner-purchase rows and other
 * inventory materials share a classification/type across their varieties, so a
 * small factory keeps the SEED_ENTRIES list readable: bk(category, sub, class, type).
 */
function bk(
  category: string,
  subcategory: string,
  accountingClassification: string,
  expenseType: string,
  quantifiable?: boolean,
): ExpenseCategoryEntry {
  return entry(category, subcategory, quantifiable, { accountingClassification, expenseType });
}

// Full list synced from the bookkeeping sheet's "Expense Categories" tab.
// NOTE: Payroll is intentionally NOT an expense category — it lives in the
// Payroll section and is already included separately in the Reports P&L.
// "Fertilizers" in the sheet maps to the app's singular "Fertilizer" category,
// and Cuttings/Fruit variety rows are kept for partner purchases so an expense
// maps 1:1 to an inventory row (see the expense→inventory link).
const SEED_ENTRIES: ExpenseCategoryEntry[] = [
  // Construction labor (service) — hourly or contract.
  bk('Construction labor', 'Hourly', 'Capital Expenditure', 'Fixed'),
  bk('Construction labor', 'Contract', 'Capital Expenditure', 'Fixed'),
  // Utilities — Electricity / Water / Internet are subcategories of one
  // "Utilities" category (recategorized from standalone top-level categories).
  bk('Utilities', 'Electricity', 'Operating Expense', 'Semi-Variable'),
  bk('Utilities', 'Water', 'Operating Expense', 'Variable'),
  bk('Utilities', 'Internet', 'Operating Expense', 'Variable'),
  // Cuttings & Fruit purchases from partners — carry the dragon-fruit varieties.
  // Direct planting/resale material, so they book to COGS with variable cost.
  ...DRAGON_FRUIT_VARIETIES.map((v) => bk('Cuttings', v, 'Cost of Goods Sold', 'Variable')),
  ...DRAGON_FRUIT_VARIETIES.map((v) => bk('Fruit', v, 'Cost of Goods Sold', 'Variable')),
  bk('Root Stock', 'base/ full', 'Cost of Goods Sold', 'Variable'),
  bk('Meals', 'Employee Recreation', 'Operating Expense', 'Variable'),
  bk('Meals', 'Guest Food', 'Operating Expense', 'Variable'),
  bk('Gas', '', 'Operating Expense', 'Variable'),
  // Air Fare (service) — domestic or international travel.
  bk('Air Fare', 'Domestic', 'Operating Expense', 'Variable'),
  bk('Air Fare', 'International', 'Operating Expense', 'Variable'),
  // Fertilizer rows — all Operating Expense / Variable per the sheet.
  ...FERTILIZER_VARIETIES.map((v) => bk('Fertilizer', v, 'Operating Expense', 'Variable')),
  bk('Construction Material', 'Roof', 'Capital Expenditure', 'Fixed'),
  bk('Construction Material', 'PVC', 'Operating Expense / Repair', 'Variable'),
  bk('Construction Material', 'Cement', 'Operating Expense / Repair', 'Variable'),
  bk('Construction Material', 'Nails', 'Operating Expense / Supply', 'Variable'),
  bk('Construction Material', 'Tools', 'Capital Expenditure / Operating Expense', 'Fixed / Variable'),
  bk('Construction Material', 'Etc', 'Operating Expense / Supply', 'Variable'),
  bk('Marketing Supplies', 'Tarp', 'Operating Expense / Selling', 'Variable'),
  bk('Marketing Supplies', 'Ink', 'Operating Expense / Overhead', 'Variable'),
  bk('Marketing Supplies', 'Printing Service', 'Operating Expense / Selling', 'Variable'),
  bk('Marketing Supplies', 'Etc', 'Operating Expense / Selling', 'Variable'),
  bk('Grafting Supplies', 'Masking Tape', 'Cost of Goods Sold', 'Variable'),
  bk('Packaging Materials', 'Box', 'Cost of Goods Sold', 'Variable'),
  bk('Packaging Materials', 'Bubble Wrap', 'Cost of Goods Sold', 'Variable'),
  bk('Packaging Materials', 'Scotch Tape', 'Cost of Goods Sold', 'Variable'),
  bk('Packaging Materials', 'Sharpee', 'Operating Expense / Overhead', 'Variable'),
  bk('Delivery', 'Lala Move', 'Operating Expense / Shipping', 'Variable'),
  bk('Delivery', 'LBC', 'Operating Expense / Shipping', 'Variable'),
  bk('Delivery', 'J&T', 'Operating Expense / Shipping', 'Variable'),
  bk('Land Costs', 'Cash Rent / Land Lease', 'Operating Expense', 'Fixed'),
  bk('Land Costs', 'Property & Real Estate Taxes', 'Operating Expense', 'Fixed'),
  // Business Insurance (service) — general liability, property, or vehicle.
  bk('Business Insurance', 'General Liability', 'Operating Expense', 'Fixed'),
  bk('Business Insurance', 'Property', 'Operating Expense', 'Fixed'),
  bk('Business Insurance', 'Vehicle', 'Operating Expense', 'Fixed'),
  bk('Tractor & Vehicle Costs', 'Vehicle Registration & Fees', 'Operating Expense', 'Fixed'),
  bk('Tractor & Vehicle Costs', 'Cash', 'Operating Expense', 'Fixed'),
  bk('Equipment Costs', 'Machine Hire / Custom Work', 'Operating Expense', 'Variable'),
  bk('Professional Services', 'Accounting & Bookkeeping', 'Operating Expense', 'Fixed'),
  bk('Professional Services', 'Agronomist / Soil Testing', 'Operating Expense', 'Variable'),
  entry('Other', ''),
];

export const useExpenseCategoryStore = create<ExpenseCategoryState>()(
  persist(
    (set, get) => ({
      entries: SEED_ENTRIES,
      _seeded: SEED_VERSION,

      addEntry: (category, subcategory, quantifiable, bookkeeping) =>
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
          // Resolve the quantifiable flag with this precedence:
          //  1. explicit argument, else
          //  2. the category's existing setting (keep a category consistent), else
          //  3. TRUE when this entry has a subcategory — a sub-categorized item is
          //     a stockable material, so it should capture qty × price and cascade
          //     to inventory by default, else
          //  4. the seed default for known material categories.
          const existing = state.entries.find((e) => norm(e.category) === norm(cat));
          const q =
            quantifiable ??
            existing?.quantifiable ??
            (sub !== '' ? true : QUANTIFIABLE_CATEGORIES.has(cat));
          // Bookkeeping default resolves with precedence:
          //  1. explicit argument (canonicalized), else
          //  2. an existing sibling row in the same category (keep a category's
          //     default consistent across its subcategories).
          const explicitClass = canonicalClassification(bookkeeping?.accountingClassification ?? '');
          const explicitType = canonicalExpenseType(bookkeeping?.expenseType ?? '');
          const accountingClassification =
            explicitClass || existing?.accountingClassification || '';
          const expenseType = explicitType || existing?.expenseType || '';
          return {
            entries: [
              ...state.entries,
              entry(cat, sub, q, { accountingClassification, expenseType }),
            ],
          };
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

      setBookkeeping: (id, accountingClassification, expenseType) =>
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id
              ? {
                  ...e,
                  accountingClassification: canonicalClassification(accountingClassification),
                  expenseType: canonicalExpenseType(expenseType),
                  updatedAt: now(),
                }
              : e,
          ),
        })),

      bookkeepingFor: (category, subcategory) => {
        const norm = (s: string) => s.trim().toLowerCase();
        const entries = get().entries;
        // Prefer the exact (category, subcategory) row, then any sibling row in
        // the same category that carries a default (a category-wide fallback).
        const exact = entries.find(
          (e) => norm(e.category) === norm(category) && norm(e.subcategory) === norm(subcategory),
        );
        const sibling = entries.find(
          (e) => norm(e.category) === norm(category) && (e.accountingClassification || e.expenseType),
        );
        const src = exact?.accountingClassification || exact?.expenseType ? exact : sibling;
        // Generic fallback so an expense is NEVER left unclassified — a category
        // with no seeded default (e.g. a brand-new "Tools / Hammer") still books
        // to the most common treatment. Overridable by the user in the form.
        return {
          accountingClassification: src?.accountingClassification || DEFAULT_ACCOUNTING_CLASSIFICATION,
          expenseType: src?.expenseType || DEFAULT_EXPENSE_TYPE,
        };
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
          const needsUtilitiesMigration = state._seeded < 8;
          state.entries = SEED_ENTRIES;
          state._seeded = SEED_VERSION;
          // Rewrite existing expense/vendor records that used the old top-level
          // Electricity/Water/Internet categories into (Utilities, <name>).
          // Deferred so the other stores are hydrated before we touch them.
          if (needsUtilitiesMigration) {
            setTimeout(() => migrateUtilities(), 0);
          }
        }
      },
    }
  )
);
