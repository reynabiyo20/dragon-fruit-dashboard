import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { InventoryItem } from '../../types';
import { useInventoryStore } from '../../store/inventoryStore';
import { InputField, TextareaField, DisplayField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { Button } from '../../components/ui/Button';
import { DuplicateWarning } from '../../components/forms/DuplicateWarning';
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck';
import { formatNumber } from '../../utils/format';
import { useInventoryCategoryStore, useUnitStore } from '../../store/optionStores';
import { useProductCategoryStore } from '../../store/productCategoryStore';

const schema = z.object({
  subcategory: z.string().min(1, 'Variety / item is required'),
  category: z.string().min(1, 'Type is required'),
  unit: z.string().min(1, 'Unit is required'),
  beginningQty: z.coerce.number().min(0),
  purchased: z.coerce.number().min(0),
  used: z.coerce.number().min(0),
  sold: z.coerce.number().min(0),
  unitCost: z.coerce.number().min(0),
  notes: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface InventoryFormProps { item: InventoryItem | null; onClose: () => void; }

export function InventoryForm({ item, onClose }: InventoryFormProps) {
  const { items, addItem, updateItem } = useInventoryStore();
  const categoryValues = useInventoryCategoryStore((s) => s.values);
  const addCategory = useInventoryCategoryStore((s) => s.add);
  const unitValues = useUnitStore((s) => s.values);
  const addUnit = useUnitStore((s) => s.add);
  const unitOptions = unitValues.map((v) => ({ value: v, label: v }));
  const isEditing = !!item;

  // Category dropdown = the inventory categories unioned with product types, so
  // Cuttings/Fruit/Fertilizer line up with products while inventory-only
  // categories (Packing Material, Tools…) remain available.
  const categoryEntries = useProductCategoryStore((s) => s.entries);
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>(categoryValues);
    categoryEntries.forEach((e) => seen.add(e.category));
    return Array.from(seen).sort().map((v) => ({ value: v, label: v }));
  }, [categoryValues, categoryEntries]);

  const { register, handleSubmit, control, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      subcategory: item?.subcategory ?? '',
      category: item?.category ?? '',
      unit: item?.unit ?? 'piece',
      beginningQty: item?.beginningQty ?? 0,
      purchased: item?.purchased ?? 0,
      used: item?.used ?? 0,
      sold: item?.sold ?? 0,
      unitCost: item?.unitCost ?? 0,
      notes: item?.notes ?? '',
    },
  });

  const beginningQty = Number(useWatch({ control, name: 'beginningQty' })) || 0;
  const purchased = Number(useWatch({ control, name: 'purchased' })) || 0;
  const used = Number(useWatch({ control, name: 'used' })) || 0;
  const sold = Number(useWatch({ control, name: 'sold' })) || 0;
  const endingQty = beginningQty + purchased - used - sold;

  // Variety options for the selected category, sourced from the product
  // taxonomy. Inventory-only categories simply have none, so Item stays free text.
  const selectedCategory = watch('category');
  const itemOptions = useMemo(() => {
    if (!selectedCategory) return [];
    const subs = categoryEntries
      .filter((e) => e.category === selectedCategory && e.subcategory !== '')
      .map((e) => e.subcategory);
    return [...new Set(subs)].sort().map((v) => ({ value: v, label: v }));
  }, [categoryEntries, selectedCategory]);

  // Duplicate detection on item + category identity
  const [itemName, category] = useWatch({ control, name: ['subcategory', 'category'] });
  const combined = `${itemName ?? ''} ${category ?? ''}`.trim();
  const candidates = item ? items.filter((i) => i.id !== item.id) : items;
  const duplicates = useDuplicateCheck(
    candidates,
    [{ label: 'subcategory', value: combined, of: (i) => `${i.subcategory} ${i.category}`.trim() }],
    !isEditing,
    3
  );

  const onSubmit = (data: FormValues) => {
    if (item) { updateItem(item.id, data); toast.success('Item updated'); }
    else { addItem(data); toast.success('Item added'); }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {!isEditing && (
        <DuplicateWarning
          matches={duplicates}
          atLimit={duplicates.length >= 5}
          labelOf={(i) => `${i.subcategory} · ${i.category}`}
          keyOf={(i) => i.id}
          noun="item"
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <CreatableSelect
          label="Type"
          required
          value={watch('category')}
          options={categoryOptions}
          onChange={(v) => {
            setValue('category', v, { shouldValidate: true, shouldDirty: true });
            // Reset the variety/item when the type changes so a Cuttings
            // variety doesn't linger after switching to, say, Packing Material.
            setValue('subcategory', '', { shouldDirty: true });
          }}
          onCreate={addCategory}
          placeholder="Select…"
          error={errors.category?.message}
          createLabel="+ Create new type…"
          newFieldLabel="New Type"
          newFieldPlaceholder="e.g. Irrigation"
        />
        <CreatableSelect
          label="Variety / Item"
          required
          value={watch('subcategory')}
          options={itemOptions}
          onChange={(v) => setValue('subcategory', v, { shouldValidate: true, shouldDirty: true })}
          onCreate={(v) => setValue('subcategory', v, { shouldValidate: true, shouldDirty: true })}
          disabled={!selectedCategory}
          placeholder={
            selectedCategory
              ? itemOptions.length > 0
                ? 'Select variety…'
                : 'Type item name…'
              : 'Pick a type first'
          }
          error={errors.subcategory?.message}
          createLabel="+ Enter variety / item…"
          newFieldLabel="Variety / Item"
          newFieldPlaceholder="e.g. Scotch Tape"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <CreatableSelect
          label="Unit"
          required
          value={watch('unit')}
          options={unitOptions}
          onChange={(v) => setValue('unit', v, { shouldValidate: true, shouldDirty: true })}
          onCreate={addUnit}
          error={errors.unit?.message}
          createLabel="+ Create new unit…"
          newFieldLabel="New Unit"
          newFieldPlaceholder="e.g. crate"
        />
        <InputField label="Unit Cost (₱)" type="number" step="0.01" error={errors.unitCost?.message} {...register('unitCost')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Beginning Qty" type="number" step="0.01" error={errors.beginningQty?.message} {...register('beginningQty')} />
        <InputField label="Purchased" type="number" step="0.01" error={errors.purchased?.message} {...register('purchased')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Used" type="number" step="0.01" error={errors.used?.message} {...register('used')} />
        <InputField label="Sold" type="number" step="0.01" error={errors.sold?.message} {...register('sold')} />
      </div>

      {/* Auto-calculated ending qty */}
      <div className="p-3 bg-green-50 rounded-lg border border-green-100">
        <DisplayField
          label="Ending Qty (auto = Beginning + Purchased − Used − Sold)"
          value={formatNumber(endingQty, 2)}
          highlight
        />
      </div>

      <TextareaField label="Notes" {...register('notes')} rows={2} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{item ? 'Save Changes' : 'Add Item'}</Button>
      </div>
    </form>
  );
}
