import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Option } from '../constants';

/** Case-insensitive alphabetical sort for option values (stable, non-mutating). */
function sortValues(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * A persisted, user-editable list of string options (e.g. customer types,
 * inventory categories, units). Backs "create new…" dropdowns so a value the
 * user adds reappears in future dropdowns.
 *
 * This is the generic version of the pattern that expenseCategoryStore uses for
 * its (richer) category/subcategory data.
 */
export interface OptionListStore {
  values: string[];
  /** Seed version this list was last reset to (see createOptionListStore). */
  _seeded: number;
  add: (value: string) => void;
  /** Rename an existing value in place (keeps list order). No-op if the new name collides with another entry. */
  rename: (oldValue: string, newValue: string) => void;
  remove: (value: string) => void;
  /** As {value,label} options for SelectField */
  options: () => Option[];
}

/**
 * Build a persisted option-list store.
 * @param name        localStorage key (unique per list)
 * @param seed        initial values
 * @param onRename    optional cascade fired AFTER a successful rename, so records
 *                    that stored the old value can be updated to the new one.
 *                    Not fired for no-ops or collisions.
 * @param seedVersion bump this to force existing users' persisted list to reset
 *                    back to `seed` on next load (e.g. after renaming a seeded
 *                    category). User-added values are replaced by the fresh seed,
 *                    matching the behaviour of the other seeded stores. Defaults
 *                    to 0 (never force-reseed) for lists that shouldn't reset.
 */
export function createOptionListStore(
  name: string,
  seed: readonly string[],
  onRename?: (from: string, to: string) => void,
  seedVersion = 0,
) {
  return create<OptionListStore>()(
    persist(
      (set, get) => ({
        // Values are kept sorted alphabetically so every dropdown that reads
        // them (or `options()`) is ordered by default.
        values: sortValues([...seed]),
        _seeded: seedVersion,

        add: (value) => {
          const v = value.trim();
          if (!v) return;
          set((state) =>
            state.values.some((x) => x.toLowerCase() === v.toLowerCase())
              ? state
              : { values: sortValues([...state.values, v]) }
          );
        },

        rename: (oldValue, newValue) => {
          const next = newValue.trim();
          if (!next || next === oldValue) return;
          let renamed = false;
          set((state) => {
            // Don't allow a rename to collide with a different existing entry
            const collides = state.values.some(
              (x) => x !== oldValue && x.toLowerCase() === next.toLowerCase()
            );
            if (collides) return state;
            renamed = true;
            return { values: sortValues(state.values.map((x) => (x === oldValue ? next : x))) };
          });
          // Propagate to dependent records once the option itself is renamed.
          if (renamed) onRename?.(oldValue, next);
        },

        remove: (value) =>
          set((state) => ({ values: state.values.filter((x) => x !== value) })),

        options: () => sortValues(get().values).map((v) => ({ value: v, label: v })),
      }),
      {
        name,
        // `version` + `migrate` is zustand's purpose-built mechanism for "the
        // seed changed, reset the persisted list." When the stored version is
        // older than seedVersion, we return the fresh seed. This runs during
        // rehydration before first render, so the UI shows the new values.
        version: seedVersion,
        migrate: (persisted, version) => {
          if (seedVersion > 0 && version < seedVersion) {
            return { ...(persisted as OptionListStore), values: sortValues([...seed]), _seeded: seedVersion };
          }
          return persisted as OptionListStore;
        },
        // Ensure previously-persisted (unsorted) lists are sorted on load, so
        // every consumer reading `values` directly is ordered too.
        onRehydrateStorage: () => (state) => {
          if (state) state.values = sortValues(state.values);
        },
      }
    )
  );
}
