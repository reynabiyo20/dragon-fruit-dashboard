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
import type { Sale, SaleItem, Expense, CuttingPurchaseState } from '../types';
import { CUTTINGS_PRODUCT_TYPE } from '../constants';
import { useInventoryStore } from './inventoryStore';
import { useProductStore } from './productStore';

/**
 * Inspect a sale's inventory-linked lines and report any with no matching
 * inventory row. This NO LONGER changes `sold`: every inventory-linked product
 * (Cuttings / Fruit / Fertilizer) now moves out of inventory on "Received by
 * Customer", driven by the delivery cascade (applyDeliveryToAvailable) — never
 * on the sale record itself. This keeps a sale that hasn't been received yet
 * from prematurely depleting stock.
 *
 * Returns the human labels of lines whose product can't be resolved (so we
 * can't map them to a (category, subcategory) inventory row). Every resolvable
 * product is inventory-tracked now — its row is auto-created on receipt — so the
 * only "unmatched" case left is a line with no product behind it.
 */
function collectUnmatchedSaleLines(sale: Pick<Sale, 'items'>): string[] {
  const { getProduct } = useProductStore.getState();
  const unmatched: string[] = [];

  sale.items.forEach((item: SaleItem) => {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return;

    const product = item.productId ? getProduct(item.productId) : undefined;
    // Without a resolvable product we can't know the (category, subcategory) pair.
    if (!product) unmatched.push(item.productName || 'Unknown product');
  });

  return unmatched;
}

/** Surface a single grouped warning toast for sale lines with no product behind them. */
function warnUnmatched(labels: string[]): void {
  if (labels.length === 0) return;
  const list = [...new Set(labels)].join(', ');
  toast(
    `Couldn't link ${list} to a product, so it won't be tracked in inventory. Pick a product for that line.`,
    { icon: '⚠️', duration: 6000 },
  );
}

/**
 * Record a new sale. Inventory `sold` is NOT changed here — it only moves when
 * the sale is marked "Received by Customer" (see recordDeliveryInventory, which
 * auto-creates the inventory row for any product if needed). We still warn about
 * lines that have no product behind them, since those can't be tracked.
 */
export function recordSaleInventory(sale: Pick<Sale, 'items'>): void {
  warnUnmatched(collectUnmatchedSaleLines(sale));
}

/**
 * Reverse a sale (delete, or the "before" side of an edit). No `sold` change is
 * needed because the sale record never moved `sold`; the received cascade owns
 * that and is reversed separately when a received sale is deleted/edited.
 */
export function reverseSaleInventory(_sale: Pick<Sale, 'items'>): void {
  // Intentionally a no-op: sold is driven solely by the received cascade.
}

/** A normalized purchase line: (category, subcategory, quantity). */
interface PurchaseLine {
  category: string;
  subcategory: string;
  quantity: number;
  unit: string;
  unitCost: number;
  /** Cuttings only: 'packed' | 'bare'. Defaults to 'packed' when unspecified. */
  cuttingState: CuttingPurchaseState;
}

/**
 * Flatten an expense into its purchase lines. Multi-item expenses contribute one
 * line per item; single-line / legacy expenses contribute one line from the flat
 * category/subcategory/quantity fields. Unit and unit price are carried so a
 * newly-auto-created inventory row can be seeded with them.
 */
