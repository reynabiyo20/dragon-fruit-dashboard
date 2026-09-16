/**
 * Links Sales and Expenses to Inventory balances.
 *
 * The three domains share one vocabulary (Cuttings / Fruit / Fertilizer as the
 * type, and the variety as the subcategory), so a sold or purchased line maps
 * onto exactly one inventory row via (category, item):
 *   - A SALE of a product deducts its quantity from that row's `sold`.
 *   - A PURCHASE (quantifiable expense) adds its quantity to that row's `purchased`.
 * `endingQty` is recomputed by the inventory store on every adjustment.
 *
 * Edits and deletes stay consistent by reversing the previous effect (passing a
 * negative delta) before applying the new one — callers do this by calling the
 * reverse function with the old line, then the apply function with the new line.
 *
 * Matching is tolerant (case- and whitespace-insensitive). Lines with no
 * matching inventory row (e.g. Drink, which is tracked manually) are collected
 * and surfaced to the user as a warning rather than silently ignored.
 */
import toast from 'react-hot-toast';
import type { Sale, SaleItem, Expense } from '../types';
import { INVENTORY_LINKED_TYPES, CUTTINGS_PRODUCT_TYPE } from '../constants';
import { categoryLabel } from '../utils/format';
import { useInventoryStore } from './inventoryStore';
import { useProductStore } from './productStore';

/** True when a category is one we mirror into inventory (not Drink/Other). */
function isInventoryLinkedType(category: string): boolean {
  return (INVENTORY_LINKED_TYPES as readonly string[]).includes(category);
}

/**
 * Apply a sale's effect on inventory `sold`.
 * @param sign +1 when recording a sale, -1 when reversing one (edit/delete).
 * Returns the human labels of lines that had no matching inventory row.
 */
function applySaleToInventory(sale: Pick<Sale, 'items'>, sign: 1 | -1): string[] {
  const { getProduct } = useProductStore.getState();
  const { findByCategorySub, adjustSold } = useInventoryStore.getState();
  const unmatched: string[] = [];

  sale.items.forEach((item: SaleItem) => {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return;

    const product = item.productId ? getProduct(item.productId) : undefined;
    // Without a resolvable product we can't know the (category, subcategory) pair.
    if (!product) {
      unmatched.push(item.productName || 'Unknown product');
      return;
    }
    // Drink / Other aren't inventory-tracked here — skip silently, no warning.
    if (!isInventoryLinkedType(product.category)) return;

    const row = findByCategorySub(product.category, product.subcategory);
    if (!row) {
      unmatched.push(categoryLabel(product.category, product.subcategory));
      return;
    }
    adjustSold(row.id, sign * qty);
  });

  return unmatched;
}

/** Surface a single grouped warning toast for lines with no inventory row. */
function warnUnmatched(labels: string[], context: 'sold' | 'purchased'): void {
  if (labels.length === 0) return;
  const unique = [...new Set(labels)];
  const list = unique.join(', ');
  const verb = context === 'sold' ? 'deducted from' : 'added to';
  toast(
    `No inventory row for ${list}. Nothing was ${verb} inventory — update it manually.`,
    { icon: '⚠️', duration: 6000 },
  );
}

/** Record a new sale: deduct each line from inventory `sold`. */
export function recordSaleInventory(sale: Pick<Sale, 'items'>): void {
  const unmatched = applySaleToInventory(sale, +1);
  warnUnmatched(unmatched, 'sold');
}

/** Reverse a sale (delete, or the "before" side of an edit): add quantities back. */
export function reverseSaleInventory(sale: Pick<Sale, 'items'>): void {
  applySaleToInventory(sale, -1);
}

/** A normalized purchase line: (category, subcategory, quantity). */
interface PurchaseLine {
  category: string;
  subcategory: string;
  quantity: number;
  unit: string;
  unitCost: number;
}

/**
 * Flatten an expense into its purchase lines. Multi-item expenses contribute one
 * line per item; single-line / legacy expenses contribute one line from the flat
 * category/subcategory/quantity fields. Unit and unit price are carried so a
 * newly-auto-created inventory row can be seeded with them.
 */
