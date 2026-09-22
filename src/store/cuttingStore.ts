import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { addDays, addWeeks, parseISO } from 'date-fns';
import type { CuttingBatch, CuttingStatus } from '../types';
import { generateId, now } from '../utils/id';
import { todayISO } from '../utils/date';
import {
  cuttingReadyWeeks, CUTTING_SOURCE_INTERNAL, CUTTING_SOURCE_CUSTOMER,
  CUTTING_SOURCE_PURCHASED,
  CUTTING_TYPE_GRAFTED, CUTTING_CALLUSING_DAYS, CUTTING_STATUS_ROOTED_READY,
  CUTTING_STATUS_PACKED, CUTTING_STATUS_SOURCED,
  CUTTING_ALLOCATION_DELIVERY, CUTTING_ALLOCATION_REPLANT, CUTTINGS_PRODUCT_TYPE,
  CUTTING_ROOT_WEEKS_DEFAULT,
} from '../constants';
import { useInventoryStore } from './inventoryStore';
import { useProductStore } from './productStore';
import { useProductCategoryStore } from './productCategoryStore';
import { useExpenseCategoryStore } from './expenseCategoryStore';

/**
 * Cuttings store — the *growing* side of the business.
 *
 * Cuttings are sourced, grafted/planted, and take a few weeks to root before
 * they can be sold. Each batch tracks its cost, rooting time, and readiness.
 * Selling happens in the unified Sales flow, so batches carry no sales/revenue;
 * all sourced cuttings are treated as on hand (real sales draw down Inventory).
 *
 * Derived fields (readyDate, totalCost, quantityAvailable, status) are recomputed
 * by `recompute()` on every write so the UI never calculates them itself.
 */