function purchaseLines(
  expense: Pick<Expense, 'category' | 'subcategory' | 'quantity' | 'unit' | 'unitPrice' | 'items' | 'cuttingState'>,
): PurchaseLine[] {
  if (expense.items && expense.items.length > 0) {
    return expense.items.map((it) => ({
      category: it.category,
      subcategory: it.subcategory,
      quantity: Number(it.quantity) || 0,
      unit: it.unit ?? '',
      unitCost: Number(it.unitPrice) || 0,
      cuttingState: it.cuttingState ?? 'packed',
    }));
  }
  return [
    {
      category: expense.category,
      subcategory: expense.subcategory,
      quantity: Number(expense.quantity) || 0,
      unit: expense.unit ?? '',
      unitCost: Number(expense.unitPrice) || 0,
      cuttingState: expense.cuttingState ?? 'packed',
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
  'category' | 'subcategory' | 'quantity' | 'unit' | 'unitPrice' | 'items' | 'cuttingState'
>;

/** True when a purchase line is a cuttings line (routed by packed/bare state). */
function isCuttingLine(line: PurchaseLine): boolean {
  return line.category.trim().toLowerCase() === CUTTINGS_PRODUCT_TYPE.toLowerCase();
}

/**
 * Record a new purchase into inventory. EVERY purchased line (any category)
 * increases stock, so inventory tracks everything the business buys — both goods
 * it resells and supplies it only consumes. When no inventory row exists yet for
 * a line's (category, subcategory), one is created and seeded with the purchase's
 * unit and unit cost; otherwise the existing row's `purchased` is increased.
 */
export function recordExpenseInventory(expense: ExpenseInventoryInput): void {
  const {
    findByCategorySub, adjustPurchased, addItem, ensureRow, adjustPacked,
    adjustAvailableForSale, adjustNeedsPacking,
  } = useInventoryStore.getState();

  purchaseLines(expense).forEach((line) => {
    if (!isPurchase(line)) return;

    // Cuttings bought from a customer don't go into the generic `purchased`
    // pool — they land in a cutting pool based on whether they arrive packed
    // (ready to sell) or bare (still need packing). Both feed endingQty.
    if (isCuttingLine(line)) {
      const row = ensureRow(line.category, line.subcategory, line.unit || 'piece');
      if (line.cuttingState === 'bare') {
        adjustNeedsPacking(row.id, line.quantity);
      } else {
        adjustPacked(row.id, line.quantity);
        adjustAvailableForSale(row.id, line.quantity);
      }
      return;
    }

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
 * line's quantity from the matching inventory row's pool. Cuttings reverse from
 * the same pool they were recorded into (packed+availableForSale, or
 * needsPacking); everything else reverses from `purchased`. Never creates rows —
 * a purchase being reversed will have created its row on the original record.
 */
export function reverseExpenseInventory(expense: ExpenseInventoryInput): void {
  const {
    findByCategorySub, adjustPurchased, adjustPacked, adjustAvailableForSale,
    adjustNeedsPacking,
  } = useInventoryStore.getState();

  purchaseLines(expense).forEach((line) => {
    if (!isPurchase(line)) return;
    const row = findByCategorySub(line.category, line.subcategory);
    if (!row) return;

    if (isCuttingLine(line)) {
      if (line.cuttingState === 'bare') {
        adjustNeedsPacking(row.id, -line.quantity);
      } else {
        adjustPacked(row.id, -line.quantity);
        adjustAvailableForSale(row.id, -line.quantity);
      }
      return;
    }
    adjustPurchased(row.id, -line.quantity);
  });
}

/**
 * "Received by Customer" fulfillment → inventory `sold` (and, for cuttings, the
 * Available-Stock-for-Sale pool).
 *
 * Everything the business sells is tracked in inventory, so when a sale line for
 * ANY product is marked received, its quantity is added to that product's
 * inventory row `sold` (which the ending-qty formula subtracts). If no inventory
 * row exists yet for the product's (category, subcategory) — e.g. a one-off
 * "Other → Jacket" — one is auto-created on receipt so the sale is reflected in
 * inventory. Marking it not-received (or deleting a received sale) returns the
 * quantity.
 *
 * Cuttings additionally draw down the packed Available-Stock-for-Sale pool, since
 * that pool represents cuttings physically packed and ready to hand over.
 *
 * @param sign -1 to deduct on receive, +1 to return on un-receive/reverse.
 */
function applyReceivedToInventory(sale: Pick<Sale, 'items'>, sign: 1 | -1): void {
  const { getProduct } = useProductStore.getState();
  const { findByCategorySub, ensureRow, adjustAvailableForSale, adjustSold } =
    useInventoryStore.getState();

  sale.items.forEach((item: SaleItem) => {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return;
    const product = item.productId ? getProduct(item.productId) : undefined;
    // No resolvable product → can't map to an inventory row. (Warned at sale time.)
    if (!product || !product.category) return;

    // On receive, auto-create the row if missing so nothing sold is lost. On
    // reverse the row must already exist (it was created on the original
    // receive), so just look it up — nothing to do if it's somehow gone.
    const row =
      sign < 0
        ? ensureRow(product.category, product.subcategory, product.unit)
        : findByCategorySub(product.category, product.subcategory);
    if (!row) return;

    // Receiving removes stock from inventory. Increase `sold` (which the
    // ending-qty formula subtracts). Reversing an un-receive does the opposite.
    // sign = -1 on receive, +1 on reverse.
    adjustSold(row.id, -sign * qty); // receive → +sold, reverse → -sold
    // Cuttings also draw from the packed sellable pool.
    if (product.category === CUTTINGS_PRODUCT_TYPE) {
      adjustAvailableForSale(row.id, sign * qty); // receive → -available, reverse → +available
    }
  });
}

/** Record received quantities into inventory `sold` (+ draw the cutting pool). */
export function recordDeliveryInventory(sale: Pick<Sale, 'items'>): void {
  applyReceivedToInventory(sale, -1);
}

/** Return received quantities to inventory (un-receive / reverse). */
export function reverseDeliveryInventory(sale: Pick<Sale, 'items'>): void {
  applyReceivedToInventory(sale, +1);
}
