import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InventoryItem } from '../types';
import { generateId, now } from '../utils/id';
import { isServiceCategory, CUTTINGS_PRODUCT_TYPE } from '../constants';

/**
 * Auto-calculate ending (on-hand) quantity.
 *   endingQty = beginning + purchased − used − sold + packed + needsPacking
 * The two cutting-only pools both hold physical stock on hand:
 *   - `packed`: cuttings ready to sell (farm-packed via markPacked, or bought
 *     from a customer already packed). Also drives the "Ready for Sale" pool.
 *   - `needsPacking`: bare cuttings bought from a customer that still need
 *     packing before they can be sold.
 * For non-cuttings rows both are 0, so the formula reduces to the classic
 * beginning + purchased − used − sold.
 *
 * Cuttings caveat: for cuttings the on-hand quantity is simply the sum of the
 * physical pools — endingQty = packed + needsPacking (+ produced + harvested).
 * Both a delivered cutting sale AND recorded usage draw physical stock OUT of
 * those pools directly (sale → −packed via applyReceivedToInventory; usage →
 * −needsPacking then −packed via adjustUsedCuttings), while still incrementing
 * the `sold` / `used` counters for reporting. Because each departure is already
 * captured by the pool movement, subtracting `sold` or `used` again would
 * double-count it, so BOTH terms are dropped for cuttings rows. `sold` / `used`
 * remain accurate lifetime counts for display.
 */
function calcEnding(
  item: Pick<InventoryItem, 'category' | 'beginningQty' | 'purchased' | 'used' | 'sold' | 'packed' | 'needsPacking' | 'produced' | 'harvested'>,
): number {
  const isCuttings = norm(item.category) === norm(CUTTINGS_PRODUCT_TYPE);
  const soldTerm = isCuttings ? 0 : item.sold;
  const usedTerm = isCuttings ? 0 : item.used;
  return (
    item.beginningQty + item.purchased - usedTerm - soldTerm +
    (item.packed ?? 0) + (item.needsPacking ?? 0) + (item.produced ?? 0) + (item.harvested ?? 0)
  );
}

