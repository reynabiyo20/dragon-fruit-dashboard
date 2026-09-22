import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { VendorSupply } from '../../types';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { CreatableSelect } from './CreatableSelect';
import { SimilarEntryHint } from './SimilarEntryHint';
import { Button } from '../ui/Button';
import { toOptions } from '../../constants';

interface VendorSuppliesFieldProps {
  /** The vendor's structured supplies (category + subcategory pairs). */
  value: VendorSupply[];
  onChange: (next: VendorSupply[]) => void;
  /** Optional label + helper text overrides. */
  label?: string;
  hint?: string;
}

/**
 * Reusable multi-select for a vendor's supplies: pick a category, check any
 * number of its subcategories (or add new ones inline), and add them as chips.
 * New categories/subcategories cascade into the shared expense-category taxonomy
 * (and product taxonomy via syncTaxonomy) as they're created — so they persist
 * everywhere, not just on this vendor.
 *
 * Shared by the Vendor form and the Expense form's "new vendor" flow so both
 * capture a vendor's full supply list up front.
 */
export function VendorSuppliesField({
  value,
  onChange,
  label = 'Supplies Provided',
  hint = 'What this vendor sells you. Used to suggest vendors when recording expenses.',
}: VendorSuppliesFieldProps) {
  const categoryEntries = useExpenseCategoryStore((s) => s.entries);
  const addEntry = useExpenseCategoryStore((s) => s.addEntry);

  const [supCategory, setSupCategory] = useState('');
  const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>([]);
  const [subcategorySearch, setSubcategorySearch] = useState('');

  const categoryOptions = toOptions([...new Set(categoryEntries.map((e) => e.category))].sort());
  const subcategoryOptions = toOptions(
    [...new Set(
      categoryEntries
        .filter((e) => e.category === supCategory && e.subcategory !== '')
        .map((e) => e.subcategory),
    )].sort(),
  );

  // Filter the subcategory checkboxes by the search query. Any already-selected
  // subcategory stays visible so the user never loses track of a checked item.
  const query = subcategorySearch.trim().toLowerCase();
  const visibleSubcategoryOptions = query
    ? subcategoryOptions.filter(
        (o) => o.label.toLowerCase().includes(query) || selectedSubcategories.includes(o.value),
      )
    : subcategoryOptions;

  const toggleSubcategory = (sub: string) => {
    setSelectedSubcategories((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub],
    );
  };

  const addSupplyRow = () => {
    if (!supCategory) return;
    // One supply row per checked subcategory; the bare category alone if none checked.
    const subs = selectedSubcategories.length > 0 ? selectedSubcategories : [''];
    const toAdd = subs.filter(
      (sub) => !value.some((s) => s.category === supCategory && s.subcategory === sub),
    );
    if (toAdd.length === 0) { toast.error('Those supplies are already listed'); return; }
    onChange([...value, ...toAdd.map((sub) => ({ category: supCategory, subcategory: sub }))]);
    setSelectedSubcategories([]);
  };

  const removeSupplyRow = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <p className="text-xs text-gray-400">{hint}</p>

      {/* Existing supply chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((s, idx) => (
            <span
              key={`${s.category}-${s.subcategory}-${idx}`}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-primary-50 border border-primary-200 rounded-full text-xs font-medium text-primary-800"
            >
              {s.category}{s.subcategory ? ` – ${s.subcategory}` : ''}
              <button
                type="button"
                onClick={() => removeSupplyRow(idx)}
                className="p-0.5 rounded-full hover:bg-primary-200 text-primary-600"
                aria-label="Remove supply"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add a supply */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <CreatableSelect
              label="Category"
              options={categoryOptions}
              placeholder="Select category…"
              value={supCategory}
              onChange={(v) => { setSupCategory(v); setSelectedSubcategories([]); setSubcategorySearch(''); }}
              onCreate={(v) => { addEntry(v, ''); syncTaxonomy(v, ''); setSupCategory(v); setSelectedSubcategories([]); setSubcategorySearch(''); }}
              createLabel="+ Create new category…"
              newFieldLabel="New Category"
              newFieldPlaceholder="e.g. Irrigation"
            />
            <SimilarEntryHint
              value={supCategory}
              options={categoryOptions.map((o) => o.value)}
              noun="category"
              onPick={(v) => { setSupCategory(v); setSelectedSubcategories([]); setSubcategorySearch(''); }}
            />
          </div>
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-gray-700">Subcategories</span>
            {!supCategory ? (
              <p className="text-xs text-gray-400">Select a category first.</p>
            ) : subcategoryOptions.length > 0 ? (
              <>
                {subcategoryOptions.length > 5 && (
                  <input
                    type="search"
                    value={subcategorySearch}
                    onChange={(e) => setSubcategorySearch(e.target.value)}
                    placeholder="Search subcategories…"
                    aria-label={`Search subcategories for ${supCategory}`}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                )}
                {visibleSubcategoryOptions.length > 0 ? (
                  <fieldset className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
                    <legend className="sr-only">Select subcategories for {supCategory}</legend>
                    {visibleSubcategoryOptions.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          checked={selectedSubcategories.includes(opt.value)}
                          onChange={() => toggleSubcategory(opt.value)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <p className="text-xs text-gray-400">No subcategories match "{subcategorySearch.trim()}".</p>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400">No subcategories yet for this category.</p>
            )}
            <CreatableSelect
              label="Add new subcategory"
              options={[]}
              placeholder="None"
              value=""
              onChange={() => {}}
              onCreate={(v) => {
                if (!supCategory || !v) return;
                addEntry(supCategory, v);
                syncTaxonomy(supCategory, v);
                setSelectedSubcategories((prev) => (prev.includes(v) ? prev : [...prev, v]));
              }}
              disabled={!supCategory}
              createLabel="+ Create new subcategory…"
              newFieldLabel="New Subcategory"
              newFieldPlaceholder="e.g. Drip Line"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          onClick={addSupplyRow}
          disabled={!supCategory}
        >
          Add supply
        </Button>
      </div>
    </div>
  );
}
