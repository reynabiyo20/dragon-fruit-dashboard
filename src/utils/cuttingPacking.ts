import type { Sale, Product, InventoryItem } from '../types';
import { CUTTINGS_PRODUCT_TYPE } from '../constants';

/**
 * Packing status for the CUTTINGS tied up in PENDING (not-yet-delivered) sales.
 *
 * A cutting sale that hasn't been marked "Received by Customer" is outstanding
 * demand the team still has to hand over — but the cuttings only become sellable
 * once they're PACKED. This joins that pending demand to the packed supply so the
 * user can see, at a glance, how many cuttings still need packing before those
 * orders can go out.
 *
 * Supply comes from inventory's cutting pools:
 *  - `availableForSale` — already packed & ready (a subset of `packed`).
 *  - `needsPacking`     — bare stock physically on hand, still to be packed.
 *
 * Per variety we compare demand against packed supply:
 *  - coveredByPacked = min(demand, availableForSale)   → orders already packable
 *  - toPack          = max(0, demand − availableForSale) → still need packing
 */
export interface VarietyPackingStatus {
  variety: string;
  /** Cutting qty in pending sales for this variety. */
  pendingDemand: number;
  /** Packed & ready-for-sale stock on hand for this variety. */
  availableForSale: number;
  /** Bare stock on hand awaiting the pack action for this variety. */
  needsPacking: number;
  /** Demand already coverable by packed stock. */
  coveredByPacked: number;
  /** Demand still to be packed (shortfall vs packed stock). */
  toPack: number;
}

export interface CuttingPackingStatus {
  /** Total cutting qty across all pending (undelivered) sales. */
  pendingDemand: number;
  /** Total pending demand already covered by packed stock. */
  coveredByPacked: number;
  /** Total pending demand still needing packing (the attention number). */
  toPack: number;
  /** Total bare stock on hand awaiting packing (inventory `needsPacking`). */
  bareOnHand: number;
  /** Number of distinct pending cutting orders (sales). */
  pendingOrders: number;
  /** Per-variety breakdown, sorted by most to pack first. */
  byVariety: VarietyPackingStatus[];
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Compute the packed-vs-needs-packing status for cuttings in pending sales.
 *
 * @param sales          all sales (filtered internally to pending cutting sales)
 * @param productById    resolver from a sale line's productId → Product
 * @param inventoryItems all inventory rows (cutting rows supply packed/bare pools)
 */
export function computeCuttingPackingStatus(
  sales: Sale[],
  productById: (id: string) => Product | undefined,
  inventoryItems: InventoryItem[],
): CuttingPackingStatus {
  // Normalized variety key → display casing (first seen wins).
  const varietyLabels = new Map<string, string>();
  // 1) Sum pending (undelivered) cutting demand per variety (subcategory).
  const demandByVariety = new Map<string, number>();
  const pendingOrderIds = new Set<string>();
  for (const sale of sales) {
    if (sale.delivered === true) continue; // only pending fulfillment
    let saleHasCutting = false;
    for (const item of sale.items) {
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) continue;
      const product = item.productId ? productById(item.productId) : undefined;
      if (!product || product.category !== CUTTINGS_PRODUCT_TYPE) continue;
      const key = norm(product.subcategory);
      demandByVariety.set(key, (demandByVariety.get(key) ?? 0) + qty);
      // Keep the first-seen display casing for the variety label.
      if (!varietyLabels.has(key)) varietyLabels.set(key, product.subcategory.trim());
      saleHasCutting = true;
    }
    if (saleHasCutting) pendingOrderIds.add(sale.id);
  }

  // 2) Index the cutting inventory pools per variety.
  const packedByVariety = new Map<string, number>();
  const bareByVariety = new Map<string, number>();
  let bareOnHand = 0;
  for (const row of inventoryItems) {
    if (row.category !== CUTTINGS_PRODUCT_TYPE) continue;
    const key = norm(row.subcategory);
    packedByVariety.set(key, (packedByVariety.get(key) ?? 0) + (row.availableForSale ?? 0));
    bareByVariety.set(key, (bareByVariety.get(key) ?? 0) + (row.needsPacking ?? 0));
    bareOnHand += row.needsPacking ?? 0;
    if (!varietyLabels.has(key)) varietyLabels.set(key, row.subcategory.trim());
  }

