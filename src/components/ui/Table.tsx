import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, Trash2, X, Pencil } from 'lucide-react';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';

/** Inline-edit config for a column. When present, the cell becomes editable. */
export interface EditableConfig<T> {
  type: 'text' | 'number' | 'select';
  /** Options for a select editor. */
  options?: { value: string; label: string }[];
  /** Current raw value to seed the editor (defaults to String(accessor) is unsafe, so provide this). */
  getValue: (row: T) => string | number;
  step?: string; // for number inputs
  min?: number;
}

export interface Column<T> {
  key: string;
  header: string;
  accessor: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
  headerClassName?: string;
  /** When set, this cell can be edited inline. */
  editable?: EditableConfig<T>;
}

/** A custom bulk action button shown in the selection toolbar (e.g. "Mark Paid").
 *  `onClick` receives the currently-selected rows. */
export interface BulkAction<T> {
  label: string;
  icon?: ReactNode;
  onClick: (rows: T[]) => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
}

/** Optional bulk-selection config. When provided, the table shows a checkbox
 *  column, a select-all (of the filtered rows) header checkbox, and a toolbar.
 *  `onDelete` (optional) adds a confirm-guarded bulk-delete button; `actions`
 *  adds any number of extra bulk buttons (e.g. bulk status changes). The
 *  selection is cleared after any action runs. */
export interface BulkActions<T> {
  onDelete?: (rows: T[]) => void;
  /** Singular noun for the delete confirm copy, e.g. "sale". Defaults to "record". */
  noun?: string;
  /** Extra bulk actions rendered as buttons alongside (or instead of) delete. */
  actions?: BulkAction<T>[];
}

interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (row: T) => string;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFilter?: (row: T, query: string) => boolean;
  emptyMessage?: string;
  actions?: (row: T) => ReactNode;
  bulkActions?: BulkActions<T>;
  /** Called when an editable cell is committed. `value` is string for text/select, number for number. */
  onCellEdit?: (row: T, columnKey: string, value: string | number) => void;
  /**
   * Optional per-row highlight classes (e.g. a soft-orange harvest alert). Applied
   * on top of the base row styles; the selection highlight still takes precedence
   * for selected rows. Return '' for no highlight.
   */
  rowClassName?: (row: T) => string;
  /**
   * Initial sort applied on first render (the table's natural default order).
   * The user can override it by clicking any column header. `key` must match a
   * column with a `sortValue`.
   */
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  /**
   * When set, the single most-recently-created row (by the string returned here,
   * e.g. `createdAt`) floats to the TOP until the user clicks a column header —
   * so a freshly added record is immediately visible. After any manual sort this
   * pinning stops. Return '' to opt a row out.
   */
  getRecency?: (row: T) => string;
  /**
   * When set, the row whose key equals this value is briefly highlighted and
   * scrolled into view — used when navigating here from a cross-link (e.g. a
   * sale's salesperson linking to the Employees table). Changing the value
   * re-triggers the highlight; clears itself after a short pulse.
   */
  focusId?: string | null;
}