/** Parse an ISO/date string to epoch ms, or null if unparseable/empty. */
function toTime(iso: string): number | null {
  if (!iso) return null;
  try {
    const t = parseISO(iso).getTime();
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

/** Derive readiness status from dates, rooting/nursery windows, and quantities. */
function deriveStatus(batch: {
  // True for own-farm internal AND purchased-for-replant batches: both use the
  // estimated-ready-date path (planting + growth cycle) to reach Rooted & Ready.
  usesEstimateReadiness: boolean;
  packed: boolean;
  dateGrafted: string;
  readyDate: string;
  estimatedReadyDate: string;
  harvestDate: string;
  plantingDate: string;   // derived planting/acquisition date (harvest + callusing hold for internal)
}): CuttingStatus {
  // Once staff have packed a rooted batch it stays "Packed & Ready for Delivery"
  // — a manual milestone that outranks the date-driven statuses below.
  if (batch.packed) return CUTTING_STATUS_PACKED;
  // Internal harvested cuttings sit in the nursery callusing until the planting
  // date. If "now" is between harvest and planting, the batch is still healing.
  const harvestT = toTime(batch.harvestDate);
  const plantingT = toTime(batch.plantingDate);
  if (harvestT !== null && plantingT !== null) {
    const nowT = Date.now();
    if (nowT >= harvestT && nowT < plantingT) return 'In Nursery / Callusing';
  }
  // Internal + purchased-for-replant batches.
  if (batch.usesEstimateReadiness) {
    // A graft/plant date is the real start of the rooting clock, so once it's set
    // it TAKES PRECEDENCE: ready = graft date + rooting weeks (readyDate). This is
    // what lets a backdated graft date correctly land a batch in Rooted & Ready.
    if (batch.dateGrafted) {
      const readyT = toTime(batch.readyDate);
      if (readyT !== null) return Date.now() >= readyT ? CUTTING_STATUS_ROOTED_READY : 'Rooting';
      // Grafted but no computed ready date (e.g. rootWeeks 0) → treat as rooting.
      return 'Rooting';
    }
    // Not grafted yet. Own-farm (harvest-driven) batches still progress on the
    // acquisition/harvest ESTIMATE (harvest + callusing + growth cycle). A
    // PURCHASED batch has no harvest date — its clock only starts once a graft/
    // plant date is set, so it stays "To Graft / Plant" until then.
    if (!batch.harvestDate) return CUTTING_STATUS_SOURCED;
    const estT = toTime(batch.estimatedReadyDate);
    if (estT !== null && Date.now() >= estT) return CUTTING_STATUS_ROOTED_READY;
    if (estT === null) return CUTTING_STATUS_SOURCED;
    return 'Rooting';
  }
  // Customer records keep the simpler graft-based readiness. Once rooted they use
  // the same "Rooted & Ready to Pack" milestone as internal batches (no separate
  // legacy "Ready" state, so there's one term for "done rooting").
  if (!batch.dateGrafted) return CUTTING_STATUS_SOURCED;
  if (!batch.readyDate) return 'Rooting';
  const readyT = toTime(batch.readyDate);
  if (readyT === null) return 'Rooting';
  return Date.now() >= readyT ? CUTTING_STATUS_ROOTED_READY : 'Rooting';
}

/**
 * Recompute ONLY the time-sensitive status from a batch's already-stored derived
 * dates. The stored `status` is fixed at write time, but whether "now" has passed
 * a batch's callusing/ready date changes as the clock advances. UIs can call this
 * on a timer (see useNowTick) to reflect status transitions without a write.
 *
 * `_now` is accepted only to force re-evaluation when a ticking clock changes; the
 * comparison itself uses Date.now() inside deriveStatus.
 */
export function liveCuttingStatus(batch: CuttingBatch, _now?: Date): CuttingStatus {
  const source = batch.source ?? CUTTING_SOURCE_INTERNAL;
  return deriveStatus({
    usesEstimateReadiness:
      source === CUTTING_SOURCE_INTERNAL || source === CUTTING_SOURCE_PURCHASED,
    packed: batch.packed ?? false,
    dateGrafted: batch.dateGrafted,
    readyDate: batch.readyDate,
    estimatedReadyDate: batch.estimatedReadyDate,
    harvestDate: batch.harvestDate ?? '',
    plantingDate: batch.dateSourced,
  });
}

/** Recompute every derived field on a batch from its raw inputs. */
function recompute(batch: CuttingBatch): CuttingBatch {
  const source = batch.source ?? CUTTING_SOURCE_INTERNAL;
  const isInternal = source === CUTTING_SOURCE_INTERNAL;
  // Purchased-for-replant cuttings follow the same estimate-based readiness path
  // as internal batches (planting date + growth cycle → Rooted & Ready), but they
  // are BOUGHT rather than harvested, so they skip the nursery/callusing hold.
  const usesEstimateReadiness = isInternal || source === CUTTING_SOURCE_PURCHASED;

  // ── Planting / acquisition date ──
  // Internal batches with a harvest date must callus/heal for a fixed hold, so
  // the effective planting/acquisition date is harvest + CUTTING_CALLUSING_DAYS.
  // Customer + purchased records (and internal batches without a harvest date)
  // use the dateSourced entered directly, with no delay.
  const harvestDate = isInternal ? (batch.harvestDate ?? '') : '';
  let dateSourced = batch.dateSourced;
  if (isInternal && harvestDate) {
    try {
      dateSourced = addDays(parseISO(harvestDate), CUTTING_CALLUSING_DAYS).toISOString();
    } catch {
      dateSourced = batch.dateSourced;
    }
  }

  const readyDate =
    batch.dateGrafted && batch.rootWeeks > 0
      ? addWeeks(parseISO(batch.dateGrafted), batch.rootWeeks).toISOString()
      : '';

  // Estimated ready date = planting/acquisition date + variety growth cycle. For
  // internal batches this already starts AFTER the 14-day nursery hold (since the
  // planting date is harvest + hold). Customer records count from the purchase
  // date immediately.
  let estimatedReadyDate = '';
  if (dateSourced) {
    try {
      const weeks = cuttingReadyWeeks(batch.subcategory, batch.cuttingType ?? CUTTING_TYPE_GRAFTED);
      estimatedReadyDate = addWeeks(parseISO(dateSourced), weeks).toISOString();
    } catch {
      estimatedReadyDate = '';
    }
  }

  const totalCost =
    batch.quantitySourced * (batch.sourceCostPerCutting + batch.graftCostPerCutting);

  const quantityAvailable = batch.quantitySourced;

  const status = deriveStatus({
    usesEstimateReadiness,
    packed: batch.packed ?? false,
    dateGrafted: batch.dateGrafted,
    readyDate,
    estimatedReadyDate,
    harvestDate,
    plantingDate: dateSourced,
  });

  return {
    ...batch,
    source,
    cuttingType: batch.cuttingType ?? CUTTING_TYPE_GRAFTED,
    harvestDate,
    dateSourced,
    readyDate,
    estimatedReadyDate,
    totalCost,
    quantityAvailable,
    status,
  };
}

type NewBatchInput = Omit<
  CuttingBatch,
  'id' | 'readyDate' | 'estimatedReadyDate' | 'totalCost' | 'quantityAvailable' | 'status' | 'createdAt' | 'updatedAt'
>;

interface CuttingState {
  batches: CuttingBatch[];

  addBatch: (data: NewBatchInput) => CuttingBatch;
  /**
   * Record (or update) a Cuttings Store entry cascaded from a customer's cutting
   * purchase in the Sales module. Keyed by saleId + variety so editing the sale
   * updates the same record instead of duplicating it.
   */
  recordCustomerPurchase: (data: {
    subcategory: string;      // variety purchased
    quantity: number;         // quantity purchased
    dateBought: string;       // transaction date (acquisition date)
    customerId: string;
    customerName: string;
    saleId: string;
    cuttingType: string;      // grafted vs unrooted (affects estimated ready date)
  }) => CuttingBatch;
  /**
   * Record (or update) an internal cutting batch cascaded from a Farm Production
   * cuttings harvest. Keyed by the source ProductionEntry.id so editing the
   * harvest updates the same batch instead of duplicating it. The batch is a
   * normal "Internal Batch" (reserve → plant → forecast lifecycle); own-farm
   * harvest carries no source cost. Returns undefined when there's no variety or
   * no cuttings to record (and removes any existing linked batch in that case).
   */
  recordHarvestBatch: (data: {
    productionEntryId: string;
    subcategory: string;      // variety harvested
    quantity: number;         // good cuttings harvested
    harvestDate: string;      // harvest date (store derives the planting date)
    cuttingType?: string;
    rootWeeks?: number;
    dateGrafted?: string;
    notes?: string;
  }) => CuttingBatch | undefined;
  /** Remove the internal batch linked to a deleted/converted harvest entry. */
  removeHarvestBatch: (productionEntryId: string) => void;
  /**
   * Record (or update) a "Purchased" cutting batch cascaded from a vendor cutting
   * purchase in Expenses that the owner is buying to REPLANT on the farm. Keyed
   * by expenseId + variety so editing the expense updates the same batch instead
   * of duplicating it. The batch is pre-allocated "For Replant in Farm" so it
   * enters the reserve → plant → forecast lifecycle, and it OWNS the breeding
   * stock inventory pool (the expense cascade must NOT also credit packed /
   * needsPacking for a replant line — that would double-count). Carries the
   * vendor's per-cutting cost so breeding stock has a real cost basis.
   */
  recordVendorPurchase: (data: {
    expenseId: string;
    subcategory: string;      // variety purchased
    quantity: number;         // quantity purchased
    dateBought: string;       // transaction date (acquisition date)
    vendorId?: string;
    vendorName?: string;
    cuttingType: string;      // grafted/rooted vs unrooted (affects ready date)
    sourceCostPerCutting: number; // vendor unit price → batch cost basis
    notes?: string;
  }) => CuttingBatch;
  /** Remove the "Purchased" batch linked to a deleted/changed cutting expense. */
  removeVendorPurchase: (expenseId: string, subcategory?: string) => void;
  /** Remove the "Customer"-sourced batch(es) linked to a deleted sale. */
  removeCustomerPurchase: (saleId: string, subcategory?: string) => void;
  updateBatch: (
    id: string,
    data: Partial<Omit<CuttingBatch, 'id' | 'createdAt'>>,
  ) => void;
  /**
   * Flag a rooted-ready internal batch's destination and cascade its available
   * quantity into the matching inventory pool:
   *  - "For Replant in Farm" → Our Farm Breeding Stock
   *  - "For Delivery"        → Available Stock for Sale
   * Re-allocating moves the quantity between pools (reverses the previous one).
   */
  allocateBatch: (id: string, allocation: string) => void;
  /**
   * Staff "Mark as Packed" action on a rooted-ready batch. Sets status to
   * "Packed & Ready for Delivery" and releases the available quantity into the
   * Available-Stock-for-Sale inventory pool for that variety. Idempotent — calling
   * it again on an already-packed batch does nothing.
   */
  markPacked: (id: string) => void;
  /**
   * Undo an accidental "Mark as Packed": reverts the status to "Rooted & Ready to
   * Pack" and cleanly subtracts the packed quantity back out of the inventory pool
   * it credited (Available Stock for Sale, or Breeding Stock if flagged replant).
   *
   * Guard rail: if subtracting would drive that pool's balance below zero (the
   * stock was already allocated/sold), the undo is blocked and returns false.
   * Returns true when the undo was applied.
   */
  unmarkPacked: (id: string) => boolean;
  /**
   * Deploy a replant-flagged internal batch into the field ("Mark as Planted").
   * Sets planted=true + deploymentDate=today, and moves the batch out of the Farm
   * Breeding Stock pool (subtracts its quantity) since it's now active field
   * growth. This deployment seeds the wholesale harvest forecast. Idempotent.
   */
  markPlanted: (id: string) => void;
  /**
   * Undo an accidental "Ready for Farm Planting": reverts the batch to
   * "Rooted & Ready to Pack", clears its deployment date + replant flag, and
   * drops it from the wholesale forecast. (Planting nets breeding stock to zero,
   * so no inventory reversal is needed.)
   */
  unmarkPlanted: (id: string) => void;
  deleteBatch: (id: string) => void;
  getBatch: (id: string) => CuttingBatch | undefined;

  // ── Rollup selectors (across all batches) ──
  /** Total spent sourcing + grafting cuttings. */
  totalCost: () => number;
  totalSourced: () => number;
  /** Rooted cuttings currently available to sell (only from Ready batches). */
  totalAvailableToSell: () => number;
  /** Batches that are rooted and have stock left to sell. */
  readyBatches: () => CuttingBatch[];
  /** Batches still rooting (grafted but not yet sellable). */
  rootingBatches: () => CuttingBatch[];
}

export const useCuttingStore = create<CuttingState>()(
  persist(
    (set, get) => ({
      batches: [],

      addBatch: (data) => {
        const batch = recompute({
          ...data,
          id: generateId(),
          readyDate: '',
          estimatedReadyDate: '',
          totalCost: 0,
          quantityAvailable: 0,
          status: CUTTING_STATUS_SOURCED,
          createdAt: now(),
          updatedAt: now(),
        });
        set((state) => ({ batches: [...state.batches, batch] }));
        // Cascade the variety into the sellable Products catalog + Settings
        // taxonomy so every cutting we grow/source is a sellable product. Cost is
        // seeded from the batch's per-cutting cost; selling price is left for the
        // user. Find-or-create — never overwrites values already set.
        if (batch.subcategory.trim()) {
          // Product taxonomy + catalog (drives Products & Sales dropdowns).
          useProductCategoryStore.getState().addEntry(CUTTINGS_PRODUCT_TYPE, batch.subcategory);
          useProductStore.getState().upsertFromPurchase({
            category: CUTTINGS_PRODUCT_TYPE,
            subcategory: batch.subcategory,
            unit: 'piece',
            costPHP: batch.sourceCostPerCutting + batch.graftCostPerCutting,
          });
          // Expense taxonomy (drives the Expense form dropdowns) so the variety is
          // selectable when recording a cutting purchase.
          useExpenseCategoryStore.getState().addEntry(CUTTINGS_PRODUCT_TYPE, batch.subcategory);
          // Inventory row: create the Cuttings row for this variety now, so a
          // brand-new variety shows up under Cuttings in Inventory the moment its
          // batch is created — not only later when it's packed/allocated. Seed the
          // row's unit cost from the batch's per-cutting cost if it's still zero.
          // The sellable pools (packed / availableForSale / breedingStock) stay at
          // zero here; packing credits `availableForSale`, allocation credits
          // `breedingStock` — that behavior is unchanged.
          const invRow = useInventoryStore
            .getState()
            .ensureRow(CUTTINGS_PRODUCT_TYPE, batch.subcategory, 'piece');
          const perCuttingCost = batch.sourceCostPerCutting + batch.graftCostPerCutting;
          if (invRow.unitCost === 0 && perCuttingCost > 0) {
            useInventoryStore.getState().updateItem(invRow.id, { unitCost: perCuttingCost });
          }
        }
        return batch;
      },

      recordCustomerPurchase: (data) => {
        // Idempotent per sale line: if a record already exists for this sale +
        // variety, update it (so editing a sale keeps the store in sync);
        // otherwise create a new "Customer"-sourced record.
        const existing = data.saleId
          ? get().batches.find(
              (b) =>
                b.source === CUTTING_SOURCE_CUSTOMER &&
                b.saleId === data.saleId &&
                b.subcategory === data.subcategory,
            )
          : undefined;

        if (existing) {
          get().updateBatch(existing.id, {
            customerId: data.customerId,
            customerName: data.customerName,
            dateSourced: data.dateBought,
            quantitySourced: data.quantity,
            cuttingType: data.cuttingType,
          });
          return get().getBatch(existing.id)!;
        }

        return get().addBatch({
          subcategory: data.subcategory,
          source: CUTTING_SOURCE_CUSTOMER,
          cuttingType: data.cuttingType,
          customerId: data.customerId,
          customerName: data.customerName,
          saleId: data.saleId,
          dateSourced: data.dateBought,
          dateGrafted: '',
          quantitySourced: data.quantity,
          sourceCostPerCutting: 0,
          graftCostPerCutting: 0,
          rootWeeks: 0,
          notes: `Bought by ${data.customerName || 'customer'} — cascaded from Sales.`,
        });
      },

      recordHarvestBatch: (data) => {
        const variety = (data.subcategory ?? '').trim();
        const qty = Math.max(0, Math.round(Number(data.quantity) || 0));
        const existing = get().batches.find(
          (b) => b.productionEntryId === data.productionEntryId,
        );

        // No variety or no cuttings → nothing to track. Drop any stale linked batch
        // (e.g. the harvest was edited down to 0, or its variety was cleared).
        if (!variety || qty <= 0) {
          if (existing) get().deleteBatch(existing.id);
          return undefined;
        }

        if (existing) {
          // A batch that's already been packed / reserved / planted has credited
          // inventory pools sized off its current quantity. Rewriting the quantity
          // would desync those pools, so only edit the quantity while the batch is
          // still early (not packed, not allocated, not planted). Metadata
          // (variety, dates, type, rooting weeks, notes) is always safe to update.
          const locked = !!existing.packed || !!existing.planted || !!(existing.allocation ?? '');
          const patch: Partial<Omit<CuttingBatch, 'id' | 'createdAt'>> = {
            subcategory: variety,
            harvestDate: data.harvestDate,
            cuttingType: data.cuttingType ?? existing.cuttingType,
            rootWeeks: data.rootWeeks ?? existing.rootWeeks,
            dateGrafted: data.dateGrafted ?? existing.dateGrafted,
          };
          if (!locked) patch.quantitySourced = qty;
          get().updateBatch(existing.id, patch);
          return get().getBatch(existing.id);
        }

        return get().addBatch({
          subcategory: variety,
          source: CUTTING_SOURCE_INTERNAL,
          productionEntryId: data.productionEntryId,
          cuttingType: data.cuttingType ?? CUTTING_TYPE_GRAFTED,
          harvestDate: data.harvestDate,
          dateSourced: data.harvestDate, // recompute derives the real planting date
          dateGrafted: data.dateGrafted ?? '',
          quantitySourced: qty,
          // Own-farm harvest: no cost to source; grafting/prep still 0 by default.
          sourceCostPerCutting: 0,
          graftCostPerCutting: 0,
          rootWeeks: data.rootWeeks ?? CUTTING_ROOT_WEEKS_DEFAULT,
          notes: data.notes ?? 'Harvested on-farm — cascaded from Farm Production.',
        });
      },

      removeHarvestBatch: (productionEntryId) => {
        const existing = get().batches.find(
          (b) => b.productionEntryId === productionEntryId,
        );
        if (existing) get().deleteBatch(existing.id);
      },

      recordVendorPurchase: (data) => {
        // Idempotent per expense line: if a "Purchased" batch already exists for
        // this expense + variety, update it (so editing the expense keeps the
        // batch in sync); otherwise create a new one.
        const existing = data.expenseId
          ? get().batches.find(
              (b) =>
                b.source === CUTTING_SOURCE_PURCHASED &&
                b.expenseId === data.expenseId &&
                b.subcategory === data.subcategory,
            )
          : undefined;

        if (existing) {
          // Keep breeding stock in step with a quantity change — but only while
          // the batch is still Reserved (not yet planted). Once planted, its
          // quantity is locked into the field (and the forecast), so we don't
          // touch the pool. allocateBatch only re-syncs on an allocation CHANGE,
          // so a pure quantity edit needs the delta applied here.
          const stillReserved =
            existing.allocation === CUTTING_ALLOCATION_REPLANT && !existing.planted;
          if (stillReserved && data.quantity !== existing.quantityAvailable) {
            const delta = data.quantity - existing.quantityAvailable;
            const inventory = useInventoryStore.getState();
            const row = inventory.ensureRow(CUTTINGS_PRODUCT_TYPE, existing.subcategory, 'piece');
            inventory.adjustBreedingStock(row.id, delta);
          }
          get().updateBatch(existing.id, {
            vendorId: data.vendorId,
            vendorName: data.vendorName,
            dateSourced: data.dateBought,
            quantitySourced: data.quantity,
            cuttingType: data.cuttingType,
            sourceCostPerCutting: data.sourceCostPerCutting,
          });
          return get().getBatch(existing.id)!;
        }

        // Create the batch (no pools touched yet), then flag it For Replant so it
        // credits breeding stock and joins the reserve → plant lifecycle. The
        // batch OWNS breeding stock; the expense cascade must skip packed/
        // needsPacking for a replant line to avoid double-counting.
        const batch = get().addBatch({
          subcategory: data.subcategory,
          source: CUTTING_SOURCE_PURCHASED,
          expenseId: data.expenseId,
          vendorId: data.vendorId,
          vendorName: data.vendorName,
          cuttingType: data.cuttingType,
          dateSourced: data.dateBought,
          dateGrafted: '',
          quantitySourced: data.quantity,
          sourceCostPerCutting: data.sourceCostPerCutting,
          graftCostPerCutting: 0,
          rootWeeks: CUTTING_ROOT_WEEKS_DEFAULT,
          notes:
            data.notes ??
            `Bought from ${data.vendorName || 'vendor'} to replant — cascaded from Expenses.`,
        });
        get().allocateBatch(batch.id, CUTTING_ALLOCATION_REPLANT);
        return get().getBatch(batch.id)!;
      },

      removeVendorPurchase: (expenseId, subcategory) => {
        // deleteBatch reverses whatever pool the batch credited (breeding stock
        // for a reserved replant batch), so this stays consistent.
        get()
          .batches.filter(
            (b) =>
              b.source === CUTTING_SOURCE_PURCHASED &&
              b.expenseId === expenseId &&
              (subcategory === undefined || b.subcategory === subcategory),
          )
          .forEach((b) => get().deleteBatch(b.id));
      },

      removeCustomerPurchase: (saleId, subcategory) => {
        // Mirror of removeVendorPurchase for the Sales→Cuttings cascade: when a
        // sale is deleted, drop the "Customer"-sourced batch(es) it created so
        // Propagation isn't left with orphaned records. deleteBatch reverses any
        // inventory pool the batch credited, keeping stock consistent.
        get()
          .batches.filter(
            (b) =>
              b.source === CUTTING_SOURCE_CUSTOMER &&
              b.saleId === saleId &&
              (subcategory === undefined || b.subcategory === subcategory),
          )
          .forEach((b) => get().deleteBatch(b.id));
      },

      updateBatch: (id, data) =>
        set((state) => ({
          batches: state.batches.map((b) =>
            b.id === id ? recompute({ ...b, ...data, updatedAt: now() }) : b,
          ),
        })),

      allocateBatch: (id, allocation) => {
        const batch = get().getBatch(id);
        if (!batch) return;
        const prev = batch.allocation ?? '';
        if (prev === allocation) return; // no change

        const qty = batch.quantityAvailable;
        const inventory = useInventoryStore.getState();
        const row = inventory.ensureRow(CUTTINGS_PRODUCT_TYPE, batch.subcategory, 'piece');

        // Reverse the previous allocation's pool before applying the new one so a
        // re-flag moves the quantity rather than double-counting.
        //  - "For Replant in Farm" ↔ Breeding Stock pool
        //  - "For Delivery"        ↔ Needs Packing pool (bare, still-to-pack stock).
        //    Tagging a rooted batch "Pack for Delivery" queues it in Inventory's
        //    Needs Packing pool; the actual pack (needsPacking → packed + Ready
        //    for Sale) happens on the Inventory page, keeping one source of truth.
        if (prev === CUTTING_ALLOCATION_REPLANT) inventory.adjustBreedingStock(row.id, -qty);
        else if (prev === CUTTING_ALLOCATION_DELIVERY) inventory.adjustNeedsPacking(row.id, -qty);

        if (allocation === CUTTING_ALLOCATION_REPLANT) inventory.adjustBreedingStock(row.id, qty);
        else if (allocation === CUTTING_ALLOCATION_DELIVERY) inventory.adjustNeedsPacking(row.id, qty);

        get().updateBatch(id, { allocation });
      },

      markPacked: (id) => {
        const batch = get().getBatch(id);
        if (!batch || batch.packed) return; // idempotent — already packed
        // Packing turns the rooted batch into finished, on-hand sellable stock:
        //  - `packed`           makes it count toward endingQty (+ packed), and
        //  - `availableForSale` tracks the still-unsold sellable remainder.
        const inventory = useInventoryStore.getState();
        const row = inventory.ensureRow(CUTTINGS_PRODUCT_TYPE, batch.subcategory, 'piece');
        const qty = batch.quantityAvailable;
        inventory.adjustPacked(row.id, qty);
        inventory.adjustAvailableForSale(row.id, qty);
        // Remember exactly how much was credited so Undo can reverse it precisely.
        get().updateBatch(id, { packed: true, packedQty: qty });
      },

      unmarkPacked: (id) => {
        const batch = get().getBatch(id);
        if (!batch || !batch.packed) return false; // nothing to undo
        const inventory = useInventoryStore.getState();
        const row = inventory.ensureRow(CUTTINGS_PRODUCT_TYPE, batch.subcategory, 'piece');
        const qty = batch.packedQty ?? batch.quantityAvailable;

        // Safety guard: only undo if the sellable remainder can absorb the
        // subtraction without going negative. A shortfall means some of these
        // cuttings were already delivered/sold, so packing can't be cleanly undone.
        if ((row.availableForSale ?? 0) - qty < 0) return false;

        // Reverse both pools packing credited.
        inventory.adjustPacked(row.id, -qty);
        inventory.adjustAvailableForSale(row.id, -qty);

        // Reset back to the rooted-ready milestone (re-applies the soft-green alert).
        get().updateBatch(id, { packed: false, packedQty: 0 });
        return true;
      },

      markPlanted: (id) => {
        const batch = get().getBatch(id);
        if (!batch || batch.planted) return; // idempotent — already deployed
        // Move the cuttings out of the Farm Breeding Stock pool: they're now in
        // the ground as active field growth, not idle breeding inventory.
        if (batch.allocation === CUTTING_ALLOCATION_REPLANT) {
          const inventory = useInventoryStore.getState();
          const row = inventory.ensureRow(CUTTINGS_PRODUCT_TYPE, batch.subcategory, 'piece');
          inventory.adjustBreedingStock(row.id, -batch.quantityAvailable);
        }
        get().updateBatch(id, { planted: true, deploymentDate: todayISO() });
      },

      unmarkPlanted: (id) => {
        const batch = get().getBatch(id);
        if (!batch || !batch.planted) return; // nothing to undo
        // Undo planting → return the batch to the RESERVED-for-farm state (still
        // flagged For Replant). Planting had moved the cuttings out of Breeding
        // Stock into the field, so re-credit that pool and drop the deployment
        // date (removing it from the wholesale forecast).
        if (batch.allocation === CUTTING_ALLOCATION_REPLANT) {
          const inventory = useInventoryStore.getState();
          const row = inventory.ensureRow(CUTTINGS_PRODUCT_TYPE, batch.subcategory, 'piece');
          inventory.adjustBreedingStock(row.id, batch.quantityAvailable);
        }
        get().updateBatch(id, { planted: false, deploymentDate: '' });
      },

      deleteBatch: (id) => {
        // Reverse whatever inventory pools this batch credited before dropping it,
        // mirroring the reversals in allocateBatch / unmarkPacked / unmarkPlanted.
        // Without this, deleting an allocated/packed batch leaves its quantity
        // orphaned in Inventory (Needs Packing / Breeding Stock / Ready for Sale).
        const batch = get().getBatch(id);
        if (batch) {
          const inventory = useInventoryStore.getState();
          const row = inventory.findByCategorySub(CUTTINGS_PRODUCT_TYPE, batch.subcategory);
          if (row) {
            if (batch.packed) {
              // Packed stock credited both `packed` and `availableForSale`.
              const qty = batch.packedQty ?? batch.quantityAvailable;
              inventory.adjustPacked(row.id, -qty);
              inventory.adjustAvailableForSale(row.id, -qty);
            } else if (batch.allocation === CUTTING_ALLOCATION_DELIVERY) {
              // Queued for packing → sat in the Needs Packing pool.
              inventory.adjustNeedsPacking(row.id, -batch.quantityAvailable);
            } else if (batch.allocation === CUTTING_ALLOCATION_REPLANT && !batch.planted) {
              // Reserved (not yet planted) → sat in Breeding Stock. Planted batches
              // already netted Breeding Stock to zero, so nothing to reverse there.
              inventory.adjustBreedingStock(row.id, -batch.quantityAvailable);
            }
          }
        }
        set((state) => ({ batches: state.batches.filter((b) => b.id !== id) }));
      },

      getBatch: (id) => get().batches.find((b) => b.id === id),

      totalCost: () => get().batches.reduce((sum, b) => sum + b.totalCost, 0),
      totalSourced: () => get().batches.reduce((sum, b) => sum + b.quantitySourced, 0),
      totalAvailableToSell: () =>
        get()
          .batches.filter(
            (b) =>
              b.status === CUTTING_STATUS_ROOTED_READY ||
              b.status === CUTTING_STATUS_PACKED,
          )
          .reduce((sum, b) => sum + b.quantityAvailable, 0),
      readyBatches: () =>
        get().batches.filter(
          (b) =>
            (b.status === CUTTING_STATUS_ROOTED_READY ||
              b.status === CUTTING_STATUS_PACKED) &&
            b.quantityAvailable > 0,
        ),
      // "Maturing" = every batch still working toward its estimated ready date:
      // callusing in the nursery, to-graft/plant, or grafted-and-rooting. Keyed
      // off status rather than only 'Rooting' so new records (which start in
      // 'In Nursery / Callusing' or 'To Graft / Plant') show up in the Rooting
      // KPI. 'Sourced' is kept as a legacy stored value from before the rename.
      rootingBatches: () =>
        get().batches.filter(
          (b) =>
            b.quantityAvailable > 0 &&
            (b.status === 'In Nursery / Callusing' ||
              b.status === CUTTING_STATUS_SOURCED ||
              b.status === 'Rooting'),
        ),
    }),
    { name: 'dfd-cuttings' },
  ),
);