  // 3) Join demand to supply per variety.
  const byVariety: VarietyPackingStatus[] = [];
  let pendingDemand = 0;
  let coveredByPacked = 0;
  let toPack = 0;
  for (const [key, demand] of demandByVariety) {
    const availableForSale = packedByVariety.get(key) ?? 0;
    const needsPacking = bareByVariety.get(key) ?? 0;
    const covered = Math.min(demand, availableForSale);
    const pack = Math.max(0, demand - availableForSale);
    pendingDemand += demand;
    coveredByPacked += covered;
    toPack += pack;
    byVariety.push({
      variety: varietyLabels.get(key) ?? key,
      pendingDemand: demand,
      availableForSale,
      needsPacking,
      coveredByPacked: covered,
      toPack: pack,
    });
  }
  byVariety.sort((a, b) => b.toPack - a.toPack || b.pendingDemand - a.pendingDemand);

  return {
    pendingDemand,
    coveredByPacked,
    toPack,
    bareOnHand,
    pendingOrders: pendingOrderIds.size,
    byVariety,
  };
}

/**
 * Whether a SINGLE sale's cutting lines are covered by packed (ready-to-hand-over)
 * stock, i.e. whether it can be flagged "Received by Customer" / delivered.
 *
 * A cutting sale may go through against on-hand stock (endingQty, which includes
 * bare cuttings still awaiting the pack action), but the order can only actually
 * be handed over once the cuttings are PACKED. The packed-and-ready pool is
 * inventory's `availableForSale`. This compares each cutting variety's demand on
 * THIS sale against that variety's packed supply and reports any shortfall.
 *
 * Only CUTTINGS carry a packed pool — non-cutting lines (Fruit, Fertilizer, …)
 * have no packing step, so they never block delivery and are ignored here.
 *
 * `alreadyDelivered` handles re-validation of a sale whose delivery effect is
 * already applied to inventory (a delivered sale being edited, or a Received
 * toggle re-firing): that sale's own quantity has already been drawn out of
 * `availableForSale`, so it's added back per variety before comparing — otherwise
 * a legitimately-packed, already-delivered order would look short by its own size.
 */
export interface SaleDeliveryReadiness {
  /** True when every cutting line on the sale is covered by packed stock. */
  canDeliver: boolean;
  /** Per-variety shortfall (only varieties that still need packing). */
  shortfalls: { variety: string; needed: number; ready: number; toPack: number }[];
}

export function computeSaleDeliveryReadiness(
  sale: Pick<Sale, 'items' | 'delivered'>,
  productById: (id: string) => Product | undefined,
  inventoryItems: InventoryItem[],
  alreadyDelivered = sale.delivered === true,
): SaleDeliveryReadiness {
  // 1) Sum this sale's cutting demand per variety.
  const varietyLabels = new Map<string, string>();
  const demandByVariety = new Map<string, number>();
  for (const item of sale.items) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const product = item.productId ? productById(item.productId) : undefined;
    if (!product || product.category !== CUTTINGS_PRODUCT_TYPE) continue;
    const key = norm(product.subcategory);
    demandByVariety.set(key, (demandByVariety.get(key) ?? 0) + qty);
    if (!varietyLabels.has(key)) varietyLabels.set(key, product.subcategory.trim());
  }

  // 2) Index packed (availableForSale) supply per cutting variety.
  const packedByVariety = new Map<string, number>();
  for (const row of inventoryItems) {
    if (row.category !== CUTTINGS_PRODUCT_TYPE) continue;
    const key = norm(row.subcategory);
    packedByVariety.set(key, (packedByVariety.get(key) ?? 0) + (row.availableForSale ?? 0));
  }

  // 3) Compare demand to packed supply per variety. When the sale's delivery is
  //    already reflected in inventory, credit its own demand back to the ready
  //    pool first so a packed, already-delivered order isn't wrongly flagged short.
  const shortfalls: SaleDeliveryReadiness['shortfalls'] = [];
  for (const [key, needed] of demandByVariety) {
    const base = packedByVariety.get(key) ?? 0;
    const ready = alreadyDelivered ? base + needed : base;
    const toPack = Math.max(0, needed - ready);
    if (toPack > 0) {
      shortfalls.push({ variety: varietyLabels.get(key) ?? key, needed, ready, toPack });
    }
  }
  shortfalls.sort((a, b) => b.toPack - a.toPack);

  return { canDeliver: shortfalls.length === 0, shortfalls };
}