export function Table<T>({
  data,
  columns,
  keyExtractor,
  searchable = true,
  searchPlaceholder = 'Search…',
  searchFilter,
  emptyMessage = 'No records found.',
  actions,
  bulkActions,
  onCellEdit,
  rowClassName,
  defaultSort,
  getRecency,
  focusId,
}: TableProps<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(defaultSort?.key ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSort?.dir ?? 'asc');
  // Whether the user has clicked a header to sort. Until they do, a just-created
  // row is pinned to the top (see getRecency). After a manual sort, pinning stops.
  const [userSorted, setUserSorted] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The row currently pulsing from a cross-link focus. Mirrors `focusId` but
  // clears itself after the highlight so the row settles back to normal.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const focusRowRef = useRef<HTMLTableRowElement | null>(null);

  // When `focusId` changes to a real value, clear any search that might hide the
  // row, flag it for highlight, scroll it into view, then fade the highlight.
  useEffect(() => {
    if (!focusId) return;
    setQuery('');
    setFocusedKey(focusId);
    const scrollTimer = setTimeout(() => {
      focusRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    const clearTimer = setTimeout(() => setFocusedKey(null), 2600);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [focusId]);

  // Baseline recency captured at mount: the newest `getRecency` value among the
  // rows that already existed. Only rows created AFTER this (genuinely added in
  // this session) get pinned to the top — pre-existing/seed rows never do, so
  // the list reads as a clean default sort until you add something.
  const baselineRecency = useRef<string | null>(null);
  if (baselineRecency.current === null && getRecency) {
    baselineRecency.current = data.reduce((max, row) => {
      const r = getRecency(row) ?? '';
      return r > max ? r : max;
    }, '');
  }

  const handleSort = (key: string) => {
    setUserSorted(true);
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    let result = data;
    if (query && searchFilter) {
      result = result.filter((row) => searchFilter(row, query.toLowerCase()));
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col?.sortValue) {
        result = [...result].sort((a, b) => {
          const av = col.sortValue!(a);
          const bv = col.sortValue!(b);
          let cmp: number;
          if (typeof av === 'string' || typeof bv === 'string') {
            // Case-insensitive, whitespace-tolerant, locale-aware string compare
            // so "flowers" and "Webinar" order naturally (not by char code).
            cmp = String(av).trim().localeCompare(String(bv).trim(), undefined, {
              sensitivity: 'base',
              numeric: true,
            });
          } else {
            cmp = av < bv ? -1 : av > bv ? 1 : 0;
          }
          return sortDir === 'asc' ? cmp : -cmp;
        });
      }
    }
    // Until the user manually sorts, float the single most-recently-created row
    // to the top — but only if it was created AFTER mount (a genuine new entry),
    // so seeded/pre-existing rows keep the clean default sort.
    if (!userSorted && getRecency) {
      const baseline = baselineRecency.current ?? '';
      let newest: T | undefined;
      let newestKey = baseline;
      for (const row of result) {
        const r = getRecency(row);
        if (r && r > newestKey) { newestKey = r; newest = row; }
      }
      if (newest) {
        const rest = result.filter((r) => r !== newest);
        result = [newest, ...rest];
      }
    }
    return result;
  }, [data, query, sortKey, sortDir, columns, searchFilter, userSorted, getRecency]);

  // ── Selection (scoped to the currently filtered rows) ──
  const selectable = !!bulkActions;
  const filteredKeys = useMemo(() => filtered.map(keyExtractor), [filtered, keyExtractor]);
  const selectedInView = filteredKeys.filter((k) => selected.has(k));
  const allVisibleSelected = filteredKeys.length > 0 && selectedInView.length === filteredKeys.length;
  const someVisibleSelected = selectedInView.length > 0 && !allVisibleSelected;

  const toggleRow = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredKeys.forEach((k) => next.delete(k));
      } else {
        filteredKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  /** Rows currently selected AND still present in the filtered view. */
  const selectedRows = () => filtered.filter((r) => selected.has(keyExtractor(r)));

  const confirmBulkDelete = () => {
    bulkActions?.onDelete?.(selectedRows());
    clearSelection();
    setConfirmOpen(false);
  };

  const runBulkAction = (action: BulkAction<T>) => {
    action.onClick(selectedRows());
    clearSelection();
  };

  const selectedCount = selectedInView.length;
  const columnCount = columns.length + (actions ? 1 : 0) + (selectable ? 1 : 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Selection toolbar takes over the top bar when rows are selected */}
      {selectable && selectedCount > 0 ? (
        <div className="px-4 py-3 border-b border-gray-100 bg-primary-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={clearSelection}
              className="p-1 rounded text-gray-500 hover:text-gray-800 hover:bg-white/60"
              aria-label="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-primary-800">
              {selectedCount} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            {(bulkActions?.actions ?? []).map((action) => (
              <Button
                key={action.label}
                variant={action.variant ?? 'outline'}
                size="sm"
                icon={action.icon}
                onClick={() => runBulkAction(action)}
              >
                {action.label}
              </Button>
            ))}
            {bulkActions?.onDelete && (
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="w-4 h-4" />}
                onClick={() => setConfirmOpen(true)}
              >
                Delete Selected
              </Button>
            )}
          </div>
        </div>
      ) : (
        searchable && (
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }}
                placeholder={searchPlaceholder}
                className="w-full pl-9 pr-9 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )
      )}
      <div className="overflow-auto scrollbar-thin max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-primary-50 border-b border-primary-100">
              {selectable && (
                <th className="px-4 py-3 w-10 bg-primary-50">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={toggleAllVisible}
                    disabled={filteredKeys.length === 0}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer"
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortValue && handleSort(col.key)}
                  className={[
                    'px-4 py-3 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider whitespace-nowrap bg-primary-50',
                    col.sortValue ? 'cursor-pointer select-none hover:text-primary-900' : '',
                    col.headerClassName ?? '',
                  ].join(' ')}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortValue && (
                      sortKey === col.key
                        ? sortDir === 'asc'
                          ? <ChevronUp className="w-3 h-3" />
                          : <ChevronDown className="w-3 h-3" />
                        : <ChevronsUpDown className="w-3 h-3 text-gray-300" />
                    )}
                  </span>
                </th>
              ))}
              {actions && (
                <th className="px-4 py-3 text-right text-xs font-semibold text-primary-800 uppercase tracking-wider bg-primary-50">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-4 py-12 text-center text-sm text-gray-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const key = keyExtractor(row);
                const isSelected = selected.has(key);
                const isFocused = focusedKey === key;
                // Focus highlight (cross-link) wins, then selection, then any
                // per-row highlight, falling back to the default hover style.
                const customRowClass = rowClassName?.(row) ?? '';
                const rowClass = isFocused
                  ? 'bg-gold-100 ring-2 ring-inset ring-gold-400'
                  : isSelected
                    ? 'bg-primary-50/60'
                    : customRowClass
                      ? customRowClass
                      : 'hover:bg-primary-50/50';
                return (
                  <tr
                    key={key}
                    ref={isFocused ? focusRowRef : undefined}
                    className={`transition-colors ${rowClass}`}
                  >
                    {selectable && (
                      <td className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(key)}
                          className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer"
                          aria-label="Select row"
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className={`px-4 py-3 text-gray-700 ${col.className ?? ''}`}>
                        {col.editable && onCellEdit ? (
                          <EditableCell
                            display={col.accessor(row)}
                            config={col.editable}
                            row={row}
                            onCommit={(value) => onCellEdit(row, col.key, value)}
                          />
                        ) : (
                          col.accessor(row)
                        )}
                      </td>
                    ))}
                    {actions && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {actions(row)}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
          {filtered.length} of {data.length} record{data.length !== 1 ? 's' : ''}
        </div>
      )}

      {selectable && bulkActions?.onDelete && (
        <ConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={confirmBulkDelete}
          title="Delete selected"
          message={`Delete ${selectedCount} ${bulkActions?.noun ?? 'record'}${selectedCount !== 1 ? 's' : ''}? This cannot be undone.`}
          confirmLabel="Delete"
        />
      )}
    </div>
  );
}

