import { AlertTriangle } from 'lucide-react';
import type { DuplicateMatch } from '../../hooks/useDuplicateCheck';

interface DuplicateWarningProps<T> {
  matches: DuplicateMatch<T>[];
  /** Selects a display label for a matched entity */
  labelOf: (item: T) => string;
  /** Selects a unique key for a matched entity */
  keyOf: (item: T) => string;
  /** Noun for messaging, e.g. "customer" / "vendor" / "product" */
  noun: string;
  /** True when the match list was capped (more may exist) — shows "multiple" instead of a count */
  atLimit?: boolean;
  /** Optional: open/edit the existing entity instead of creating a new one */
  onUseExisting?: (item: T) => void;
}

/**
 * Soft, non-blocking warning shown while adding a record when one or more
 * existing records look like possible duplicates. Recommends the existing
 * entry but never prevents the user from creating a new one.
 */
export function DuplicateWarning<T>({
  matches,
  labelOf,
  keyOf,
  noun,
  atLimit = false,
  onUseExisting,
}: DuplicateWarningProps<T>) {
  if (matches.length === 0) return null;

  return (
    <div className="rounded-lg border border-gold-200 bg-gold-50 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-medium text-gold-800">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        Possible duplicate — {atLimit ? `multiple similar ${noun}s` : `${matches.length} similar ${noun}${matches.length !== 1 ? 's' : ''}`} found
      </div>
      <div className="space-y-1.5">
        {matches.map((m) => (
          <div
            key={keyOf(m.item)}
            className="flex items-center justify-between gap-2 rounded-md bg-white border border-gold-100 px-2.5 py-1.5"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{labelOf(m.item)}</p>
              <p className="text-xs text-gold-600">matches on {m.matchedOn.join(', ')}</p>
            </div>
            {onUseExisting && (
              <button
                type="button"
                onClick={() => onUseExisting(m.item)}
                className="flex-shrink-0 px-2.5 py-1 text-xs font-medium bg-white border border-gold-300 rounded-full text-gold-700 hover:bg-gold-100"
              >
                Open existing
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-gold-600">
        You can still add a new {noun} below if this is genuinely different.
      </p>
    </div>
  );
}
