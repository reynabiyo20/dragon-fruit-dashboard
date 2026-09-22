import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Sale, SaleItem, Currency } from '../types';
import { generateId, now } from '../utils/id';
import { todayISO } from '../utils/date';
import {
  generateDraftNumber, isOfficialInvoice, invoiceYearOf,
  formatOfficialNumber, INVOICE_SEQ_START,
} from '../utils/invoice';
import {
  recordSaleInventory, reverseSaleInventory,
  recordDeliveryInventory, reverseDeliveryInventory,
  reverseSaleCommission, reverseSaleCuttings,
} from './inventoryLink';

/**
 * Recalculate each line's total and the sale subtotal.
 *
 * A line total is quantity × (unitPrice + surcharge) — the per-unit surcharge
 * (e.g. the small-order cuttings fee) is part of the price the customer pays, so
 * it MUST be included here to match what the Sale form shows. Omitting it made
 * the stored subtotal (and every revenue KPI derived from it) understate any
 * surcharged sale.
 */
function calcSale(items: SaleItem[]): { items: SaleItem[]; subtotal: number } {
  const recalculated = items.map((item) => ({
    ...item,
    total: item.quantity * (item.unitPrice + (item.surcharge || 0)),
  }));
  const subtotal = recalculated.reduce((sum, i) => sum + i.total, 0);
  return { items: recalculated, subtotal };
}

type NewSaleInput = Omit<Sale, 'id' | 'subtotal' | 'createdAt' | 'updatedAt'> & {
  items: Omit<SaleItem, 'total'>[];
};

interface SaleState {
  sales: Sale[];
  /**
   * Per-year running count of OFFICIAL invoices issued, keyed by year (e.g.
   * { '2026': 4 }). Only bumped when a sale is finalized (paid). Drafts never
   * touch this, so deleting a draft never wastes a sequence slot.
   */
  invoiceCounters: Record<string, number>;
  addSale: (data: NewSaleInput) => Sale;
  updateSale: (id: string, data: Partial<Omit<Sale, 'id' | 'createdAt'>>) => void;
  deleteSale: (id: string) => void;
  getSale: (id: string) => Sale | undefined;
  /**
   * Totals derived from sales, scoped to a currency (default 'PHP'). PHP and USD
   * are never mixed — pass 'USD' to get the international-sales figures.
   */
  totalRevenue: (currency?: Currency) => number;
  totalPaid: (currency?: Currency) => number;
  totalUnpaid: (currency?: Currency) => number;
  /** Dated selling-price observations for a product, from sale line items (asc by date) */
  productPriceHistory: (productId: string) => { date: string; unitPrice: number; quantity: number; saleId: string }[];
  /** Distinct products that appear in at least one sale */
  soldProducts: () => { productId: string; productName: string }[];
}

