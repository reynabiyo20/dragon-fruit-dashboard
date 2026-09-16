import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CommissionEntry } from '../types';
import { generateId, now } from '../utils/id';

type NewCommissionInput = Omit<CommissionEntry, 'id' | 'commissionAmount' | 'createdAt' | 'updatedAt'>;

interface CommissionState {
  entries: CommissionEntry[];
  addEntry: (data: NewCommissionInput) => CommissionEntry;
  updateEntry: (id: string, data: Partial<Omit<CommissionEntry, 'id' | 'createdAt'>>) => void;
  deleteEntry: (id: string) => void;
  /**
   * Upsert the commission entry linked to a specific sale. Called whenever a sale
   * with a salesperson is created or edited. If a salesperson was removed from the
   * sale, pass the data with commissionPct 0 (or call removeForSale instead).
   */
  setForSale: (data: NewCommissionInput) => void;
  /** Remove the commission entry linked to a sale (when sale is deleted or salesperson cleared) */
  removeForSale: (saleId: string) => void;
  /** All commission entries for an employee within an inclusive date range (YYYY-MM-DD) */
  forEmployeeInRange: (employeeId: string, start: string, end: string) => CommissionEntry[];
  totalByEmployee: () => Record<string, number>;
  totalCommissions: () => number;
}

export const useCommissionStore = create<CommissionState>()(
  persist(
    (set, get) => ({
      entries: [],

      addEntry: (data) => {
        const commissionAmount = (data.saleAmount * data.commissionPct) / 100;
        const entry: CommissionEntry = {
          ...data,
          commissionAmount,
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
            updated.commissionAmount = (updated.saleAmount * updated.commissionPct) / 100;
            return updated;
          }),
        })),

      deleteEntry: (id) =>
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),

      setForSale: (data) =>
        set((state) => {
          const commissionAmount = (data.saleAmount * data.commissionPct) / 100;
          const existing = state.entries.find((e) => e.saleId === data.saleId);
          if (existing) {
            // Update in place
            return {
              entries: state.entries.map((e) =>
                e.saleId === data.saleId
                  ? { ...e, ...data, commissionAmount, updatedAt: now() }
                  : e
              ),
            };
          }
          // Create new
          const entry: CommissionEntry = {
            ...data,
            commissionAmount,
            id: generateId(),
            createdAt: now(),
            updatedAt: now(),
          };
          return { entries: [...state.entries, entry] };
        }),

      removeForSale: (saleId) =>
        set((state) => ({ entries: state.entries.filter((e) => e.saleId !== saleId) })),

      forEmployeeInRange: (employeeId, start, end) =>
        get().entries.filter(
          (e) =>
            e.employeeId === employeeId &&
            (!start || e.date >= start) &&
            (!end || e.date <= end)
        ),

      totalByEmployee: () =>
        get().entries.reduce<Record<string, number>>((acc, e) => {
          acc[e.employeeName] = (acc[e.employeeName] ?? 0) + e.commissionAmount;
          return acc;
        }, {}),

      totalCommissions: () =>
        get().entries.reduce((sum, e) => sum + e.commissionAmount, 0),
    }),
    { name: 'dfd-commissions' }
  )
);
