import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Option } from '../../constants';
import { CREATE_NEW } from '../../constants';
import { SelectField } from './FormField';
import { SimilarEntryHint } from './SimilarEntryHint';
import { Button } from '../ui/Button';

interface CreatableSelectProps {
  label: string;
  value: string;
  options: Option[];
  /**
   * A SUPERSET of `options` used only for the "already exists / similar entry"
   * detection while creating (and to avoid creating a duplicate). Useful when the
   * visible dropdown is filtered/scoped (e.g. categories limited to a vendor's
   * supplies) but you still want to warn against — and reuse — a value that
   * exists elsewhere in the full taxonomy. Defaults to `options`.
   */
  matchOptions?: Option[];
  onChange: (value: string) => void;
  /** Called when the user confirms a brand-new value; should persist it, then the value is selected */
  onCreate: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  createLabel?: string;      // e.g. "+ Create new unit…"
  newFieldLabel?: string;    // e.g. "New Unit"
  newFieldPlaceholder?: string;
  /** Optional helper text shown under the select (hidden while creating / on error). */
  hint?: string;
}

/**
 * A SelectField with a built-in "create new…" flow. When the user picks the
 * create option, an inline text field appears; confirming persists the value
 * (via onCreate) and selects it. Keeps the create-new UX consistent everywhere.
 */
export function CreatableSelect({
  label,
  value,
  options,
  matchOptions,
  onChange,
  onCreate,
  required,
  placeholder,
  error,
  disabled,
  createLabel = '+ Create new…',
  newFieldLabel = 'New value',
  newFieldPlaceholder = 'Type a new value…',
  hint,
}: CreatableSelectProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState('');
  // Detection/dedup list — the full set when a superset is provided, else the
  // visible options.
  const detectOptions = matchOptions ?? options;

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === CREATE_NEW) {
      setCreating(true);
      setDraft('');
      setLocalError('');
    } else {
      onChange(e.target.value);
    }
  };

  /** Select an existing option (used by the similar/exact hint) and exit create mode. */
  const pickExisting = (value: string) => {
    onChange(value);
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
    // If the value already exists (case-insensitive) anywhere in the detection
    // set, don't create a duplicate — just select the existing one.
    const existing = detectOptions.find((o) => o.value.trim().toLowerCase() === v.toLowerCase());
    if (existing) {
      pickExisting(existing.value);
      return;
    }
    onCreate(v);
    onChange(v);
    setCreating(false);
    setDraft('');
  };

  const cancelCreate = () => {
    setCreating(false);
    setDraft('');
    setLocalError('');
  };

  if (creating) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">
          {newFieldLabel}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {/* Input takes a full-width row; the confirm/cancel buttons sit on their
            own row so they never overflow into a neighbouring grid cell (which
            caused the Unit control to overlap the Price field in the itemized
            expense picker's narrow two-column layout). */}
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
        {/* Similar-entry suggestions + exact-duplicate notice for the typed value.
            Checked against the full detection set so a value that exists outside
            the (possibly scoped) visible options is still flagged/reusable. */}
        <SimilarEntryHint
          value={draft}
          options={detectOptions.map((o) => o.label)}
          noun={(newFieldLabel || 'entry').replace(/^new\s+/i, '').toLowerCase()}
          onPick={pickExisting}
        />
        {/* Show the caller's helper text while creating too, so guidance like
            "saved as the default unit for X" stays visible during entry. */}
        {hint && !localError && <p className="text-xs text-gray-400">{hint}</p>}
        {localError && <p className="text-xs text-red-500">{localError}</p>}
      </div>
    );
  }

  // Match the current value to an option case-insensitively so casing drift
  // between a stored record (e.g. seed "Kg") and the managed option list (e.g.
  // renamed to "kg" in Settings) doesn't render a duplicate <option>. When a
  // case-insensitive match exists we reuse the option's canonical casing as the
  // <select> value; otherwise we inject the raw value so a genuinely new /
  // not-yet-persisted value stays selectable (a controlled <select> whose value
  // has no matching <option> would silently reset to "").
  const matched = value
    ? options.find((o) => o.value.trim().toLowerCase() === value.trim().toLowerCase())
    : undefined;
  const selectedValue = matched ? matched.value : value;
  const mergedOptions = [
    ...options,
    ...(value && !matched ? [{ value, label: value }] : []),
    { value: CREATE_NEW, label: createLabel },
  ];

  return (
    <SelectField
      label={label}
      required={required}
      placeholder={placeholder}
      error={error}
      hint={hint}
      disabled={disabled}
      value={selectedValue}
      onChange={handleSelectChange}
      options={mergedOptions}
    />
  );
}
