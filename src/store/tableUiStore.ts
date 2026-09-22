import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Persisted, per-table UI state: the search query and sort applied to a list
 * table. Keyed by a stable `persistKey` (e.g. "customers", "vendors") so each
 * store's table remembers its own sort/search independently.
 *
 * Why this exists: every list page renders the shared <Table> whose sort/search
 * lived in local state. Pages are lazy routes that unmount on navigation, so
 * that state reset every time. Lifting it here — behind `persist` — keeps the
 * previous sort/search until the user actively clears it, even across page
 * switches and reloads.
 */
export interface TableUiState {
  /** Current search text. Empty string means "not searching / cleared". */
  query: string;
  /** Active sort column key, or null for no explicit sort. */
  sortKey: string | null;
  /** Sort direction for `sortKey`. */
  sortDir: 'asc' | 'desc';
  /** Whether the user has manually clicked a header (disables recency pinning). */
  userSorted: boolean;
}

interface TableUiStore {
  /** Per-table state, keyed by the table's `persistKey`. */
  byKey: Record<string, TableUiState>;
  /** Merge a partial update into the state for `key`. */
  patch: (key: string, partial: Partial<TableUiState>) => void;
}

export const useTableUiStore = create<TableUiStore>()(
  persist(
    (set) => ({
      byKey: {},
      patch: (key, partial) =>
        set((state) => ({
          byKey: {
            ...state.byKey,
            [key]: { ...state.byKey[key], ...partial },
          },
        })),
    }),
    { name: 'dfd-table-ui', version: 1 }
  )
);

/**
 * Read the persisted UI state for a table, falling back to the given defaults
 * for any field that has never been set. Returns a fully-populated object so
 * callers can use it to seed the Table's working state.
 */
export function getTableUiState(
  key: string,
  defaults: { sortKey: string | null; sortDir: 'asc' | 'desc' }
): TableUiState {
  const stored = useTableUiStore.getState().byKey[key];
  return {
    query: stored?.query ?? '',
    sortKey: stored?.sortKey ?? defaults.sortKey,
    sortDir: stored?.sortDir ?? defaults.sortDir,
    userSorted: stored?.userSorted ?? false,
  };
}
