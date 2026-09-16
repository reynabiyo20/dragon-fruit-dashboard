interface EntityMatchSuggestionsProps<T> {
  /** The currently typed name (for the heading) */
  query: string;
  /** Suggested existing entities that partially match */
  matches: T[];
  /** An exact-name match, if any */
  exact?: T;
  /** Selects the display label for an entity */
  labelOf: (item: T) => string;
  /** Selects a unique key for an entity */
  keyOf: (item: T) => string;
  /** Called when the user picks an existing entity */
  onUseExisting: (item: T) => void;
  /** Noun for messaging, e.g. "customer" / "vendor" */
  noun: string;
}

/**
 * Shared manual-entry dedupe UI: shows suggestion chips for partial matches,
 * a notice for an exact match, and a hint that new records are saved.
 * Used by SaleForm (customers) and ExpenseForm (vendors).
 */
export function EntityMatchSuggestions<T>({
  query,
  matches,
  exact,
  labelOf,
  keyOf,
  onUseExisting,
  noun,
}: EntityMatchSuggestionsProps<T>) {
  return (
    <>
      {/* Partial-match suggestions */}
      {matches.length > 0 && !exact && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-2">
          <p className="text-xs font-medium text-blue-700 mb-1">
            Existing {noun}s matching "{query.trim()}":
          </p>
          <div className="flex flex-wrap gap-1.5">
            {matches.map((item) => (
              <button
                key={keyOf(item)}
                type="button"
                onClick={() => onUseExisting(item)}
                className="px-2.5 py-1 text-xs font-medium bg-white border border-blue-200 rounded-full text-blue-700 hover:bg-blue-100 transition-colors"
              >
                {labelOf(item)}
              </button>
            ))}
          </div>
          <p className="text-xs text-blue-500 mt-1.5">
            Click to use an existing {noun}, or keep typing to add a new one.
          </p>
        </div>
      )}

      {/* Exact-match notice */}
      {exact && (
        <div className="rounded-lg border border-green-100 bg-green-50 p-2 flex items-center justify-between">
          <span className="text-xs text-green-700">
            "{labelOf(exact)}" already exists — this will link to their record.
          </span>
          <button
            type="button"
            onClick={() => onUseExisting(exact)}
            className="px-2.5 py-1 text-xs font-medium bg-white border border-green-200 rounded-full text-green-700 hover:bg-green-100"
          >
            Use existing
          </button>
        </div>
      )}

      {/* New-record hint */}
      {!exact && (
        <p className="text-xs text-gray-400">
          New {noun}s are saved to your {noun === 'customer' ? 'Customers' : 'Vendors'} list for next time.
        </p>
      )}
    </>
  );
}
