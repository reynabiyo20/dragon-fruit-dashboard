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
import type { Sale, SaleItem, Expense, CuttingPurchaseState, ProductionEntry } from '../types';
import { CUTTINGS_PRODUCT_TYPE, FRUIT_PRODUCT_TYPE, CUTTING_TYPE_GRAFTED, isServiceCategory } from '../constants';
import { useInventoryStore } from './inventoryStore';
import { useProductStore } from './productStore';
import { useCuttingStore } from './cuttingStore';
import { useCommissionStore } from './commissionStore';

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
  /** Cuttings only: 'packed' | 'bare' | 'replant'. Defaults to 'packed'. */
  cuttingState: CuttingPurchaseState;
  /** Cuttings + replant only: grafted/rooted vs unrooted, for the batch timeline. */
  cuttingType?: string;
}

/**
 * Flatten an expense into its purchase lines. Multi-item expenses contribute one
 * line per item; single-line / legacy expenses contribute one line from the flat
 * category/subcategory/quantity fields. Unit and unit price are carried so a
 * newly-auto-created inventory row can be seeded with them.
 */
function purchaseLines(
  expense: Pick<Expense, 'category' | 'subcategory' | 'quantity' | 'unit' | 'unitPrice' | 'items' | 'cuttingState' | 'cuttingType'>,
): PurchaseLine[] {
  if (expense.items && expense.items.length > 0) {
    return expense.items.map((it) => ({
      category: it.category,
      subcategory: it.subcategory,
      quantity: Number(it.quantity) || 0,
      unit: it.unit ?? '',
      unitCost: Number(it.unitPrice) || 0,
      cuttingState: it.cuttingState ?? 'packed',
      cuttingType: it.cuttingType,
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
      cuttingType: expense.cuttingType,
    },
  ];
}

/**
 * Whether a purchase line should feed inventory: a positive quantity and a real
 * category + subcategory. Service categories (labor, delivery, utilities, etc.)
 * are logged as expenses but are never stock, so they never create/adjust an
 * inventory row — even if a quantity was entered.
 */
function isPurchase(line: PurchaseLine): boolean {
  return line.quantity > 0 && !!line.category && !!line.subcategory && !isServiceCategory(line.category);
}

type ExpenseInventoryInput = Pick<
  Expense,
  'category' | 'subcategory' | 'quantity' | 'unit' | 'unitPrice' | 'items' | 'cuttingState' | 'cuttingType'
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

    // Cuttings bought from a vendor land in a cutting pool by state:
    //  - 'packed' (default): packed + availableForSale (Ready for Sale)
    //  - 'bare':             needsPacking (on hand, still to pack)
    //  - 'replant':          NO inventory pool here — a Propagation batch (source
    //                        Purchased) owns the breedingStock pool via its
    //                        reserve→plant lifecycle, so crediting a pool here too
    //                        would double-count. The batch is created by the
    //                        expense store's recordVendorPurchase cascade instead.
    if (isCuttingLine(line)) {
      if (line.cuttingState === 'replant') return;
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
      // Replant lines never credited an inventory pool (the batch owns breeding
      // stock), so there's nothing to reverse here.
      if (line.cuttingState === 'replant') return;
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

/* ── Expense → Propagation (replant cuttings) ─────────────────────────────────
 * A cuttings expense flagged "For replant (farm)" (cuttingState === 'replant')
 * does NOT feed a sellable inventory pool. Instead it creates/updates a
 * Propagation batch (source: Purchased) that owns the breedingStock pool through
 * its reserve → plant lifecycle. These helpers bridge the expense store to
 * cuttingStore.recordVendorPurchase / removeVendorPurchase, keyed by expense id +
 * variety so edits update (not duplicate) and deletes reverse cleanly.
 */

type ExpenseReplantInput = Pick<
  Expense,
  'id' | 'date' | 'vendorId' | 'vendorName' | 'category' | 'subcategory' | 'quantity'
  | 'unit' | 'unitPrice' | 'items' | 'cuttingState' | 'cuttingType'
>;

/** True when a purchase line is a cuttings line flagged for replant. */
function isReplantCuttingLine(line: PurchaseLine): boolean {
  return isCuttingLine(line) && line.cuttingState === 'replant' && line.quantity > 0 && !!line.subcategory;
}

/** Create/update the Propagation batch(es) for an expense's replant cutting lines. */
export function recordExpenseReplantBatch(expense: ExpenseReplantInput): void {
  const { recordVendorPurchase } = useCuttingStore.getState();

  // Aggregate replant lines by variety. The batch cascade is keyed by
  // expenseId + variety, so two lines of the SAME variety in one itemized
  // expense must sum into a single batch — otherwise the second would overwrite
  // the first. Cost is quantity-weighted; the first line's cutting type wins.
  const byVariety = new Map<string, { quantity: number; costTotal: number; cuttingType: string }>();
  purchaseLines(expense).forEach((line) => {
    if (!isReplantCuttingLine(line)) return;
    const key = line.subcategory;
    const acc = byVariety.get(key) ?? { quantity: 0, costTotal: 0, cuttingType: line.cuttingType || CUTTING_TYPE_GRAFTED };
    acc.quantity += line.quantity;
    acc.costTotal += line.quantity * line.unitCost;
    byVariety.set(key, acc);
  });

  byVariety.forEach((agg, subcategory) => {
    recordVendorPurchase({
      expenseId: expense.id,
      subcategory,
      quantity: agg.quantity,
      dateBought: expense.date,
      vendorId: expense.vendorId,
      vendorName: expense.vendorName,
      cuttingType: agg.cuttingType,
      sourceCostPerCutting: agg.quantity > 0 ? agg.costTotal / agg.quantity : 0,
    });
  });
}

/** Remove the Propagation batch(es) linked to an expense's replant cutting lines. */
export function reverseExpenseReplantBatch(expense: ExpenseReplantInput): void {
  const { removeVendorPurchase } = useCuttingStore.getState();
  const replantLines = purchaseLines(expense).filter(isReplantCuttingLine);
  if (replantLines.length === 0) {
    // The expense had no replant lines in its NEW state, but an earlier version
    // might have — remove any batch still linked to this expense id, regardless
    // of variety, so a "replant → packed/bare" edit cleans up its old batch.
    removeVendorPurchase(expense.id);
    return;
  }
  replantLines.forEach((line) => removeVendorPurchase(expense.id, line.subcategory));
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
  const { findByCategorySub, ensureRow, adjustAvailableForSale, adjustSold, adjustPacked } =
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
    // Cuttings also draw down the packed pools. The sale hands over cuttings
    // that were physically packed, so both the "Ready for Sale" pool AND the
    // `packed` on-hand pool shrink. `packed` feeds endingQty as `+packed`, so
    // decrementing it here (rather than leaving it inflated) keeps the packed
    // count physically accurate while endingQty stays correct — see calcEnding,
    // which nets the matching `+sold` against this `-packed` for cuttings.
    // Match the Cuttings type tolerantly (case/whitespace) — categories are
    // user-editable at runtime, so a strict === would silently skip a row whose
    // category is stored as e.g. "cuttings" and leave packed/ending untouched.
    if (product.category.trim().toLowerCase() === CUTTINGS_PRODUCT_TYPE.toLowerCase()) {
      adjustAvailableForSale(row.id, sign * qty); // receive → -available, reverse → +available
      adjustPacked(row.id, sign * qty); // receive → -packed, reverse → +packed
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

/* ── Sale → Commissions / Propagation cascades (reverse only) ─────────────────
 * A sale doesn't just move inventory. Creating/editing one can also open a
 * commission entry (when a salesperson with a commission rate is set) and one or
 * more "Customer"-sourced Propagation batches (for cutting lines). Those forward
 * cascades are driven from the Sale form, which has the salesperson rate and the
 * product→variety mapping at hand. But the REVERSE side — dropping those linked
 * records when a sale is deleted — is keyed only by the sale id, so it belongs in
 * the store where deleteSale lives. These helpers let saleStore.deleteSale be
 * self-contained: any caller (UI row action, bulk delete, tests, future code)
 * gets a full atomic revert across every store the sale fed. Stores are reached
 * lazily via getState() to avoid a circular import with saleStore.
 */

/** Drop the commission entry linked to a sale (no-op if none exists). */
export function reverseSaleCommission(saleId: string): void {
  useCommissionStore.getState().removeForSale(saleId);
}

/**
 * Drop every "Customer"-sourced Propagation batch this sale created. deleteBatch
 * (inside removeCustomerPurchase) reverses any inventory pool the batch credited,
 * so cutting stock stays consistent.
 */
export function reverseSaleCuttings(saleId: string): void {
  useCuttingStore.getState().removeCustomerPurchase(saleId);
}

/* ── Harvest → inventory (Production) ─────────────────────────────────────────
 * A Fruit harvest logged in Farm Production credits the Fruit row's `harvested`
 * pool, in KG (weightKg). Nothing is credited when the entry has no variety
 * (subcategory) — legacy / summary harvest logs stay display-only.
 *
 * A CUTTINGS harvest does NOT credit inventory here. Instead it becomes an
 * internal cutting batch (see productionStore → cuttingStore.recordHarvestBatch),
 * and that batch owns the inventory pool across its lifecycle (packing credits
 * availableForSale, reserving credits breedingStock, planting deploys it to the
 * forecast). Crediting a pool here too would double-count the same cuttings.
 */

type HarvestInput = Pick<
  ProductionEntry,
  'subcategory' | 'harvestKind' | 'weightKg' | 'goodFruits' | 'fruitsHarvested' | 'cuttingState'
>;

/** Whether a harvest entry carries enough info to credit an inventory row. */
export function harvestCredits(entry: HarvestInput): boolean {
  const variety = (entry.subcategory ?? '').trim();
  if (!variety) return false;
  const kind = entry.harvestKind ?? 'Fruit';
  return kind === 'Fruit'
    ? (Number(entry.weightKg) || 0) > 0
    : (Number(entry.goodFruits) || 0) > 0;
}

/**
 * A stable signature of the fields that drive the harvest→inventory credit, so
 * an edit that leaves them unchanged (e.g. editing notes) needs no reconcile.
 */
export function harvestSignature(entry: HarvestInput): string {
  const kind = entry.harvestKind ?? 'Fruit';
  const qty = kind === 'Fruit' ? entry.weightKg : entry.goodFruits;
  return `${(entry.subcategory ?? '').trim().toLowerCase()}|${kind}|${Number(qty) || 0}|${entry.cuttingState ?? ''}`;
}

/** Apply (sign +1) or reverse (sign -1) a harvest's effect on inventory. */
function applyHarvest(entry: HarvestInput, sign: 1 | -1): void {
  if (!harvestCredits(entry)) return;
  const variety = (entry.subcategory ?? '').trim();
  const kind = entry.harvestKind ?? 'Fruit';
  const { ensureRow, adjustHarvested } = useInventoryStore.getState();

  if (kind === 'Cuttings') {
    // Harvested cuttings are tracked as an internal cutting batch, which owns the
    // inventory pool (see cuttingStore.recordHarvestBatch). Don't credit here.
    return;
  }

  // Fruit — credit the harvested pool in kg.
  const kg = (Number(entry.weightKg) || 0) * sign;
  const row = ensureRow(FRUIT_PRODUCT_TYPE, variety, 'Kg');
  adjustHarvested(row.id, kg);
}

/** Credit a harvest into inventory (Production add). */
export function recordHarvestInventory(entry: HarvestInput): void {
  applyHarvest(entry, +1);
}

/** Reverse a harvest's inventory credit (Production edit/delete). */
export function reverseHarvestInventory(entry: HarvestInput): void {
  applyHarvest(entry, -1);
}