function purchaseLines(
  expense: Pick<Expense, 'category' | 'subcategory' | 'quantity' | 'unit' | 'unitPrice' | 'items'>,
): PurchaseLine[] {
  if (expense.items && expense.items.length > 0) {
    return expense.items.map((it) => ({
      category: it.category,
      subcategory: it.subcategory,
      quantity: Number(it.quantity) || 0,
      unit: it.unit ?? '',
      unitCost: Number(it.unitPrice) || 0,
    }));
  }
  return [
    {
      category: expense.category,
      subcategory: expense.subcategory,
      quantity: Number(expense.quantity) || 0,
      unit: expense.unit ?? '',
      unitCost: Number(expense.unitPrice) || 0,
    },
  ];
}

/**
 * Whether a purchase line should feed inventory: a positive quantity and a real
 * category + subcategory.
 */
function isPurchase(line: PurchaseLine): boolean {
  return line.quantity > 0 && !!line.category && !!line.subcategory;
}

type ExpenseInventoryInput = Pick<
  Expense,
  'category' | 'subcategory' | 'quantity' | 'unit' | 'unitPrice' | 'items'
>;

/**
 * Record a new purchase into inventory. EVERY purchased line (any category)
 * increases stock, so inventory tracks everything the business buys — both goods
 * it resells and supplies it only consumes. When no inventory row exists yet for
 * a line's (category, subcategory), one is created and seeded with the purchase's
 * unit and unit cost; otherwise the existing row's `purchased` is increased.
 */
export function recordExpenseInventory(expense: ExpenseInventoryInput): void {
  const { findByCategorySub, adjustPurchased, addItem } = useInventoryStore.getState();

  purchaseLines(expense).forEach((line) => {
    if (!isPurchase(line)) return;

    const row = findByCategorySub(line.category, line.subcategory);
    if (row) {
      adjustPurchased(row.id, line.quantity);
      return;
    }
    // Auto-create the inventory row so nothing purchased is lost.
    addItem({
      category: line.category,
      subcategory: line.subcategory,
      unit: line.unit,
      beginningQty: 0,
      purchased: line.quantity,
      used: 0,
      sold: 0,
      unitCost: line.unitCost,
      notes: '',
    });
  });
}

/**
 * Reverse a purchase (delete, or the "before" side of an edit): subtract each
 * line's quantity from the matching inventory row's `purchased`. Never creates
 * rows — a purchase being reversed will have created its row on the original record.
 */
export function reverseExpenseInventory(expense: ExpenseInventoryInput): void {
  const { findByCategorySub, adjustPurchased } = useInventoryStore.getState();

  purchaseLines(expense).forEach((line) => {
    if (!isPurchase(line)) return;
    const row = findByCategorySub(line.category, line.subcategory);
    if (row) adjustPurchased(row.id, -line.quantity);
  });
}

/**
 * Delivery fulfillment → Available-Stock-for-Sale pool.
 *
 * When a cutting sale is marked delivered, the sold cutting quantities are
 * permanently removed from the Available-Stock-for-Sale pool for each variety.
 * Marking it undelivered (or deleting a delivered sale) returns the quantity.
 *
 * @param sign -1 to deduct on delivery, +1 to return on un-deliver/reverse.
 */
function applyDeliveryToAvailable(sale: Pick<Sale, 'items'>, sign: 1 | -1): void {
  const { getProduct } = useProductStore.getState();
  const { findByCategorySub, adjustAvailableForSale } = useInventoryStore.getState();

  sale.items.forEach((item: SaleItem) => {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return;
    const product = item.productId ? getProduct(item.productId) : undefined;
    if (!product || product.category !== CUTTINGS_PRODUCT_TYPE) return;
    const row = findByCategorySub(product.category, product.subcategory);
    if (!row) return; // no allocated pool for this variety yet — nothing to deduct
    adjustAvailableForSale(row.id, sign * qty);
  });
}

/** Deduct delivered cutting quantities from the Available-Stock-for-Sale pool. */
export function recordDeliveryInventory(sale: Pick<Sale, 'items'>): void {
  applyDeliveryToAvailable(sale, -1);
}

/** Return cutting quantities to the Available-Stock-for-Sale pool (un-deliver/reverse). */
export function reverseDeliveryInventory(sale: Pick<Sale, 'items'>): void {
  applyDeliveryToAvailable(sale, +1);
}
