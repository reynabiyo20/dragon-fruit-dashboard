import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { registerServiceCategory, setCustomServiceCategories, isServiceCategory } from '../constants';

/**
 * User-defined service categories.
 *
 * The built-in service categories live in the static `SERVICE_CATEGORIES`
 * constant, but the Service expense form lets the user type a brand-new
 * category. For that category to behave like a service everywhere — routing an
 * edited expense back to the Service form, and being skipped by the
 * inventory/resell flow — its "service-ness" has to persist beyond the single
 * expense record.
 *
 * This store is that persisted source of truth. It mirrors its names into the
 * module-level registry in `constants` (via `registerServiceCategory` /
 * `setCustomServiceCategories`) so `isServiceCategory` stays a synchronous,
 * store-free function that stores can call without a circular import.
 */
interface ServiceCategoryState {
  /** Custom service-category names as the user typed them (display casing). */
  names: string[];
  /**
   * Register a category name as a service (idempotent, case-insensitive).
   * Built-in service categories are ignored — they're already recognized.
   */
  add: (name: string) => void;
}

export const useServiceCategoryStore = create<ServiceCategoryState>()(
  persist(
    (set, get) => ({
      names: [],
      add: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const norm = (s: string) => s.trim().toLowerCase();
        // Already recognized (built-in or previously added) → nothing to persist,
        // but ensure the registry knows about it (cheap + idempotent).
        if (isServiceCategory(trimmed)) {
          registerServiceCategory(trimmed);
          return;
        }
        // Genuinely new custom service category → register + persist.
        if (get().names.some((n) => norm(n) === norm(trimmed))) return; // dedupe guard
        registerServiceCategory(trimmed);
        set((state) => ({ names: [...state.names, trimmed] }));
      },
    }),
    {
      name: 'dfd-service-categories',
      onRehydrateStorage: () => (state) => {
        // Re-seed the module-level registry from the persisted list so
        // isServiceCategory recognizes custom services immediately after load.
        if (state) setCustomServiceCategories(state.names);
      },
    },
  ),
);
