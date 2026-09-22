import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProductionEntry } from '../types';
import { generateId, now } from '../utils/id';
import { recordHarvestInventory, reverseHarvestInventory, harvestSignature } from './inventoryLink';
import { useCuttingStore } from './cuttingStore';

/**
 * Sync the internal cutting batch that a Cuttings harvest owns. A `harvestKind:
 * 'Cuttings'` entry becomes an "Internal Batch" so it flows through the reserve →
 * plant → forecast lifecycle; anything else (Fruit / no variety) removes any
 * batch previously linked to this entry.
 */
function syncHarvestBatch(entry: ProductionEntry): void {
  const cuttings = useCuttingStore.getState();
  if ((entry.harvestKind ?? 'Fruit') === 'Cuttings') {
    cuttings.recordHarvestBatch({
      productionEntryId: entry.id,
      subcategory: (entry.subcategory ?? '').trim(),
      quantity: entry.goodFruits,
      harvestDate: entry.date,
      cuttingType: entry.cuttingType,
      rootWeeks: entry.rootWeeks,
      dateGrafted: entry.dateGrafted,
    });
  } else {
    cuttings.removeHarvestBatch(entry.id);
  }
}

type NewProductionInput = Omit<ProductionEntry, 'id' | 'damaged' | 'createdAt' | 'updatedAt'>;

interface ProductionState {
  entries: ProductionEntry[];
  addEntry: (data: NewProductionInput) => ProductionEntry;
  updateEntry: (id: string, data: Partial<Omit<ProductionEntry, 'id' | 'createdAt'>>) => void;
  deleteEntry: (id: string) => void;
  getEntry: (id: string) => ProductionEntry | undefined;
  totalHarvested: () => number;
  totalGoodFruits: () => number;
  totalDamaged: () => number;
  totalWeightKg: () => number;
}

export const useProductionStore = create<ProductionState>()(
  persist(
    (set, get) => ({
      entries: [],

      addEntry: (data) => {
        const entry: ProductionEntry = {
          ...data,
          damaged: data.fruitsHarvested - data.goodFruits,
          id: generateId(),
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ entries: [...state.entries, entry] }));
        // Fruit → credit the Fruit inventory row (no-op without a variety).
        recordHarvestInventory(entry);
        // Cuttings → create the internal batch that owns the lifecycle.
        syncHarvestBatch(entry);
        return entry;
      },

      updateEntry: (id, data) => {
        const prev = get().entries.find((e) => e.id === id);
        let next: ProductionEntry | undefined;
        set((state) => ({
          entries: state.entries.map((e) => {
            if (e.id !== id) return e;
            const updated = { ...e, ...data, updatedAt: now() };
            updated.damaged = updated.fruitsHarvested - updated.goodFruits;
            next = updated;
            return updated;
          }),
        }));
        // Reconcile inventory only when the harvest-relevant fields changed, so a
        // notes-only edit doesn't churn the harvested pool.
        if (prev && next && harvestSignature(prev) !== harvestSignature(next)) {
          reverseHarvestInventory(prev);
          recordHarvestInventory(next);
        }
        // Keep the linked cutting batch in step (variety/qty/date/type/rooting).
        // recordHarvestBatch is idempotent per entry id and reconciles removals
        // when the kind flips to Fruit or the variety/quantity is cleared.
        if (next) syncHarvestBatch(next);
      },

      deleteEntry: (id) => {
        const target = get().entries.find((e) => e.id === id);
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) }));
        // Remove the harvest's inventory credit + any linked cutting batch.
        if (target) {
          reverseHarvestInventory(target);
          useCuttingStore.getState().removeHarvestBatch(target.id);
        }
      },

      getEntry: (id) => get().entries.find((e) => e.id === id),

      totalHarvested: () => get().entries.reduce((sum, e) => sum + e.fruitsHarvested, 0),
      totalGoodFruits: () => get().entries.reduce((sum, e) => sum + e.goodFruits, 0),
      totalDamaged: () => get().entries.reduce((sum, e) => sum + e.damaged, 0),
      totalWeightKg: () => get().entries.reduce((sum, e) => sum + e.weightKg, 0),
    }),
    { name: 'dfd-production' }
  )
);