export const useSaleStore = create<SaleState>()(
  persist(
    (set, get) => ({
      sales: [],
      invoiceCounters: {},

      addSale: (data) => {
        const { items, subtotal } = calcSale(data.items as SaleItem[]);
        // Late-binding invoice number:
        //  - paid on creation → allocate the next OFFICIAL sequential number now.
        //  - otherwise → a throwaway DRAFT id (never consumes a sequence slot).
        // A manually-entered number (rare) is respected as-is.
        let invoiceNumber = data.invoiceNumber?.trim() ?? '';
        let counters = get().invoiceCounters;
        if (!invoiceNumber) {
          if (data.paid) {
            const year = invoiceYearOf(data.date);
            const seq = (counters[year] ?? INVOICE_SEQ_START) + 1;
            invoiceNumber = formatOfficialNumber(year, seq);
            counters = { ...counters, [year]: seq };
          } else {
            invoiceNumber = generateDraftNumber();
          }
        }
        const sale: Sale = {
          ...data,
          invoiceNumber,
          items,
          subtotal,
          // Stamp the delivery date if the sale is created already-delivered.
          deliveredDate: data.delivered ? (data.deliveredDate || todayISO()) : '',
          id: generateId(),
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ sales: [...state.sales, sale], invoiceCounters: counters }));
        // Deduct the sold quantities from inventory (warns on unmatched lines).
        recordSaleInventory(sale);
        // If the sale is already flagged delivered, deduct cuttings from the
        // Available-Stock-for-Sale pool.
        if (sale.delivered) recordDeliveryInventory(sale);
        return sale;
      },

      updateSale: (id, data) => {
        // When the line items change, reverse the previous sale's inventory
        // effect and re-apply the new one so balances stay consistent on edit.
        const prev = get().sales.find((s) => s.id === id);

        // ── Late-binding invoice finalization ───────────────────────────────
        // The moment a sale becomes paid AND still has no official number, stamp
        // it with the next sequential official invoice number. Once official, the
        // number is permanent — later un-paying never reissues or downgrades it.
        let counters = get().invoiceCounters;
        let finalizedInvoice: string | undefined;
        const willBePaid = data.paid ?? prev?.paid ?? false;
        const currentInvoice = data.invoiceNumber ?? prev?.invoiceNumber ?? '';
        if (prev && willBePaid && !isOfficialInvoice(currentInvoice)) {
          const year = invoiceYearOf(data.date ?? prev.date);
          const seq = (counters[year] ?? INVOICE_SEQ_START) + 1;
          finalizedInvoice = formatOfficialNumber(year, seq);
          counters = { ...counters, [year]: seq };
        }

        set((state) => ({
          invoiceCounters: counters,
          sales: state.sales.map((s) => {
            if (s.id !== id) return s;
            const merged = { ...s, ...data, updatedAt: now() };
            // Apply a freshly-allocated official invoice number, if any.
            if (finalizedInvoice) merged.invoiceNumber = finalizedInvoice;
            // Stamp the delivery date when it transitions to delivered; clear it
            // when un-delivered. Preserve an explicitly-provided deliveredDate.
            if (merged.delivered) {
              merged.deliveredDate = data.deliveredDate || s.deliveredDate || todayISO();
            } else {
              merged.deliveredDate = '';
            }
            // Recalculate if items changed
            if (data.items) {
              const { items, subtotal } = calcSale(data.items);
              return { ...merged, items, subtotal };
            }
            return merged;
          }),
        }));
        if (!prev) return;

        // ── Delivery pool sync ──────────────────────────────────────────────
        // Reconcile the Available-Stock-for-Sale deduction across the edit. First
        // undo the previous sale's delivery effect (if it was delivered), then
        // apply the new one (if the updated sale is delivered). This correctly
        // handles delivered↔undelivered toggles AND item/quantity changes on a
        // delivered sale.
        const next = get().sales.find((s) => s.id === id);
        if (prev.delivered) reverseDeliveryInventory(prev);

        if (data.items) {
          reverseSaleInventory(prev);
          const { items } = calcSale(data.items);
          recordSaleInventory({ items });
        }

        if (next?.delivered) recordDeliveryInventory(next);
      },

      deleteSale: (id) => {
        const target = get().sales.find((s) => s.id === id);
        if (!target) return;
        // Deleting a sale must undo EVERYTHING it touched, in every store, so no
        // orphaned records or drifted balances are left behind. This is the single
        // source of truth for the reverse cascade — it runs identically whether
        // the delete came from a row action, a bulk delete, or programmatically.
        // (KPIs/dashboards/charts are derived from the sales array at render time,
        // so removing the sale below is all they need — nothing to reverse there.)
        set((state) => ({ sales: state.sales.filter((s) => s.id !== id) }));

        // 1. Inventory — restore the sold quantities. `sold`/`packed`/available
        //    only moved if the sale was Received, so reverse the delivery effect
        //    for a received sale (Paid+Received included: a full revert returns
        //    the stock the sale had taken out).
        reverseSaleInventory(target);
        if (target.delivered) reverseDeliveryInventory(target);

        // 2. Commissions — drop the salesperson's commission entry for this sale.
        reverseSaleCommission(target.id);

        // 3. Propagation — drop any "Customer"-sourced cutting batch(es) it made,
        //    which also reverses the cutting inventory pools those batches fed.
        reverseSaleCuttings(target.id);
      },

      getSale: (id) => get().sales.find((s) => s.id === id),

      // Currency-scoped totals — a sale's currency defaults to PHP for back-compat.
      totalRevenue: (currency = 'PHP') =>
        get().sales.filter((s) => (s.currency ?? 'PHP') === currency).reduce((sum, s) => sum + s.subtotal, 0),
      totalPaid: (currency = 'PHP') =>
        get().sales.filter((s) => (s.currency ?? 'PHP') === currency && s.paid).reduce((sum, s) => sum + s.subtotal, 0),
      totalUnpaid: (currency = 'PHP') =>
        get().sales.filter((s) => (s.currency ?? 'PHP') === currency && !s.paid).reduce((sum, s) => sum + s.subtotal, 0),

      productPriceHistory: (productId) => {
        const points: { date: string; unitPrice: number; quantity: number; saleId: string }[] = [];
        get().sales.forEach((s) => {
          s.items.forEach((item) => {
            if (item.productId === productId && item.unitPrice > 0) {
              points.push({ date: s.date, unitPrice: item.unitPrice, quantity: item.quantity, saleId: s.id });
            }
          });
        });
        return points.sort((a, b) => a.date.localeCompare(b.date));
      },

      soldProducts: () => {
        const seen = new Map<string, { productId: string; productName: string }>();
        get().sales.forEach((s) => {
          s.items.forEach((item) => {
            if (item.productId && !seen.has(item.productId)) {
              seen.set(item.productId, { productId: item.productId, productName: item.productName });
            }
          });
        });
        return Array.from(seen.values()).sort((a, b) => a.productName.localeCompare(b.productName));
      },
    }),
    {
      name: 'dfd-sales',
      version: 4,
      migrate: (persisted: unknown, version: number): SaleState => {
        const state = persisted as SaleState;
        // v1: rename legacy `customerType` on a sale to `saleType`. Sales predating
        // the field simply get an empty saleType (reported as "Uncategorized").
        if (version < 1 && Array.isArray(state?.sales)) {
          state.sales = state.sales.map((raw) => {
            const legacy = raw as Sale & { customerType?: string };
            if (legacy.saleType !== undefined) return legacy;
            const { customerType, ...rest } = legacy;
            return { ...rest, saleType: customerType ?? '' };
          });
        }
        // v2: introduce late-binding invoice numbers. Grandfather existing sales:
        //  - paid sales without an official number → assigned a sequential
        //    official number (per year, in creation order) so history keeps a
        //    stable, ordered sequence.
        //  - unpaid sales without a number → a throwaway draft id.
        // Seed the per-year counters from the highest number assigned.
        if (version < 2 && Array.isArray(state?.sales)) {
          const counters: Record<string, number> = {};
          // Assign official numbers in a stable order (by created/date) so the
          // grandfathered sequence is deterministic.
          const ordered = [...state.sales].sort((a, b) =>
            (a.createdAt ?? a.date ?? '').localeCompare(b.createdAt ?? b.date ?? ''),
          );
          const assigned = new Map<string, string>();
          for (const s of ordered) {
            const existing = (s.invoiceNumber ?? '').trim();
            if (isOfficialInvoice(existing)) continue; // keep any pre-existing official number
            if (s.paid) {
              const year = invoiceYearOf(s.date);
              const seq = (counters[year] ?? INVOICE_SEQ_START) + 1;
              counters[year] = seq;
              assigned.set(s.id, formatOfficialNumber(year, seq));
            } else if (!existing) {
              assigned.set(s.id, generateDraftNumber());
            }
          }
          state.sales = state.sales.map((s) => {
            const num = assigned.get(s.id);
            return num ? { ...s, invoiceNumber: num } : s;
          });
          state.invoiceCounters = counters;
        }
        if (!state.invoiceCounters) state.invoiceCounters = {};
        // v3: default the sale currency — every existing sale is a local PHP sale.
        if (version < 3 && Array.isArray(state?.sales)) {
          state.sales = state.sales.map((s) => ({ ...s, currency: s.currency ?? 'PHP' }));
        }
        // v4: fix subtotals that were computed WITHOUT the per-unit surcharge, so
        // existing surcharged (cuttings) sales report the correct revenue. Recompute
        // each line total and the subtotal as quantity × (unitPrice + surcharge).
        if (version < 4 && Array.isArray(state?.sales)) {
          state.sales = state.sales.map((s) => {
            const items = (s.items ?? []).map((it) => ({
              ...it,
              total: it.quantity * (it.unitPrice + (it.surcharge || 0)),
            }));
            const subtotal = items.reduce((sum, it) => sum + it.total, 0);
            return { ...s, items, subtotal };
          });
        }
        return state;
      },
    }
  )
);
