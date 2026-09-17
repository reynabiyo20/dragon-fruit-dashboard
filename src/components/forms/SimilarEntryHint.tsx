import { useMemo } from 'react';

/**
 * Reusable "similar entry" + "already exists" hint for a free-typed value
 * (category, subcategory, or any name) checked against a list of existing
 * options. Standardizes the three previously hand-rolled variants:
 *   - EXACT match (case-insensitive) → a neutral "already exists" notice.
 *   - PARTIAL matches → blue suggestion chips the user can click to reuse.
 *
 * Purely presentational + advisory (non-blocking). Pass `onPick` to let the user
 * adopt an existing value.
 */
interface SimilarEntryHintProps {
  /** The value the user is typing. */
  value: string;
  /** Existing values to check against (e.g. subcategoriesFor(category)). */
  options: string[];
  /** Noun for messaging, e.g. "category", "subcategory", "variety". */
  noun?: string;
  /** Called when the user clicks a suggestion / the exact match to reuse it. */
  onPick?: (value: string) => void;
  /** Max partial suggestions to show. */
  limit?: number;
}

export function SimilarEntryHint({
  value,
  options,
  noun = 'entry',
  onPick,
  limit = 6,
}: SimilarEntryHintProps) {
  const key = value.trim().toLowerCase();

  const { exact, similar } = useMemo(() => {
    if (key.length < 2) return { exact: undefined as string | undefined, similar: [] as string[] };
    const exactMatch = options.find((o) => o.trim().toLowerCase() === key);
    if (exactMatch) return { exact: exactMatch, similar: [] as string[] };
    const similarMatches = options
      .filter((o) => {
        const l = o.trim().toLowerCase();
        return l.includes(key) || key.includes(l);
      })
      .slice(0, limit);
    return { exact: undefined as string | undefined, similar: similarMatches };
  }, [key, options, limit]);

  // Exact duplicate → tell the user it already exists.
  if (exact) {
    return (
      <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
        "{exact}" already exists as a {noun}.
        {onPick && exact !== value ? (
          <>
            {' '}
            <button
              type="button"
              onClick={() => onPick(exact)}
              className="underline font-medium hover:text-amber-800"
            >
              Use "{exact}"
            </button>
          </>
        ) : (
          ' Using the existing one keeps things tidy.'
        )}
      </div>
    );
  }

  // Partial matches → suggest reusing an existing value.
  if (similar.length > 0) {
    return (
      <div className="mt-1 rounded-lg border border-blue-100 bg-blue-50 p-2">
        <p className="text-xs font-medium text-blue-700 mb-1">Similar existing {noun}s:</p>
        <div className="flex flex-wrap gap-1.5">
          {similar.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick?.(s)}
              className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 rounded-full text-blue-700 hover:bg-blue-100 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-xs text-blue-500 mt-1.5">
          Click to reuse one, or keep "{value.trim()}" to add it as new.
        </p>
      </div>
    );
  }

  return null;
}
