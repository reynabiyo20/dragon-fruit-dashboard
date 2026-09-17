import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Vendor, VendorSupply } from '../../types';
import { useVendorStore } from '../../store/vendorStore';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { InputField, TextareaField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { DuplicateWarning } from '../../components/forms/DuplicateWarning';
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck';
import { toOptions } from '../../constants';

const schema = z.object({
  vendor: z.string().min(1, 'Vendor name is required'),
  contact: z.string(),
  phone: z.string(),
  notes: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface VendorFormProps { vendor: Vendor | null; onClose: () => void; }

export function VendorForm({ vendor, onClose }: VendorFormProps) {
  const { vendors, addVendor, updateVendor } = useVendorStore();
  // Subscribe to `entries` so category/subcategory dropdowns refresh when one is added
  const categoryEntries = useExpenseCategoryStore((s) => s.entries);
  const addEntry = useExpenseCategoryStore((s) => s.addEntry);
  const isEditing = !!vendor;

  // Structured supplies managed as local state
  const [supplies, setSupplies] = useState<VendorSupply[]>(vendor?.supplies ?? []);
  const [supCategory, setSupCategory] = useState('');
  const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>([]);

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      vendor: vendor?.vendor ?? '',
      contact: vendor?.contact ?? '',
      phone: vendor?.phone ?? '',
      notes: vendor?.notes ?? '',
    },
  });

  const [vendorName, phone, contact] = useWatch({
    control,
    name: ['vendor', 'phone', 'contact'],
  });

  const candidates = vendor ? vendors.filter((v) => v.id !== vendor.id) : vendors;
  const duplicates = useDuplicateCheck(
    candidates,
    [
      { label: 'Name', value: vendorName ?? '', of: (v) => v.vendor },
      { label: 'Phone', value: phone ?? '', of: (v) => v.phone },
      { label: 'Contact', value: contact ?? '', of: (v) => v.contact },
    ],
    !isEditing
  );

  const categoryOptions = toOptions(
    [...new Set(categoryEntries.map((e) => e.category))].sort()
  );
  const subcategoryOptions = toOptions(
    [...new Set(
      categoryEntries
        .filter((e) => e.category === supCategory && e.subcategory !== '')
        .map((e) => e.subcategory)
    )].sort()
  );

  const toggleSubcategory = (sub: string) => {
    setSelectedSubcategories((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub]
    );
  };

  const addSupplyRow = () => {
    if (!supCategory) return;
    // Add one supply row per checked subcategory; if none checked, add the category alone.
    const subs = selectedSubcategories.length > 0 ? selectedSubcategories : [''];
    const toAdd = subs.filter(
      (sub) => !supplies.some((s) => s.category === supCategory && s.subcategory === sub)
    );
    if (toAdd.length === 0) { toast.error('Those supplies are already listed'); return; }
    setSupplies((prev) => [...prev, ...toAdd.map((sub) => ({ category: supCategory, subcategory: sub }))]);
    setSelectedSubcategories([]);
  };

  const removeSupplyRow = (idx: number) => {
    setSupplies((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSubmit = (data: FormValues) => {
    const payload = { ...data, supplies };
    if (vendor) { updateVendor(vendor.id, payload); toast.success('Vendor updated'); }
    else { addVendor(payload); toast.success('Vendor added'); }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {!isEditing && (
        <DuplicateWarning
          matches={duplicates}
          atLimit={duplicates.length >= 5}
          labelOf={(v) => v.vendor}
          keyOf={(v) => v.id}
          noun="vendor"
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <InputField label="Vendor Name" required autoFocus error={errors.vendor?.message} {...register('vendor')} />
        <InputField label="Contact Person" {...register('contact')} />
      </div>
      <InputField label="Phone" type="tel" {...register('phone')} />

      {/* Structured supplies manager */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">Supplies Provided</label>
        <p className="text-xs text-gray-400">
          What this vendor sells you. Used to suggest vendors when recording expenses.
        </p>

        {/* Existing supply chips */}
        {supplies.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {supplies.map((s, idx) => (
              <span
                key={`${s.category}-${s.subcategory}-${idx}`}
                className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-green-50 border border-green-200 rounded-full text-xs font-medium text-green-800"
              >
                {s.category}{s.subcategory ? ` – ${s.subcategory}` : ''}
                <button
                  type="button"
                  onClick={() => removeSupplyRow(idx)}
                  className="p-0.5 rounded-full hover:bg-green-200 text-green-600"
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
                onChange={(v) => { setSupCategory(v); setSelectedSubcategories([]); }}
                onCreate={(v) => { addEntry(v, ''); syncTaxonomy(v, ''); }}
                createLabel="+ Create new category…"
                newFieldLabel="New Category"
                newFieldPlaceholder="e.g. Irrigation"
              />
              <SimilarEntryHint
                value={supCategory}
                options={categoryOptions.map((o) => o.value)}
                noun="category"
                onPick={(v) => { setSupCategory(v); setSelectedSubcategories([]); }}
              />
            </div>
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-gray-700">Subcategories</span>
              {!supCategory ? (
                <p className="text-xs text-gray-400">Select a category first.</p>
              ) : subcategoryOptions.length > 0 ? (
                <fieldset className="space-y-1">
                  <legend className="sr-only">Select subcategories for {supCategory}</legend>
                  {subcategoryOptions.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                        checked={selectedSubcategories.includes(opt.value)}
                        onChange={() => toggleSubcategory(opt.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </fieldset>
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
        {supplies.length === 0 && (
          <p className="text-xs text-gray-400">
            No supplies listed yet. <Badge label="tip" variant="gray" /> You can also let this fill in automatically as you log expenses.
          </p>
        )}
      </div>

      <TextareaField label="Notes" {...register('notes')} rows={2} />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{vendor ? 'Save Changes' : 'Add Vendor'}</Button>
      </div>
    </form>
  );
}
