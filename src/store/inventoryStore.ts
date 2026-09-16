import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InventoryItem } from '../types';
import { generateId, now } from '../utils/id';

/** Auto-calculate ending quantity */
function calcEnding(item: Pick<InventoryItem, 'beginningQty' | 'purchased' | 'used' | 'sold'>): number {
  return item.beginningQty + item.purchased - item.used - item.sold;
}

/** Normalize a category/subcategory token for tolerant matching (case + whitespace). */
function norm(value: string): string {
  return value.trim().toLowerCase();
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
  /** Add `delta` to an item's `purchased` (negative reverses); recomputes endingQty. */
  adjustPurchased: (id: string, delta: number) => void;
  /** Add `delta` to an item's `breedingStock` pool (never below 0). */
  adjustBreedingStock: (id: string, delta: number) => void;
  /** Add `delta` to an item's `availableForSale` pool (never below 0). */
  adjustAvailableForSale: (id: string, delta: number) => void;
  /** Total inventory value = sum of endingQty * unitCost */
  totalValue: () => number;
  /** Items where endingQty <= lowStockThreshold */
  lowStockItems: (threshold?: number) => InventoryItem[];
}

const SEED_VERSION = 5;

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
    breedingStock: 0,
    availableForSale: 0,
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
        const item: InventoryItem = {
          breedingStock: 0,
          availableForSale: 0,
          ...data,
          endingQty: calcEnding(data),
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

      adjustPurchased: (id, delta) =>
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id) return i;
            const updated = { ...i, purchased: i.purchased + delta, updatedAt: now() };
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
          breedingStock: 0,
          availableForSale: 0,
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

      totalValue: () =>
        get().items.reduce((sum, i) => sum + i.endingQty * i.unitCost, 0),

      lowStockItems: (threshold = 5) =>
        get().items.filter((i) => i.endingQty <= threshold && i.unitCost > 0),
    }),
    {
      name: 'dfd-inventory',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state._seeded < 4) {
          // Pre-v4 stores predate the current seed shape — reseed wholesale.
          state.items = SEED_ITEMS;
        } else {
          // v4→v5: keep existing rows, just default the new allocation pools.
          state.items = state.items.map((i) => ({
            breedingStock: 0,
            availableForSale: 0,
            ...i,
          }));
        }
        state._seeded = SEED_VERSION;
      },
    }
  )
);
