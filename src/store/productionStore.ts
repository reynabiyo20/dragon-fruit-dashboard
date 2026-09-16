import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProductionEntry } from '../types';
import { generateId, now } from '../utils/id';

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
        return entry;
      },

      updateEntry: (id, data) =>
        set((state) => ({
          entries: state.entries.map((e) => {
            if (e.id !== id) return e;
            const updated = { ...e, ...data, updatedAt: now() };
            updated.damaged = updated.fruitsHarvested - updated.goodFruits;
            return updated;
          }),
        })),

      deleteEntry: (id) =>
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),

      getEntry: (id) => get().entries.find((e) => e.id === id),

      totalHarvested: () => get().entries.reduce((sum, e) => sum + e.fruitsHarvested, 0),
      totalGoodFruits: () => get().entries.reduce((sum, e) => sum + e.goodFruits, 0),
      totalDamaged: () => get().entries.reduce((sum, e) => sum + e.damaged, 0),
      totalWeightKg: () => get().entries.reduce((sum, e) => sum + e.weightKg, 0),
    }),
    { name: 'dfd-production' }
  )
);
