import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { addDays, addWeeks, parseISO } from 'date-fns';
import type { CuttingBatch, CuttingStatus } from '../types';
import { generateId, now } from '../utils/id';
import { todayISO } from '../utils/date';
import {
  cuttingReadyWeeks, CUTTING_SOURCE_INTERNAL, CUTTING_SOURCE_CUSTOMER,
  CUTTING_TYPE_GRAFTED, CUTTING_CALLUSING_DAYS, CUTTING_STATUS_ROOTED_READY,
  CUTTING_STATUS_PACKED,
  CUTTING_ALLOCATION_DELIVERY, CUTTING_ALLOCATION_REPLANT, CUTTINGS_PRODUCT_TYPE,
} from '../constants';
import { useInventoryStore } from './inventoryStore';

/**
 * Cuttings store — the *growing* side of the business.
 *
 * Cuttings are sourced, grafted/planted, and take a few weeks to root before
 * they can be sold. Each batch tracks its cost, rooting time, and readiness.
 * Selling happens in the unified Sales flow, so batches carry no sales/revenue;
 * `quantitySold` is a manual figure for how many have left the batch.
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
  isInternal: boolean;
  packed: boolean;
  dateGrafted: string;
  readyDate: string;
  estimatedReadyDate: string;
  harvestDate: string;
  plantingDate: string;   // derived planting/acquisition date (harvest + callusing hold for internal)
  quantitySourced: number;
  quantitySold: number;
}): CuttingStatus {
  if (batch.quantitySourced > 0 && batch.quantitySold >= batch.quantitySourced) {
    return 'Sold Out';
  }
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
  // Internal batches: the milestone is the ESTIMATED ready date (callusing +
  // growth cycle). Once reached they're rooted & ready to be packed.
  if (batch.isInternal) {
    const estT = toTime(batch.estimatedReadyDate);
    if (estT !== null && Date.now() >= estT) return CUTTING_STATUS_ROOTED_READY;
    if (!batch.dateGrafted && estT === null) return 'Sourced';
    return 'Rooting';
  }
  // Customer records keep the simpler graft/estimate-based readiness.
  if (!batch.dateGrafted) return 'Sourced';
  if (!batch.readyDate) return 'Rooting';
  const readyT = toTime(batch.readyDate);
  if (readyT === null) return 'Rooting';
  return Date.now() >= readyT ? 'Ready' : 'Rooting';
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
    isInternal: source === CUTTING_SOURCE_INTERNAL,
    packed: batch.packed ?? false,
    dateGrafted: batch.dateGrafted,
    readyDate: batch.readyDate,
    estimatedReadyDate: batch.estimatedReadyDate,
    harvestDate: batch.harvestDate ?? '',
    plantingDate: batch.dateSourced,
    quantitySourced: batch.quantitySourced,
    quantitySold: batch.quantitySold,
  });
}

/** Recompute every derived field on a batch from its raw inputs. */
function recompute(batch: CuttingBatch): CuttingBatch {
  const source = batch.source ?? CUTTING_SOURCE_INTERNAL;
  const isInternal = source === CUTTING_SOURCE_INTERNAL;

  // ── Planting / acquisition date ──
  // Internal batches with a harvest date must callus/heal for a fixed hold, so
  // the effective planting/acquisition date is harvest + CUTTING_CALLUSING_DAYS.
  // Customer records (and internal batches without a harvest date) use the
  // dateSourced entered directly, with no delay.
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

  const quantityAvailable = batch.quantitySourced - batch.quantitySold;

  const status = deriveStatus({
    isInternal,
    packed: batch.packed ?? false,
    dateGrafted: batch.dateGrafted,
    readyDate,
    estimatedReadyDate,
    harvestDate,
    plantingDate: dateSourced,
    quantitySourced: batch.quantitySourced,
    quantitySold: batch.quantitySold,
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
  deleteBatch: (id: string) => void;
  getBatch: (id: string) => CuttingBatch | undefined;

  // ── Rollup selectors (across all batches) ──
  /** Total spent sourcing + grafting cuttings. */
  totalCost: () => number;
  totalSourced: () => number;
  totalSold: () => number;
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
          status: 'Sourced',
          createdAt: now(),
          updatedAt: now(),
        });
        set((state) => ({ batches: [...state.batches, batch] }));
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
          quantitySold: 0,
          notes: `Bought by ${data.customerName || 'customer'} — cascaded from Sales.`,
        });
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
        if (prev === CUTTING_ALLOCATION_REPLANT) inventory.adjustBreedingStock(row.id, -qty);
        else if (prev === CUTTING_ALLOCATION_DELIVERY) inventory.adjustAvailableForSale(row.id, -qty);

        if (allocation === CUTTING_ALLOCATION_REPLANT) inventory.adjustBreedingStock(row.id, qty);
        else if (allocation === CUTTING_ALLOCATION_DELIVERY) inventory.adjustAvailableForSale(row.id, qty);

        get().updateBatch(id, { allocation });
      },

      markPacked: (id) => {
        const batch = get().getBatch(id);
        if (!batch || batch.packed) return; // idempotent — already packed
        // Release the ready quantity into Available Stock for Sale for this variety.
        const inventory = useInventoryStore.getState();
        const row = inventory.ensureRow(CUTTINGS_PRODUCT_TYPE, batch.subcategory, 'piece');
        const qty = batch.quantityAvailable;
        inventory.adjustAvailableForSale(row.id, qty);
        // Remember exactly how much was credited so Undo can reverse it precisely.
        get().updateBatch(id, { packed: true, packedQty: qty });
      },

      unmarkPacked: (id) => {
        const batch = get().getBatch(id);
        if (!batch || !batch.packed) return false; // nothing to undo
        // Subtract exactly what packing credited, from the pool it credited.
        // Packing credits Available Stock for Sale; a batch flagged "For Replant
        // in Farm" carries its credit in Breeding Stock instead.
        const inventory = useInventoryStore.getState();
        const row = inventory.ensureRow(CUTTINGS_PRODUCT_TYPE, batch.subcategory, 'piece');
        const qty = batch.packedQty ?? batch.quantityAvailable;
        const isReplant = batch.allocation === CUTTING_ALLOCATION_REPLANT;

        // Safety guard: only undo if the pool balance can absorb the subtraction
        // without going negative. A negative result means those cuttings were
        // already allocated/sold, so the packing can't be cleanly reversed.
        const currentStock = isReplant
          ? row.breedingStock ?? 0
          : row.availableForSale ?? 0;
        if (currentStock - qty < 0) return false;

        if (isReplant) inventory.adjustBreedingStock(row.id, -qty);
        else inventory.adjustAvailableForSale(row.id, -qty);

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

      deleteBatch: (id) =>
        set((state) => ({ batches: state.batches.filter((b) => b.id !== id) })),

      getBatch: (id) => get().batches.find((b) => b.id === id),

      totalCost: () => get().batches.reduce((sum, b) => sum + b.totalCost, 0),
      totalSourced: () => get().batches.reduce((sum, b) => sum + b.quantitySourced, 0),
      totalSold: () => get().batches.reduce((sum, b) => sum + b.quantitySold, 0),
      totalAvailableToSell: () =>
        get()
          .batches.filter(
            (b) =>
              b.status === 'Ready' ||
              b.status === CUTTING_STATUS_ROOTED_READY ||
              b.status === CUTTING_STATUS_PACKED,
          )
          .reduce((sum, b) => sum + b.quantityAvailable, 0),
      readyBatches: () =>
        get().batches.filter(
          (b) =>
            (b.status === 'Ready' ||
              b.status === CUTTING_STATUS_ROOTED_READY ||
              b.status === CUTTING_STATUS_PACKED) &&
            b.quantityAvailable > 0,
        ),
      // "Maturing" = every batch still working toward its estimated ready date:
      // callusing in the nursery, sourced-but-not-grafted, or grafted-and-rooting.
      // Keyed off status rather than only 'Rooting' so new records (which start in
      // 'In Nursery / Callusing' or 'Sourced') show up in the Rooting KPI, and
      // driven by the estimated/rooting ready date so it honours the callusing math.
      rootingBatches: () =>
        get().batches.filter(
          (b) =>
            b.quantityAvailable > 0 &&
            (b.status === 'In Nursery / Callusing' ||
              b.status === 'Sourced' ||
              b.status === 'Rooting'),
        ),
    }),
    { name: 'dfd-cuttings' },
  ),
);
