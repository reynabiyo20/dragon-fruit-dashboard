import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { CreatableSelect } from '../forms/CreatableSelect';
import type { Option } from '../../constants';

/**
 * Describes one bulk-editable field. The value type the input produces:
 *  - 'number' → number
 *  - everything else → string
 */
export interface BulkFieldConfig {
  /** Field label shown in the modal + action menu. */
  label: string;
  /** Input kind. */
  type: 'text' | 'number' | 'date' | 'select' | 'creatable';
  /** Options for select / creatable inputs. */
  options?: Option[];
  /** For 'creatable': persist a newly-typed value (e.g. option-store add). */
  onCreate?: (value: string) => void;
  /** number input constraints. */
  min?: number;
  step?: string;
  /** Optional helper text under the field. */
  hint?: string;
  placeholder?: string;
}

interface BulkFieldEditProps {
  open: boolean;
  onClose: () => void;
  /** Field being edited (null closes the modal). */
  field: BulkFieldConfig | null;
  /** How many rows the value will apply to. */
  count: number;
  /** Commit the entered value to all selected rows. Value is string|number. */
  onApply: (value: string | number) => void;
}

/**
 * A generic "apply one value to N selected rows" modal. Renders the input that
 * matches the field descriptor (text / number / date / native select /
 * creatable-select) so a single component powers every bulk-edit action.
 */
export function BulkFieldEdit({ open, onClose, field, count, onApply }: BulkFieldEditProps) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');
  // Reset the input during render when the opened field changes (React's
  // "adjust state during render" pattern — no effect / cascading render).
  const [lastFieldKey, setLastFieldKey] = useState<string | null>(null);
  const fieldKey = open && field ? field.label : null;
  if (fieldKey !== lastFieldKey) {
    setLastFieldKey(fieldKey);
    setRaw('');
    setError('');
  }

  if (!field) return null;

  const apply = () => {
    const trimmed = raw.trim();
    if (field.type === 'number') {
      const num = Number(trimmed);
      if (trimmed === '' || !Number.isFinite(num)) { setError('Enter a valid number.'); return; }
      if (field.min !== undefined && num < field.min) { setError(`Must be at least ${field.min}.`); return; }
      onApply(num);
      return;
    }
    if (trimmed === '') { setError(`Enter a ${field.label.toLowerCase()}.`); return; }
    onApply(trimmed);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Set ${field.label}`} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Apply one {field.label.toLowerCase()} to{' '}
          <span className="font-medium text-gray-900">{count}</span> selected
          {' '}record{count !== 1 ? 's' : ''}. You can undo this right after.
        </p>

        {field.type === 'creatable' ? (
          <CreatableSelect
            label={field.label}
            value={raw}
            options={field.options ?? []}
            onChange={(v) => { setRaw(v); setError(''); }}
            onCreate={(v) => { field.onCreate?.(v); setRaw(v); setError(''); }}
            placeholder={field.placeholder ?? `Select or create ${field.label.toLowerCase()}…`}
            error={error}
            createLabel={`+ Create new ${field.label.toLowerCase()}…`}
            newFieldLabel={`New ${field.label}`}
          />
        ) : field.type === 'select' ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
            <select
              autoFocus
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setError(''); }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select…</option>
              {(field.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
            <input
              type={field.type}
              autoFocus
              min={field.type === 'number' ? field.min : undefined}
              step={field.type === 'number' ? (field.step ?? '1') : undefined}
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
              placeholder={field.placeholder}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
        )}

        {field.hint && <p className="text-xs text-gray-400">{field.hint}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button icon={<ListChecks className="w-4 h-4" />} onClick={apply}>Apply to {count}</Button>
        </div>
      </div>
    </Modal>
  );
}
