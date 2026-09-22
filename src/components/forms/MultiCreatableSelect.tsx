import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Option } from '../../constants';
import { Button } from '../ui/Button';
import { SimilarEntryHint } from './SimilarEntryHint';

interface MultiCreatableSelectProps {
  label: string;
  /** Currently selected values. */
  values: string[];
  /** Full option list, each rendered as a checkbox. */
  options: Option[];
  /**
   * A SUPERSET of `options` used only for the "already exists / similar entry"
   * detection while creating (and to avoid creating a duplicate). Defaults to
   * `options`.
   */
  matchOptions?: Option[];
  /** Called with the next full list of selected values whenever it changes. */
  onChange: (values: string[]) => void;
  /**
   * Called when the user confirms a brand-new value (not present in the options
   * yet); should persist it into the underlying taxonomy. The value is also
   * ticked in the selection.
   */
  onCreate: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  createLabel?: string;
  newFieldLabel?: string;
  newFieldPlaceholder?: string;
  /** Optional helper text shown under the control. */
  hint?: string;
}

/**
 * A checkbox-list multi-select. Every option is a checkbox the user can tick to
 * (de)select in bulk. Values already selected but not present in `options`
 * (e.g. a previously-saved custom variety) are shown as extra checkboxes so they
 * stay visible and toggleable. An inline "add new" flow appends a brand-new
 * value (persisted via `onCreate`) and ticks it. Comparisons are
 * case-insensitive so the same value can't be added twice.
 */
export function MultiCreatableSelect({
  label,
  values,
  options,
  matchOptions,
  onChange,
  onCreate,
  required,
  placeholder = 'No options yet.',
  error,
  disabled,
  createLabel = '+ Add new…',
  newFieldLabel = 'New value',
  newFieldPlaceholder = 'Type a new value…',
  hint,
}: MultiCreatableSelectProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState('');

  const detectOptions = matchOptions ?? options;
  const norm = (s: string) => s.trim().toLowerCase();
  const isChecked = (v: string) => values.some((x) => norm(x) === norm(v));

  // Render every option, plus any selected value that isn't in the option list
  // (e.g. a custom variety saved earlier) so it stays visible/toggleable.
  const optionValues = options.map((o) => o.value);
  const extraSelected = values.filter((v) => !optionValues.some((o) => norm(o) === norm(v)));
  const checkboxItems: Option[] = [
    ...options,
    ...extraSelected.map((v) => ({ value: v, label: v })),
  ];

  const toggle = (v: string) => {
    if (disabled) return;
    if (isChecked(v)) {
      onChange(values.filter((x) => norm(x) !== norm(v)));
    } else {
      onChange([...values, v]);
    }
  };

  // Select-all / clear over the currently listed items. "All selected" means
  // every rendered checkbox is ticked; the toggle then clears everything.
  const allValues = checkboxItems.map((o) => o.value);
  const allChecked = allValues.length > 0 && allValues.every((v) => isChecked(v));
  const toggleAll = () => {
    if (disabled) return;
    onChange(allChecked ? [] : allValues);
  };

  const add = (v: string) => {
    const value = v.trim();
    if (!value || isChecked(value)) return;
    onChange([...values, value]);
  };

  const pickExisting = (v: string) => {
    add(v);
    setCreating(false);
    setDraft('');
    setLocalError('');
  };

  const confirmCreate = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const v = draft.trim();
    if (!v) {
      setLocalError('Enter a value');
      return;
    }
    // Reuse an existing value (anywhere in the detection set) instead of creating
    // a case-variant duplicate.
    const existing = detectOptions.find((o) => norm(o.value) === norm(v));
    if (existing) {
      pickExisting(existing.value);
      return;
    }
    if (!isChecked(v)) {
      onCreate(v);
      add(v);
    }
    setCreating(false);
    setDraft('');
    setLocalError('');
  };

  const cancelCreate = () => {
    setCreating(false);
    setDraft('');
    setLocalError('');
  };

  return (
    <fieldset className="flex flex-col gap-1" disabled={disabled}>
      <legend className="text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </legend>

      {/* Checkbox list — tick as many as apply. */}
      <div
        className={[
          'rounded-lg border p-2 max-h-64 overflow-y-auto',
          error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white',
          disabled ? 'opacity-60' : '',
        ].join(' ')}
      >
        {checkboxItems.length === 0 ? (
          <p className="text-sm text-gray-400 px-1 py-1">{placeholder}</p>
        ) : (
          <>
            {/* Select-all / clear header. */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-1.5 mb-1.5">
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    // Indeterminate when some (but not all) are ticked.
                    if (el) el.indeterminate = !allChecked && values.length > 0;
                  }}
                  onChange={toggleAll}
                  disabled={disabled}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                {allChecked ? 'Clear all' : 'Select all'}
              </label>
              <span className="text-xs text-gray-400">{values.length} selected</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
            {checkboxItems.map((o) => (
              <label
                key={o.value}
                className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer rounded px-1 py-0.5 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={isChecked(o.value)}
                  onChange={() => toggle(o.value)}
                  disabled={disabled}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
            </div>
          </>
        )}
      </div>

      {/* Add-new flow. */}
      {creating ? (
        <div className="flex flex-col gap-1 mt-1">
          <label className="text-sm font-medium text-gray-700">{newFieldLabel}</label>
          <div className="flex flex-col gap-2 min-w-0">
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setLocalError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmCreate(); } }}
              placeholder={newFieldPlaceholder}
              className={[
                'w-full min-w-0 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500',
                localError ? 'border-red-400 bg-red-50' : 'border-gray-300',
              ].join(' ')}
            />
            <div className="flex items-center gap-2">
              <Button type="button" variant="primary" size="sm" className="shrink-0 px-2" icon={<Check className="w-4 h-4" />} onClick={confirmCreate} aria-label="Confirm">Add</Button>
              <Button type="button" variant="outline" size="sm" className="shrink-0 px-2" icon={<X className="w-4 h-4" />} onClick={cancelCreate} aria-label="Cancel">Cancel</Button>
            </div>
          </div>
          <SimilarEntryHint
            value={draft}
            options={detectOptions.map((o) => o.label)}
            noun={(newFieldLabel || 'entry').replace(/^new\s+/i, '').toLowerCase()}
            onPick={pickExisting}
          />
          {localError && <p className="text-xs text-red-500">{localError}</p>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setCreating(true); setDraft(''); setLocalError(''); }}
          disabled={disabled}
          className="self-start mt-1 text-xs font-medium text-primary-600 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded disabled:opacity-50"
        >
          {createLabel}
        </button>
      )}

      {hint && !error && !creating && <p className="text-xs text-gray-400">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </fieldset>
  );
}
