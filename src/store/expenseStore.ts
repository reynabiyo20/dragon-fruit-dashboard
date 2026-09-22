import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Expense, Currency } from '../types';
import { generateId, now } from '../utils/id';
import { categoryLabel } from '../utils/format';
import {
  recordExpenseInventory, reverseExpenseInventory,
  recordExpenseReplantBatch, reverseExpenseReplantBatch,
} from './inventoryLink';

/** Bucket for expenses missing an accounting classification / expense type. */
export const UNCLASSIFIED_LABEL = 'Unclassified';

/**
 * A stable string of just the fields that feed inventory `purchased` (category,
 * subcategory, quantity, unit, unit price — flat and per-item). Two expenses
 * with the same signature affect inventory identically, so an edit that leaves
 * the signature unchanged (e.g. editing Notes) needs no inventory reconciliation.
 */
function purchaseSignature(e: Expense): string {
  // Include cuttingType, vendor, and date too: for a "replant" cutting expense
  // these feed the Propagation batch (cost/type/vendor/planting date), so a change
  // to any of them must trigger the reverse/re-record reconcile.
  const flat = `${e.category}|${e.subcategory}|${e.quantity ?? 0}|${e.unit ?? ''}|${e.unitPrice ?? 0}|${e.cuttingState ?? ''}|${e.cuttingType ?? ''}|${e.vendorId ?? ''}|${e.date ?? ''}`;
  const items = (e.items ?? [])
    .map((it) => `${it.category}|${it.subcategory}|${it.quantity}|${it.unit ?? ''}|${it.unitPrice ?? 0}|${it.cuttingState ?? ''}|${it.cuttingType ?? ''}`)
    .join(';');
  return `${flat}#${items}`;
}

/** A single dated price observation for a supply */
export interface SupplyPricePoint {
  date: string;
  vendorId: string;
  vendorName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  expenseId: string;
}

