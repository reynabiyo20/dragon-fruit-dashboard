import type { PersistOptions } from 'zustand/middleware';

/**
 * Build a persist config that re-seeds a list when the stored seed version is
 * older than the current one. Removes the copy-pasted `onRehydrateStorage`
 * migration block from every store.
 *
 * The store's state must include a numeric `_seeded` field and the list under
 * `listKey`.
 *
 * @param name        localStorage key
 * @param listKey     the state property holding the seeded array
 * @param seed        the current seed array
 * @param seedVersion bump this to force existing users to receive fresh seed data
 */
export function seededPersist<S extends { _seeded: number }>(
  name: string,
  listKey: keyof S,
  seed: unknown,
  seedVersion: number
): PersistOptions<S> {
  return {
    name,
    // Bump the persist version whenever the seed version changes so Zustand
    // discards incompatible old localStorage rather than merging into it.
    version: seedVersion,
    onRehydrateStorage: () => (state) => {
      if (state && state._seeded < seedVersion) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (state as any)[listKey] = seed;
        state._seeded = seedVersion;
      }
    },
  };
}
