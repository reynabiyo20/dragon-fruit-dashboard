import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Sale, SaleItem } from '../types';
import { generateId, now } from '../utils/id';
import { todayISO } from '../utils/date';
import {
  recordSaleInventory, reverseSaleInventory,
  recordDeliveryInventory, reverseDeliveryInventory,
} from './inventoryLink';

/** Recalculate item totals and subtotal */
function calcSale(items: SaleItem[]): { items: SaleItem[]; subtotal: number } {
  const recalculated = items.map((item) => ({
    ...item,
    total: item.quantity * item.unitPrice,
  }));
  const subtotal = recalculated.reduce((sum, i) => sum + i.total, 0);
  return { items: recalculated, subtotal };
}

type NewSaleInput = Omit<Sale, 'id' | 'subtotal' | 'createdAt' | 'updatedAt'> & {
  items: Omit<SaleItem, 'total'>[];
};

interface SaleState {
  sales: Sale[];
  addSale: (data: NewSaleInput) => Sale;
  updateSale: (id: string, data: Partial<Omit<Sale, 'id' | 'createdAt'>>) => void;
  deleteSale: (id: string) => void;
  getSale: (id: string) => Sale | undefined;
  /** Totals derived from all sales */
  totalRevenue: () => number;
  totalPaid: () => number;
  totalUnpaid: () => number;
  /** Dated selling-price observations for a product, from sale line items (asc by date) */
  productPriceHistory: (productId: string) => { date: string; unitPrice: number; quantity: number; saleId: string }[];
  /** Distinct products that appear in at least one sale */
  soldProducts: () => { productId: string; productName: string }[];
}

export const useSaleStore = create<SaleState>()(
  persist(
    (set, get) => ({
      sales: [],

      addSale: (data) => {
        const { items, subtotal } = calcSale(data.items as SaleItem[]);
        const sale: Sale = {
          ...data,
          items,
          subtotal,
          // Stamp the delivery date if the sale is created already-delivered.
          deliveredDate: data.delivered ? (data.deliveredDate || todayISO()) : '',
          id: generateId(),
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ sales: [...state.sales, sale] }));
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
        set((state) => ({
          sales: state.sales.map((s) => {
            if (s.id !== id) return s;
            const merged = { ...s, ...data, updatedAt: now() };
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
        set((state) => ({ sales: state.sales.filter((s) => s.id !== id) }));
        // Restore the sold quantities back to inventory.
        if (target) {
          reverseSaleInventory(target);
          // Return any delivered cuttings to the Available-Stock-for-Sale pool.
          if (target.delivered) reverseDeliveryInventory(target);
        }
      },

      getSale: (id) => get().sales.find((s) => s.id === id),

      totalRevenue: () => get().sales.reduce((sum, s) => sum + s.subtotal, 0),
      totalPaid: () => get().sales.filter((s) => s.paid).reduce((sum, s) => sum + s.subtotal, 0),
      totalUnpaid: () => get().sales.filter((s) => !s.paid).reduce((sum, s) => sum + s.subtotal, 0),

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
      version: 1,
      // Rename any legacy `customerType` on a sale to `saleType`. Sales predating
      // the field simply get an empty saleType (reported as "Uncategorized").
      migrate: (persisted: unknown, version: number): SaleState => {
        const state = persisted as SaleState;
        if (version < 1 && Array.isArray(state?.sales)) {
          state.sales = state.sales.map((raw) => {
            const legacy = raw as Sale & { customerType?: string };
            if (legacy.saleType !== undefined) return legacy;
            const { customerType, ...rest } = legacy;
            return { ...rest, saleType: customerType ?? '' };
          });
        }
        return state;
      },
    }
  )
);
