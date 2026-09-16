import { useMemo } from 'react';

/** A single field to compare when detecting duplicates */
export interface DuplicateField<T> {
  /** Human label shown in the warning, e.g. "Name", "Phone" */
  label: string;
  /** The value currently typed in the form for this field */
  value: string;
  /** Selects the corresponding value from an existing entity */
  of: (item: T) => string;
}

export interface DuplicateMatch<T> {
  item: T;
  /** Which field labels matched, e.g. ["Name", "Phone"] */
  matchedOn: string[];
}

/**
 * Detects likely-duplicate records as the user fills out an Add form.
 *
 * For each existing entity, compares every configured field: a field counts as
 * a match when both the typed value and the stored value are non-trivial and one
 * contains the other (case-insensitive). Any entity with ≥1 matching field is
 * surfaced, with the list of fields that matched.
 *
 * @param list    existing entities to scan
 * @param fields  field comparisons to run
 * @param active  only compute when true — pass `!isEditing` so edits are skipped
 * @param minLen  minimum trimmed length for a value to be considered (avoids noise)
 * @param limit   max matches to return
 */
export function useDuplicateCheck<T>(
  list: T[],
  fields: DuplicateField<T>[],
  active: boolean,
  minLen = 2,
  limit = 5
): DuplicateMatch<T>[] {
  // Serialize field values so the memo re-runs when any typed value changes
  const valuesKey = fields.map((f) => f.value).join('|');

  return useMemo(() => {
    if (!active) return [];

    const norm = (s: string) => s.trim().toLowerCase();
    const fieldMatches = (typed: string, stored: string): boolean => {
      const a = norm(typed);
      const b = norm(stored);
      if (a.length < minLen || b.length < minLen) return false;
      return a === b || a.includes(b) || b.includes(a);
    };

    const results: DuplicateMatch<T>[] = [];
    for (const item of list) {
      const matchedOn: string[] = [];
      for (const f of fields) {
        if (fieldMatches(f.value, f.of(item))) {
          matchedOn.push(f.label);
        }
      }
      if (matchedOn.length > 0) {
        results.push({ item, matchedOn });
      }
      if (results.length >= limit) break;
    }
    return results;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, valuesKey, active, minLen, limit]);
}