/** Normalize a category/subcategory token for tolerant matching (case + whitespace). */
function norm(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Collapse any duplicate (category, subcategory) rows into a single row by
 * summing their quantities. The first-seen row wins for identity fields
 * (id/unit/unitCost/notes/dates); its quantity pools accumulate the rest.
 * Keeps inventory to exactly one row per category+subcategory.
 */
function dedupeItems(items: InventoryItem[]): InventoryItem[] {
  const byKey = new Map<string, InventoryItem>();
  for (const raw of items) {
    const item = { packed: 0, needsPacking: 0, breedingStock: 0, availableForSale: 0, produced: 0, harvested: 0, ...raw };
    const key = `${norm(item.category)}||${norm(item.subcategory)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...item });
      continue;
    }
    existing.beginningQty += item.beginningQty;
    existing.purchased += item.purchased;
    existing.used += item.used;
    existing.sold += item.sold;
    existing.packed = (existing.packed ?? 0) + (item.packed ?? 0);
    existing.needsPacking = (existing.needsPacking ?? 0) + (item.needsPacking ?? 0);
    existing.breedingStock = (existing.breedingStock ?? 0) + (item.breedingStock ?? 0);
    existing.availableForSale = (existing.availableForSale ?? 0) + (item.availableForSale ?? 0);
    existing.produced = (existing.produced ?? 0) + (item.produced ?? 0);
    existing.harvested = (existing.harvested ?? 0) + (item.harvested ?? 0);
    if (!existing.unit && item.unit) existing.unit = item.unit;
    if (existing.unitCost === 0 && item.unitCost > 0) existing.unitCost = item.unitCost;
    if (!existing.notes && item.notes) existing.notes = item.notes;
  }
  // Recompute endingQty for every merged row.
  return [...byKey.values()].map((i) => ({ ...i, endingQty: calcEnding(i) }));
}

type NewInventoryInput = Omit<InventoryItem, 'id' | 'endingQty' | 'createdAt' | 'updatedAt'>;

interface InventoryState {
  items: InventoryItem[];
  _seeded: number;
  addItem: (data: NewInventoryInput) => InventoryItem;
  updateItem: (id: string, data: Partial<Omit<InventoryItem, 'id' | 'createdAt'>>) => void;
  deleteItem: (id: string) => void;
  getItem: (id: string) => InventoryItem | undefined;
  /**
   * Find an inventory row by (category, subcategory) using tolerant matching.
   * This is the join key for the sales→sold and expenses→purchased links:
   * category == Cuttings/Fruit/Fertilizer, subcategory == variety.
   */
  findByCategorySub: (category: string, subcategory: string) => InventoryItem | undefined;
  /**
   * Return the row for (category, subcategory), creating an empty one if none
   * exists yet. Used by the cuttings allocation / delivery cascades so a variety
   * without a seeded row still tracks its breeding / for-sale pools.
   */
  ensureRow: (category: string, subcategory: string, unit?: string) => InventoryItem;
  /** Add `delta` to an item's `sold` (negative reverses); recomputes endingQty. */
  adjustSold: (id: string, delta: number) => void;
  /**
   * Record `qty` cuttings consumed (used) on a row. Draws the stock physically
   * out of the pools — `needsPacking` first, then `packed` (+ availableForSale)
   * for any overflow — and increments the lifetime `used` counter. Because the
   * pools shrink, endingQty drops by the amount actually consumed (calcEnding
   * drops the `used` term for cuttings to avoid double-counting). `qty` is
   * clamped to what's on hand (needsPacking + packed). Returns how much of the
   * consumption spilled over into `packed` (0 if it all fit in needsPacking) so
   * callers can surface an "ate into packed stock" notice.
   */
  adjustUsedCuttings: (id: string, qty: number) => number;
  /** Add `delta` to an item's `purchased` (negative reverses); recomputes endingQty. */
  adjustPurchased: (id: string, delta: number) => void;
  /**
   * Add `delta` to an item's `packed` pool (never below 0); recomputes endingQty.
   * Cuttings become on-hand sellable stock when packed, so this feeds endingQty.
   */
  adjustPacked: (id: string, delta: number) => void;
  /** Add `delta` to an item's `breedingStock` pool (never below 0). */
  adjustBreedingStock: (id: string, delta: number) => void;
  /** Add `delta` to an item's `availableForSale` pool (never below 0). */
  adjustAvailableForSale: (id: string, delta: number) => void;
  /**
   * Add `delta` to an item's `needsPacking` pool (never below 0); recomputes
   * endingQty. Bare cuttings bought from a customer land here until packed.
   */
  adjustNeedsPacking: (id: string, delta: number) => void;
  /**
   * Add `delta` to an item's `produced` pool (never below 0); recomputes
   * endingQty. Finished goods manufactured in-house from other inventory land here.
   */
  adjustProduced: (id: string, delta: number) => void;
  /**
   * Add `delta` to an item's `harvested` pool (never below 0); recomputes
   * endingQty. Farm output logged in Production (Fruit kg / Cuttings) lands here.
   */
  adjustHarvested: (id: string, delta: number) => void;
  /**
   * Pack `qty` bare cuttings on a row: moves them from `needsPacking` into
   * `packed` (and credits the `availableForSale` / Ready-for-Sale pool). `qty`
   * is clamped to what's currently in `needsPacking`. Returns the quantity
   * actually packed (0 if nothing to pack). endingQty is unchanged — the stock
   * was already on hand; it just becomes sellable.
   */
  packCuttings: (id: string, qty: number) => number;
  /**
   * Reverse a pack: move `qty` cuttings from `packed` + `availableForSale` back
   * into `needsPacking`. Clamped to the still-unsold (availableForSale) amount so
   * a partly-sold pack can't go negative. Returns the quantity actually unpacked.
   * endingQty is unchanged (mirror of packCuttings).
   */
  unpackCuttings: (id: string, qty: number) => number;
  /** Total inventory value = sum of endingQty * unitCost */
  totalValue: () => number;
  /** Items where endingQty <= lowStockThreshold */
  lowStockItems: (threshold?: number) => InventoryItem[];
}

// v10: added the `harvested` pool (farm output from Production feeds endingQty).
const SEED_VERSION = 10;

/** Build an inventory item row cleanly */
function inv(
  subcategory: string,
  category: string,
  unit: string,
  unitCost = 0,
  notes = ''
): InventoryItem {
  return {
    id: generateId(),
    category,
    subcategory,
    unit,
    beginningQty: 0,
    purchased: 0,
    used: 0,
    sold: 0,
    endingQty: 0,
    unitCost,
    packed: 0,
    needsPacking: 0,
    breedingStock: 0,
    availableForSale: 0,
    produced: 0,
    harvested: 0,
    notes,
    createdAt: now(),
    updatedAt: now(),
  };
}

const SEED_ITEMS: InventoryItem[] = [
  // ── Cuttings (grafted dragon-fruit root stock) ────────────────────────────
  inv('Thai White',  'Cuttings', 'piece'),
  inv('Variety 2',   'Cuttings', 'piece'),
  inv('Variety 3',   'Cuttings', 'piece'),
  inv('Variety 4',   'Cuttings', 'piece'),
  inv('Variety 5',   'Cuttings', 'piece'),
  inv('Variety 6',   'Cuttings', 'piece'),
  inv('Variety 7',   'Cuttings', 'piece'),
  inv('Variety 8',   'Cuttings', 'piece'),
  inv('Variety 9',   'Cuttings', 'piece'),
  inv('Variety 10',  'Cuttings', 'piece'),
  inv('Variety 11',  'Cuttings', 'piece'),
  inv('Variety 12',  'Cuttings', 'piece'),
  inv('Variety 13',  'Cuttings', 'piece'),
  inv('Variety 14',  'Cuttings', 'piece'),
  inv('Variety 15',  'Cuttings', 'piece'),

  // ── Fruit (harvested dragon fruit) ───────────────────────────────────────
  inv('Thai White',  'Fruit', 'Kg'),
  inv('Variety 2',   'Fruit', 'Kg'),
  inv('Variety 3',   'Fruit', 'Kg'),
  inv('Variety 4',   'Fruit', 'Kg'),
  inv('Variety 5',   'Fruit', 'Kg'),
  inv('Variety 6',   'Fruit', 'Kg'),
  inv('Variety 7',   'Fruit', 'Kg'),
  inv('Variety 8',   'Fruit', 'Kg'),
  inv('Variety 9',   'Fruit', 'Kg'),
  inv('Variety 10',  'Fruit', 'Kg'),
  inv('Variety 11',  'Fruit', 'Kg'),
  inv('Variety 12',  'Fruit', 'Kg'),
  inv('Variety 13',  'Fruit', 'Kg'),
  inv('Variety 14',  'Fruit', 'Kg'),
  inv('Variety 15',  'Fruit', 'Kg'),

  // ── Fertilizers ──────────────────────────────────────────────────────────
  inv('Magnesium',      'Fertilizer', 'bottle', 410),
  inv('Vermicast Worm', 'Fertilizer', 'sack',   500),
  inv('Cocopeat',       'Fertilizer', 'sack',   220),
  inv('Chicken Manure', 'Fertilizer', 'sack',    70),
  inv('Rice Hull',      'Fertilizer', 'sack',    75),
  inv('CRH',            'Fertilizer', 'sack',    30),
  inv('Neem Oil',       'Fertilizer', 'bottle', 184.5),
  inv('Nordox',         'Fertilizer', 'jug',   2000),
  inv('Carbomax',       'Fertilizer', 'bottle',   0, 'Cost TBD'),

  // ── Packing Materials ─────────────────────────────────────────────────────
  inv('Scotch Tape',  'Packing Material', 'roll'),
  inv('Small Box',    'Packing Material', 'box'),
  inv('Bubble Wrap',  'Packing Material', 'roll'),
];

export const useInventoryStore = create<InventoryState>()(
  persist(
    (set, get) => ({
      items: SEED_ITEMS,
      _seeded: SEED_VERSION,

      addItem: (data) => {
        // Enforce ONE row per (category, subcategory): if a row already exists,
        // merge the incoming quantities into it instead of creating a duplicate.
        // This prevents split stock where a cascade lands on one row while the
        // user is looking at another with the same category+subcategory.
        const existing = get().findByCategorySub(data.category, data.subcategory);
        if (existing) {
          const merged: InventoryItem = {
            ...existing,
            beginningQty: existing.beginningQty + (data.beginningQty ?? 0),
            purchased: existing.purchased + (data.purchased ?? 0),
            used: existing.used + (data.used ?? 0),
            sold: existing.sold + (data.sold ?? 0),
            packed: (existing.packed ?? 0) + (data.packed ?? 0),
            needsPacking: (existing.needsPacking ?? 0) + (data.needsPacking ?? 0),
            breedingStock: (existing.breedingStock ?? 0) + (data.breedingStock ?? 0),
            availableForSale: (existing.availableForSale ?? 0) + (data.availableForSale ?? 0),
            produced: (existing.produced ?? 0) + (data.produced ?? 0),
            harvested: (existing.harvested ?? 0) + (data.harvested ?? 0),
            // Backfill a missing unit / zero cost from the new data; never clobber.
            unit: existing.unit || data.unit,
            unitCost: existing.unitCost > 0 ? existing.unitCost : (data.unitCost ?? 0),
            updatedAt: now(),
          };
          merged.endingQty = calcEnding(merged);
          set((state) => ({ items: state.items.map((i) => (i.id === existing.id ? merged : i)) }));
          return merged;
        }
        const item: InventoryItem = {
          packed: 0,
          needsPacking: 0,
          breedingStock: 0,
          availableForSale: 0,
          produced: 0,
          harvested: 0,
          ...data,
          endingQty: calcEnding({ packed: 0, needsPacking: 0, produced: 0, harvested: 0, ...data }),
          id: generateId(),
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ items: [...state.items, item] }));
        return item;
      },

      updateItem: (id, data) =>
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = { ...i, ...data, updatedAt: now() };
            updated.endingQty = calcEnding(updated);
            return updated;
          }),
        })),

      deleteItem: (id) =>
        set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

      getItem: (id) => get().items.find((i) => i.id === id),

      findByCategorySub: (category, subcategory) => {
        const c = norm(category);
        const sub = norm(subcategory);
        return get().items.find((i) => norm(i.category) === c && norm(i.subcategory) === sub);
      },

      adjustSold: (id, delta) =>
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = { ...i, sold: i.sold + delta, updatedAt: now() };
            updated.endingQty = calcEnding(updated);
            return updated;
          }),
        })),

      adjustUsedCuttings: (id, qty) => {
        const row = get().items.find((i) => i.id === id);
        if (!row) return 0;
        // Clamp to a positive amount and to what's actually on hand.
        const onHand = (row.needsPacking ?? 0) + (row.packed ?? 0);
        const toUse = Math.min(Math.max(0, qty), onHand);
        if (toUse <= 0) return 0;
        // Consume Needs Packing first, then spill the remainder into Packed
        // (and the still-unsold availableForSale subset alongside it).
        const fromNeedsPacking = Math.min(toUse, row.needsPacking ?? 0);
        const fromPacked = toUse - fromNeedsPacking;
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = {
              ...i,
              needsPacking: Math.max(0, (i.needsPacking ?? 0) - fromNeedsPacking),
              packed: Math.max(0, (i.packed ?? 0) - fromPacked),
              // Keep the sellable subset in step when packed stock is consumed.
              availableForSale: Math.max(0, (i.availableForSale ?? 0) - fromPacked),
              used: i.used + toUse,
              updatedAt: now(),
            };
            updated.endingQty = calcEnding(updated);
            return updated;
          }),
        }));
        return fromPacked;
      },

      adjustPurchased: (id, delta) =>
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = { ...i, purchased: i.purchased + delta, updatedAt: now() };
            updated.endingQty = calcEnding(updated);
            return updated;
          }),
        })),

      adjustPacked: (id, delta) =>
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = { ...i, packed: Math.max(0, (i.packed ?? 0) + delta), updatedAt: now() };
            updated.endingQty = calcEnding(updated);
            return updated;
          }),
        })),

      ensureRow: (category, subcategory, unit = 'piece') => {
        const existing = get().findByCategorySub(category, subcategory);
        if (existing) return existing;
        return get().addItem({
          category,
          subcategory,
          unit,
          beginningQty: 0,
          purchased: 0,
          used: 0,
          sold: 0,
          unitCost: 0,
          packed: 0,
          needsPacking: 0,
          breedingStock: 0,
          availableForSale: 0,
          produced: 0,
          harvested: 0,
          notes: '',
        });
      },

      adjustBreedingStock: (id, delta) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.id === id
              ? { ...i, breedingStock: Math.max(0, (i.breedingStock ?? 0) + delta), updatedAt: now() }
              : i,
          ),
        })),

      adjustAvailableForSale: (id, delta) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.id === id
              ? { ...i, availableForSale: Math.max(0, (i.availableForSale ?? 0) + delta), updatedAt: now() }
              : i,
          ),
        })),

      adjustNeedsPacking: (id, delta) =>
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = { ...i, needsPacking: Math.max(0, (i.needsPacking ?? 0) + delta), updatedAt: now() };
            updated.endingQty = calcEnding(updated);
            return updated;
          }),
        })),

      adjustProduced: (id, delta) =>
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = { ...i, produced: Math.max(0, (i.produced ?? 0) + delta), updatedAt: now() };
            updated.endingQty = calcEnding(updated);
            return updated;
          }),
        })),

      adjustHarvested: (id, delta) =>
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = { ...i, harvested: Math.max(0, (i.harvested ?? 0) + delta), updatedAt: now() };
            updated.endingQty = calcEnding(updated);
            return updated;
          }),
        })),

      packCuttings: (id, qty) => {
        const row = get().items.find((i) => i.id === id);
        if (!row) return 0;
        // Clamp to what's actually bare and to a positive amount.
        const toPack = Math.min(Math.max(0, qty), row.needsPacking ?? 0);
        if (toPack <= 0) return 0;
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = {
              ...i,
              needsPacking: Math.max(0, (i.needsPacking ?? 0) - toPack),
              packed: (i.packed ?? 0) + toPack,
              availableForSale: (i.availableForSale ?? 0) + toPack,
              updatedAt: now(),
            };
            // endingQty unchanged: needsPacking − toPack + packed + toPack nets 0.
            updated.endingQty = calcEnding(updated);
            return updated;
          }),
        }));
        return toPack;
      },

      unpackCuttings: (id, qty) => {
        const row = get().items.find((i) => i.id === id);
        if (!row) return 0;
        // Only unpack what's still unsold: clamp to both the requested qty and the
        // still-available (unsold) packed pool, so a partly-sold pack can't drive
        // pools negative. Moves packed + availableForSale back into needsPacking.
        const toUnpack = Math.min(Math.max(0, qty), row.availableForSale ?? 0, row.packed ?? 0);
        if (toUnpack <= 0) return 0;
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = {
              ...i,
              packed: Math.max(0, (i.packed ?? 0) - toUnpack),
              availableForSale: Math.max(0, (i.availableForSale ?? 0) - toUnpack),
              needsPacking: (i.needsPacking ?? 0) + toUnpack,
              updatedAt: now(),
            };
            // endingQty unchanged: the pools net to zero (mirror of packCuttings).
            updated.endingQty = calcEnding(updated);
            return updated;
          }),
        }));
        return toUnpack;
      },

      totalValue: () =>
        get().items.reduce((sum, i) => sum + i.endingQty * i.unitCost, 0),

      // Low stock = a physical-stock item at/under the threshold. A positive-but-low
      // qty must also be priced (unitCost > 0) to count — unpriced clutter shouldn't
      // nag. But a row that's out of stock (endingQty <= 0) always counts regardless
      // of price: zero stock is an alert no matter what. Excluded either way:
      //  - service categories (labor, delivery, utilities…) — auto, never stock,
      //  - rows manually flagged `ignoreLowStock` — the user's "ok to be low" opt-out.
      lowStockItems: (threshold = 5) =>
        get().items.filter(
          (i) =>
            i.endingQty <= threshold &&
            (i.endingQty <= 0 || i.unitCost > 0) &&
            !isServiceCategory(i.category) &&
            !i.ignoreLowStock,
        ),
    }),
    {
      name: 'dfd-inventory',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state._seeded < 4) {
          // Pre-v4 stores predate the current seed shape — reseed wholesale.
          state.items = SEED_ITEMS;
        } else {
          // v4→v9: keep existing rows, default the allocation pools (incl. the
          // needsPacking and produced pools), recompute endingQty, AND collapse
          // any duplicate (category, subcategory) rows into one so split stock is
          // merged.
          state.items = dedupeItems(state.items);
        }
        state._seeded = SEED_VERSION;
      },
    }
  )
);
