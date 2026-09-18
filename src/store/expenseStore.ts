import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Expense } from '../types';
import { generateId, now } from '../utils/id';
import { categoryLabel } from '../utils/format';
import { recordExpenseInventory, reverseExpenseInventory } from './inventoryLink';

/**
 * A stable string of just the fields that feed inventory `purchased` (category,
 * subcategory, quantity, unit, unit price — flat and per-item). Two expenses
 * with the same signature affect inventory identically, so an edit that leaves
 * the signature unchanged (e.g. editing Notes) needs no inventory reconciliation.
 */
function purchaseSignature(e: Expense): string {
  const flat = `${e.category}|${e.subcategory}|${e.quantity ?? 0}|${e.unit ?? ''}|${e.unitPrice ?? 0}|${e.cuttingState ?? ''}`;
  const items = (e.items ?? [])
    .map((it) => `${it.category}|${it.subcategory}|${it.quantity}|${it.unit ?? ''}|${it.unitPrice ?? 0}|${it.cuttingState ?? ''}`)
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
  totalExpenses: () => number;
  totalByCategory: () => Record<string, number>;
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
        return expense;
      },

      updateExpense: (id, data) => {
        // Reverse the previous purchase's inventory effect, then apply the new
        // one, so editing an expense keeps inventory `purchased` consistent.
        const prev = get().expenses.find((e) => e.id === id);
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
        }
      },

      deleteExpense: (id) => {
        const target = get().expenses.find((e) => e.id === id);
        set((state) => ({ expenses: state.expenses.filter((e) => e.id !== id) }));
        // Remove the previously-added purchased quantity from inventory.
        if (target) reverseExpenseInventory(target);
      },

      getExpense: (id) => get().expenses.find((e) => e.id === id),

      totalExpenses: () => get().expenses.reduce((sum, e) => sum + e.amount, 0),

      totalByCategory: () =>
        get().expenses.reduce<Record<string, number>>((acc, e) => {
          const byCat = amountByCategory(e);
          for (const [label, amt] of Object.entries(byCat)) {
            acc[label] = (acc[label] ?? 0) + amt;
          }
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
