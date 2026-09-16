import { useMemo } from 'react';

/**
 * Given a typed name and a list of entities, find suggestions and an exact match.
 * Powers the manual-entry dedupe UX shared by Sales (customers) and Expenses (vendors).
 *
 * @param query      the currently typed name
 * @param list       the entities to search
 * @param nameOf     selects the display name from an entity
 * @param active     only compute when true (e.g. manual-entry mode is on)
 * @param limit      max suggestions to return
 */
export function useEntityMatch<T>(
  query: string,
  list: T[],
  nameOf: (item: T) => string,
  active: boolean,
  limit = 5
) {
  const trimmed = query.trim().toLowerCase();

  return useMemo(() => {
    if (!active || trimmed.length < 2) {
      return { matches: [] as T[], exact: undefined as T | undefined };
    }
    const matches = list
      .filter((item) => nameOf(item).toLowerCase().includes(trimmed))
      .slice(0, limit);
    const exact = list.find((item) => nameOf(item).trim().toLowerCase() === trimmed);
    return { matches, exact };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, list, active, limit]);
}