/* ── Inline-editable cell ──────────────────────────────────────────────────────
 * Shows the column's normal formatted output until clicked, then swaps to an
 * input. Commits on blur or Enter, cancels on Escape. Only the committed value
 * is sent to the store, so derived fields recompute there.
 */
interface EditableCellProps<T> {
  display: ReactNode;
  config: EditableConfig<T>;
  row: T;
  onCommit: (value: string | number) => void;
}

function EditableCell<T>({ display, config, row, onCommit }: EditableCellProps<T>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  const start = () => {
    setDraft(String(config.getValue(row) ?? ''));
    setEditing(true);
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const raw = draft.trim();
    const original = String(config.getValue(row) ?? '');
    if (raw === original) return; // no change
    onCommit(config.type === 'number' ? Number(raw) || 0 : raw);
  };

  const cancel = () => setEditing(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        className="group/edit flex items-center gap-1 text-left w-full rounded px-1 -mx-1 hover:bg-primary-50 focus:outline-none focus:ring-1 focus:ring-primary-400"
        title="Click to edit"
      >
        <span className="min-w-0">{display}</span>
        <Pencil className="w-3 h-3 text-gray-300 opacity-0 group-hover/edit:opacity-100 flex-shrink-0" />
      </button>
    );
  }

  const commonClass =
    'w-full px-2 py-1 text-sm border border-primary-400 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white';

  if (config.type === 'select') {
    return (
      <select
        ref={(el) => { inputRef.current = el; }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        className={commonClass}
      >
        {(config.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      ref={(el) => { inputRef.current = el; }}
      type={config.type === 'number' ? 'number' : 'text'}
      step={config.step}
      min={config.min}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      className={commonClass}
    />
  );
}
