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
  onChange,
  onCreate,
  required,
  placeholder,
  error,
  disabled,
  createLabel = '+ Create new…',
  newFieldLabel = 'New value',
  newFieldPlaceholder = 'Type a new value…',
}: CreatableSelectProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState('');

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
    // If the value already exists (case-insensitive), don't create a duplicate —
    // just select the existing one.
    const existing = options.find((o) => o.value.trim().toLowerCase() === v.toLowerCase());
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
        <div className="flex items-center gap-2 min-w-0">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setLocalError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmCreate(); } }}
            placeholder={newFieldPlaceholder}
            className={[
              // min-w-0 lets the input shrink inside narrow grid cells so the
              // confirm/cancel buttons don't overflow and overlap neighbours.
              'flex-1 min-w-0 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500',
              localError ? 'border-red-400 bg-red-50' : 'border-gray-300',
            ].join(' ')}
          />
          <Button type="button" variant="primary" size="sm" className="shrink-0 px-2" icon={<Check className="w-4 h-4" />} onClick={confirmCreate} aria-label="Confirm" />
          <Button type="button" variant="outline" size="sm" className="shrink-0 px-2" icon={<X className="w-4 h-4" />} onClick={cancelCreate} aria-label="Cancel" />
        </div>
        {/* Similar-entry suggestions + exact-duplicate notice for the typed value. */}
        <SimilarEntryHint
          value={draft}
          options={options.map((o) => o.label)}
          noun={(newFieldLabel || 'entry').replace(/^new\s+/i, '').toLowerCase()}
          onPick={pickExisting}
        />
        {localError && <p className="text-xs text-red-500">{localError}</p>}
      </div>
    );
  }

  // Defensively ensure the current value is always a selectable option, even if
  // the options list hasn't yet caught up with a just-created value. Without this,
  // a controlled <select> whose value has no matching <option> silently resets to "".
  const hasValue = value && options.some((o) => o.value === value);
  const mergedOptions = [
    ...options,
    ...(value && !hasValue ? [{ value, label: value }] : []),
    { value: CREATE_NEW, label: createLabel },
  ];

  return (
    <SelectField
      label={label}
      required={required}
      placeholder={placeholder}
      error={error}
      disabled={disabled}
      value={value}
      onChange={handleSelectChange}
      options={mergedOptions}
    />
  );
}
