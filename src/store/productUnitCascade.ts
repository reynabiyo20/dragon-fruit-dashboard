/**
 * Cascade a Product's unit to every other store that carries a unit for the SAME
 * (category, subcategory) identity, so a unit set/changed on the Products page
 * (the source of truth for a variety's unit) stays consistent everywhere:
 *   - Inventory rows (one per category+subcategory).
 *   - Vendor-product catalog entries.
 *   - Expenses — the flat single-line unit AND per-item units.
 *
 * Sales lines carry no unit, so they're not part of this cascade.
 *
 * Cross-store writes use lazy getState() (not top-level imports) to avoid import
 * cycles, matching the taxonomy-rename cascades elsewhere. Matching is tolerant
 * (case + whitespace-insensitive) so casing drift doesn't skip a record.
 */
import { useInventoryStore } from './inventoryStore';
import { useVendorProductStore } from './vendorProductStore';
import { useExpenseStore } from './expenseStore';
import type { ExpenseItem } from '../types';

const norm = (s: string) => s.trim().toLowerCase();
const samePair = (aCat: string, aSub: string, bCat: string, bSub: string) =>
  norm(aCat) === norm(bCat) && norm(aSub) === norm(bSub);

/**
 * Push `unit` to inventory, vendor-products, and expenses for the given
 * (category, subcategory). No-op when the unit is blank. Idempotent — skips
 * records that already carry the same unit.
 */
export function cascadeProductUnit(category: string, subcategory: string, unit: string): void {
  const u = unit.trim();
  if (!u) return;
  const cat = category.trim();
  const sub = subcategory.trim();
  if (!cat) return;

  // 1. Inventory row (one per category+subcategory).
  const { findByCategorySub, updateItem } = useInventoryStore.getState();
  const invRow = findByCategorySub(cat, sub);
  if (invRow && norm(invRow.unit) !== norm(u)) {
    updateItem(invRow.id, { unit: u });
  }

  // 2. Vendor-product catalog entries with this identity.
  const { products: vendorProducts, updateProduct: updateVendorProduct } = useVendorProductStore.getState();
  vendorProducts
    .filter((p) => samePair(p.category, p.subcategory, cat, sub) && norm(p.unit) !== norm(u))
    .forEach((p) => updateVendorProduct(p.id, { unit: u }));

  // 3. Expenses — flat single-line unit + per-item units.
  const { expenses, updateExpense } = useExpenseStore.getState();
  expenses.forEach((e) => {
    const items = e.items ?? [];
    const flatMatch = samePair(e.category, e.subcategory ?? '', cat, sub) && norm(e.unit ?? '') !== norm(u);
    const itemMatch = items.some(
      (it) => samePair(it.category, it.subcategory ?? '', cat, sub) && norm(it.unit ?? '') !== norm(u),
    );
    if (!flatMatch && !itemMatch) return;

    const nextItems: ExpenseItem[] = itemMatch
      ? items.map((it) =>
          samePair(it.category, it.subcategory ?? '', cat, sub) ? { ...it, unit: u } : it,
        )
      : items;

    updateExpense(e.id, {
      unit: flatMatch ? u : e.unit,
      items: items.length ? nextItems : undefined,
    });
  });
}
