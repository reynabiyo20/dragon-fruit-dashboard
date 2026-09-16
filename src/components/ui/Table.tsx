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

/** Optional bulk-selection config. When provided, the table shows a checkbox
 *  column, a select-all (of the filtered rows) header checkbox, and a toolbar
 *  with a bulk-delete action. `onDelete` receives the selected rows. */
export interface BulkActions<T> {
  onDelete: (rows: T[]) => void;
  /** Singular noun for the confirm copy, e.g. "sale". Defaults to "record". */
  noun?: string;
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
}: TableProps<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleSort = (key: string) => {
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
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return sortDir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return result;
  }, [data, query, sortKey, sortDir, columns, searchFilter]);

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

  const confirmBulkDelete = () => {
    const rows = filtered.filter((r) => selected.has(keyExtractor(r)));
    bulkActions?.onDelete(rows);
    clearSelection();
    setConfirmOpen(false);
  };

  const selectedCount = selectedInView.length;
  const columnCount = columns.length + (actions ? 1 : 0) + (selectable ? 1 : 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Selection toolbar takes over the top bar when rows are selected */}
      {selectable && selectedCount > 0 ? (
        <div className="px-4 py-3 border-b border-gray-100 bg-green-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={clearSelection}
              className="p-1 rounded text-gray-500 hover:text-gray-800 hover:bg-white/60"
              aria-label="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-green-800">
              {selectedCount} selected
            </span>
          </div>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 className="w-4 h-4" />}
            onClick={() => setConfirmOpen(true)}
          >
            Delete Selected
          </Button>
        </div>
      ) : (
        searchable && (
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
          </div>
        )
      )}
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {selectable && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={toggleAllVisible}
                    disabled={filteredKeys.length === 0}
                    className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500 cursor-pointer"
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortValue && handleSort(col.key)}
                  className={[
                    'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap',
                    col.sortValue ? 'cursor-pointer select-none hover:text-gray-900' : '',
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
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
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
                // Selection highlight wins; otherwise apply any per-row highlight,
                // falling back to the default hover style when there's none.
                const customRowClass = rowClassName?.(row) ?? '';
                const rowClass = isSelected
                  ? 'bg-green-50/60'
                  : customRowClass
                    ? customRowClass
                    : 'hover:bg-gray-50';
                return (
                  <tr
                    key={key}
                    className={`transition-colors ${rowClass}`}
                  >
                    {selectable && (
                      <td className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(key)}
                          className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500 cursor-pointer"
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

      {selectable && (
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
        className="group/edit flex items-center gap-1 text-left w-full rounded px-1 -mx-1 hover:bg-green-50 focus:outline-none focus:ring-1 focus:ring-green-400"
        title="Click to edit"
      >
        <span className="min-w-0">{display}</span>
        <Pencil className="w-3 h-3 text-gray-300 opacity-0 group-hover/edit:opacity-100 flex-shrink-0" />
      </button>
    );
  }

  const commonClass =
    'w-full px-2 py-1 text-sm border border-green-400 rounded focus:outline-none focus:ring-1 focus:ring-green-500 bg-white';

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