/** A priced observation flattened from an expense (one per item, or one from flat fields). */
interface PricedObservation {
  category: string;
  subcategory: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

/**
 * Flatten an expense into priced observations. Multi-item expenses yield one per
 * item; single-line / legacy expenses yield one from the flat fields. Only lines
 * with a positive unit price are returned (they're the price observations).
 */
function pricedObservations(e: Expense): PricedObservation[] {
  if (e.items && e.items.length > 0) {
    return e.items
      .filter((it) => it.unitPrice > 0)
      .map((it) => ({
        category: it.category,
        subcategory: it.subcategory ?? '',
        quantity: it.quantity,
        unit: it.unit ?? '',
        unitPrice: it.unitPrice,
      }));
  }
  if (e.unitPrice > 0) {
    return [
      {
        category: e.category,
        subcategory: e.subcategory ?? '',
        quantity: e.quantity,
        unit: e.unit ?? '',
        unitPrice: e.unitPrice,
      },
    ];
  }
  return [];
}

/**
 * Attribute an expense's amount across categories. Multi-item expenses split by
 * each item's category (using the combined "Base – Sub" label); single-line
 * expenses attribute the whole amount to their `category`.
 */
function amountByCategory(e: Expense): Record<string, number> {
  const out: Record<string, number> = {};
  if (e.items && e.items.length > 0) {
    e.items.forEach((it) => {
      const label = categoryLabel(it.category, it.subcategory);
      out[label] = (out[label] ?? 0) + (Number(it.total) || 0);
    });
    return out;
  }
  const label = categoryLabel(e.category, e.subcategory);
  out[label] = (out[label] ?? 0) + e.amount;
  return out;
}

/** Sum of item totals for a multi-item expense (used to derive `amount`). */
function itemsTotal(items: Expense['items']): number {
  return (items ?? []).reduce((sum, it) => sum + (Number(it.total) || 0), 0);
}

interface ExpenseState {
  expenses: Expense[];
  addExpense: (data: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>) => Expense;
  updateExpense: (id: string, data: Partial<Omit<Expense, 'id' | 'createdAt'>>) => void;
  deleteExpense: (id: string) => void;
  getExpense: (id: string) => Expense | undefined;
  /** Total spend for a currency (default 'PHP'). PHP and USD are never mixed. */
  totalExpenses: (currency?: Currency) => number;
  totalByCategory: () => Record<string, number>;
  /**
   * Total spend grouped by accounting classification (CapEx / OpEx / COGS …).
   * The classification is an expense-level bookkeeping attribute, so the whole
   * amount is attributed to it. Expenses without one fall into `Unclassified`.
   */
  totalByAccountingClassification: () => Record<string, number>;
  /**
   * Total spend grouped by expense type / cost behavior (Fixed / Variable /
   * Semi-Variable …). Expenses without one fall into `Unclassified`.
   */
  totalByExpenseType: () => Record<string, number>;
  /**
   * Most recent unit price recorded for a supply, for prefill.
   * Prefers a match on the same vendor; falls back to any vendor.
   * Returns undefined when there's no priced history.
   */
  latestUnitPrice: (category: string, subcategory: string, vendorId?: string) => number | undefined;
  /** Full price history for a supply (only expenses with a unit price), sorted by date asc */
  supplyPriceHistory: (category: string, subcategory: string) => SupplyPricePoint[];
  /** Distinct supplies that have at least one priced expense: "Category – Subcategory" */
  pricedSupplies: () => { category: string; subcategory: string; label: string }[];
}

export const useExpenseStore = create<ExpenseState>()(
  persist(
    (set, get) => ({
      expenses: [],

      addExpense: (data) => {
        const hasItems = !!data.items && data.items.length > 0;
        const expense: Expense = {
          ...data,
          // Fallbacks for fields older callers may omit
          quantity: data.quantity ?? 0,
          unit: data.unit ?? '',
          unitPrice: data.unitPrice ?? 0,
          category: data.category,
          subcategory: data.subcategory ?? '',
          // Multi-item: amount is always the sum of item totals
          amount: hasItems ? itemsTotal(data.items) : data.amount,
          id: generateId(),
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ expenses: [...state.expenses, expense] }));
        // Add purchased material quantities to inventory (warns on unmatched).
        recordExpenseInventory(expense);
        // Cuttings flagged "For replant" create a Propagation batch (source
        // Purchased) instead of a sellable pool — kept in sync here.
        recordExpenseReplantBatch(expense);
        return expense;
      },

      updateExpense: (id, data) => {
        // Reverse the previous purchase's inventory effect, then apply the new
        // one, so editing an expense keeps inventory `purchased` consistent.
        const prev = get().expenses.find((e) => e.id === id);
        // A Paid expense is locked: its recorded amount/vendor/items must not
        // drift after money changed hands. The only edit permitted on a paid
        // row is the status itself (paid → false), which unlocks it. Any patch
        // that would change other fields while the row stays paid is rejected.
        if (prev?.paid) {
          const keys = Object.keys(data) as (keyof typeof data)[];
          const staysPaid = data.paid !== false;
          const changesOtherFields = keys.some((k) => k !== 'paid');
          if (staysPaid && changesOtherFields) {
            if (import.meta.env.DEV) {
              console.warn(`[expenseStore] Blocked edit to paid expense ${id}. Set it to Pending first.`);
            }
            return;
          }
        }
        let next: Expense | undefined;
        set((state) => ({
          expenses: state.expenses.map((e) => {
            if (e.id !== id) return e;
            const merged = { ...e, ...data, updatedAt: now() };
            // Keep amount consistent with items when the expense is multi-item
            if (merged.items && merged.items.length > 0) {
              merged.amount = itemsTotal(merged.items);
            }
            next = merged;
            return next;
          }),
        }));
        // Only reconcile inventory when a purchase-relevant field actually
        // changed. This lets lightweight edits (e.g. an inline Notes or Paid
        // toggle from the table) skip the reverse/re-record churn and any
        // spurious "unmatched line" warnings.
        if (prev && next && purchaseSignature(prev) !== purchaseSignature(next)) {
          reverseExpenseInventory(prev);
          recordExpenseInventory(next);
          // Keep the Propagation replant batch in step: reverse the old batch
          // (also cleans up when a line changed away from replant), then record
          // the new one. recordVendorPurchase is idempotent by expense id +
          // variety, so a replant line that's unchanged updates in place.
          reverseExpenseReplantBatch(prev);
          recordExpenseReplantBatch(next);
        }
      },

      deleteExpense: (id) => {
        const target = get().expenses.find((e) => e.id === id);
        // A Paid expense is locked from deletion — deleting it would silently
        // reverse its inventory/dashboard/KPI effects after money changed
        // hands. The user must set it to Pending first to unlock deletion.
        if (target?.paid) {
          if (import.meta.env.DEV) {
            console.warn(`[expenseStore] Blocked delete of paid expense ${id}. Set it to Pending first.`);
          }
          return;
        }
        set((state) => ({ expenses: state.expenses.filter((e) => e.id !== id) }));
        // Remove the previously-added purchased quantity from inventory.
        if (target) reverseExpenseInventory(target);
        // Remove any Propagation replant batch this expense created.
        if (target) reverseExpenseReplantBatch(target);
      },

      getExpense: (id) => get().expenses.find((e) => e.id === id),

      totalExpenses: (currency = 'PHP') =>
        get().expenses.filter((e) => (e.currency ?? 'PHP') === currency).reduce((sum, e) => sum + e.amount, 0),

      // Category / classification / type breakdowns are PHP-only so charts never
      // mix currencies. International (USD) spend is reported separately.
      totalByCategory: () =>
        get().expenses.filter((e) => (e.currency ?? 'PHP') === 'PHP').reduce<Record<string, number>>((acc, e) => {
          const byCat = amountByCategory(e);
          for (const [label, amt] of Object.entries(byCat)) {
            acc[label] = (acc[label] ?? 0) + amt;
          }
          return acc;
        }, {}),

      totalByAccountingClassification: () =>
        get().expenses.filter((e) => (e.currency ?? 'PHP') === 'PHP').reduce<Record<string, number>>((acc, e) => {
          const label = (e.accountingClassification ?? '').trim() || UNCLASSIFIED_LABEL;
          acc[label] = (acc[label] ?? 0) + e.amount;
          return acc;
        }, {}),

      totalByExpenseType: () =>
        get().expenses.filter((e) => (e.currency ?? 'PHP') === 'PHP').reduce<Record<string, number>>((acc, e) => {
          const label = (e.expenseType ?? '').trim() || UNCLASSIFIED_LABEL;
          acc[label] = (acc[label] ?? 0) + e.amount;
          return acc;
        }, {}),

      latestUnitPrice: (category, subcategory, vendorId) => {
        // Flatten every expense into (observation + its vendor/date) and match
        const matches = get()
          .expenses.flatMap((e) =>
            pricedObservations(e)
              .filter((o) => o.category === category && o.subcategory === subcategory)
              .map((o) => ({ unitPrice: o.unitPrice, vendorId: e.vendorId, date: e.date }))
          )
          .sort((a, b) => b.date.localeCompare(a.date)); // most recent first

        if (matches.length === 0) return undefined;

        // Prefer the same vendor if one is given and has history
        if (vendorId) {
          const sameVendor = matches.find((m) => m.vendorId === vendorId);
          if (sameVendor) return sameVendor.unitPrice;
        }
        return matches[0].unitPrice;
      },

      supplyPriceHistory: (category, subcategory) =>
        get()
          .expenses.flatMap((e) =>
            pricedObservations(e)
              .filter((o) => o.category === category && o.subcategory === subcategory)
              .map((o) => ({
                date: e.date,
                vendorId: e.vendorId,
                vendorName: e.vendorName,
                quantity: o.quantity,
                unit: o.unit,
                unitPrice: o.unitPrice,
                expenseId: e.id,
              }))
          )
          .sort((a, b) => a.date.localeCompare(b.date)),

      pricedSupplies: () => {
        const seen = new Map<string, { category: string; subcategory: string; label: string }>();
        get().expenses.forEach((e) => {
          pricedObservations(e).forEach((o) => {
            const key = `${o.category}||${o.subcategory}`;
            if (!seen.has(key)) {
              seen.set(key, {
                category: o.category,
                subcategory: o.subcategory,
                label: categoryLabel(o.category, o.subcategory),
              });
            }
          });
        });
        return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
      },
    }),
    { name: 'dfd-expenses' }
  )
);
