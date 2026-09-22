import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { Product } from '../../types';
import { useProductStore } from '../../store/productStore';
import { InputField, TextareaField, DisplayField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { Button } from '../../components/ui/Button';
import { DuplicateWarning } from '../../components/forms/DuplicateWarning';
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck';
import { useUnitStore } from '../../store/optionStores';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import { formatPHP } from '../../utils/format';
import { ENTITY, toastSuccess, VALIDATION, FIELD } from '../../constants/messages';

const schema = z.object({
  category: z.string().min(1, VALIDATION.categoryRequired),
  subcategory: z.string(),
  costPHP: z.coerce.number().min(0),
  sellingPricePHP: z.coerce.number().min(0),
  costUSD: z.coerce.number().min(0),
  sellingPriceUSD: z.coerce.number().min(0),
  unit: z.string().min(1, VALIDATION.unitRequired),
  notes: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface ProductFormProps {
  product: Product | null;
  onClose: () => void;
}

export function ProductForm({ product, onClose }: ProductFormProps) {
  const { products, addProduct, updateProduct } = useProductStore();
  const unitValues = useUnitStore((s) => s.values);
  const addUnit = useUnitStore((s) => s.add);
  const unitOptions = unitValues.map((v) => ({ value: v, label: v }));
  // Default a new product's unit to the first managed unit (falls back to '')
  // rather than a hardcoded 'Kg', so it always mirrors the Settings list.
  const defaultUnit = unitValues[0] ?? '';

  // Subscribe to the raw entries (stable reference) and derive lists locally.
  // Calling a store method inside the selector would return a new array each
  // render and cause an infinite update loop.
  const categoryEntries = useProductCategoryStore((s) => s.entries);
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    categoryEntries.forEach((e) => seen.add(e.category));
    return Array.from(seen).sort().map((v) => ({ value: v, label: v }));
  }, [categoryEntries]);
  const isEditing = !!product;

  const { register, handleSubmit, control, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      category: product?.category ?? '',
      subcategory: product?.subcategory ?? '',
      costPHP: product?.costPHP ?? 0,
      sellingPricePHP: product?.sellingPricePHP ?? 0,
      costUSD: product?.costUSD ?? 0,
      sellingPriceUSD: product?.sellingPriceUSD ?? 0,
      unit: product?.unit ?? defaultUnit,
      notes: product?.notes ?? '',
    },
  });

  // Subcategory options depend on the selected product type.
  const selectedType = watch('category');
  const subcategoryOptions = useMemo(() => {
    if (!selectedType) return [];
    const subs = categoryEntries
      .filter((e) => e.category === selectedType && e.subcategory !== '')
      .map((e) => e.subcategory);
    return [...new Set(subs)].sort().map((v) => ({ value: v, label: v }));
  }, [categoryEntries, selectedType]);

  // Live margin preview (PHP)
  const costPHP = Number(useWatch({ control, name: 'costPHP' })) || 0;
  const sellPHP = Number(useWatch({ control, name: 'sellingPricePHP' })) || 0;
  const marginPHP = sellPHP - costPHP;
  const marginPct = sellPHP > 0 ? (marginPHP / sellPHP) * 100 : 0;

  // Duplicate detection on the full "type – variety" identity so we only flag
  // a true duplicate (same type AND same variety), not every shared type.
  const [pType, sub] = useWatch({ control, name: ['category', 'subcategory'] });
  const combined = `${pType ?? ''} ${sub ?? ''}`.trim();
  const candidates = product ? products.filter((p) => p.id !== product.id) : products;
  const duplicates = useDuplicateCheck(
    candidates,
    [
      { label: 'Product', value: combined, of: (p) => `${p.category} ${p.subcategory}`.trim() },
    ],
    !isEditing,
    3 // require a slightly longer value before flagging
  );

  const onSubmit = (data: FormValues) => {
    // Persist the taxonomy to BOTH managed taxonomies so the new category/
    // subcategory pair reappears in Products, Sales AND Expenses dropdowns.
    syncTaxonomy(data.category, data.subcategory);
    const payload = { ...data };
    if (product) {
      updateProduct(product.id, payload);
      toast.success(toastSuccess(ENTITY.product, 'updated'));
    } else {
      addProduct(payload);
      toast.success(toastSuccess(ENTITY.product, 'created'));
    }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {!isEditing && (
        <DuplicateWarning
          matches={duplicates}
          atLimit={duplicates.length >= 5}
          labelOf={(p) => `${p.category}${p.subcategory ? ` – ${p.subcategory}` : ''}`}
          keyOf={(p) => p.id}
          noun="product"
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <CreatableSelect
            label={FIELD.category.label}
            required
            value={watch('category')}
            options={categoryOptions}
            onChange={(v) => {
              setValue('category', v, { shouldValidate: true, shouldDirty: true });
              // Reset the variety when the type changes so stale values don't linger.
              setValue('subcategory', '', { shouldDirty: true });
            }}
            onCreate={(v) => syncTaxonomy(v, '')}
            placeholder={FIELD.category.placeholder}
            error={errors.category?.message}
            createLabel="+ Add new category…"
            newFieldLabel="New Category"
            newFieldPlaceholder="e.g. Drink"
          />
          <SimilarEntryHint
            value={pType ?? ''}
            options={categoryOptions.map((o) => o.value)}
            noun="category"
            onPick={(v) => setValue('category', v, { shouldValidate: true, shouldDirty: true })}
          />
        </div>
        <div>
          <CreatableSelect
            label={FIELD.subcategory.label}
            value={watch('subcategory')}
            options={subcategoryOptions}
            onChange={(v) => setValue('subcategory', v, { shouldValidate: true, shouldDirty: true })}
            onCreate={(v) => syncTaxonomy(selectedType, v)}
            disabled={!selectedType}
            placeholder={selectedType ? FIELD.subcategory.placeholder : 'Pick a category first'}
            error={errors.subcategory?.message}
            createLabel="+ Add new subcategory…"
            newFieldLabel="New Subcategory"
            newFieldPlaceholder="e.g. Thai White"
          />
          {selectedType && (
            <SimilarEntryHint
              value={sub ?? ''}
              options={subcategoryOptions.map((o) => o.value)}
              noun="variety"
              onPick={(v) => setValue('subcategory', v, { shouldValidate: true, shouldDirty: true })}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <InputField label="Cost (₱)" type="number" step="0.01" error={errors.costPHP?.message} {...register('costPHP')} />
        <InputField label="Selling Price (₱)" type="number" step="0.01" error={errors.sellingPricePHP?.message} {...register('sellingPricePHP')} />
      </div>

      {/* Live margin preview */}
      {sellPHP > 0 && (
        <div className="grid grid-cols-2 gap-4 p-3 bg-primary-50 rounded-lg border border-primary-100">
          <DisplayField label="Margin (auto = Sell − Cost)" value={formatPHP(marginPHP)} highlight />
          <DisplayField label="Margin % (auto)" value={`${marginPct.toFixed(1)}%`} highlight />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <InputField label="Cost ($)" type="number" step="0.01" error={errors.costUSD?.message} {...register('costUSD')} />
        <InputField label="Selling Price ($)" type="number" step="0.01" error={errors.sellingPriceUSD?.message} {...register('sellingPriceUSD')} />
      </div>

      <CreatableSelect
        label={FIELD.unit.label}
        required
        value={watch('unit')}
        options={unitOptions}
        onChange={(v) => setValue('unit', v, { shouldValidate: true, shouldDirty: true })}
        onCreate={addUnit}
        error={errors.unit?.message}
        createLabel="+ Add new unit…"
        newFieldLabel="New Unit"
        newFieldPlaceholder="e.g. crate"
      />

      <TextareaField label={FIELD.notes.label} {...register('notes')} rows={2} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{product ? 'Save Changes' : 'Add Product'}</Button>
      </div>
    </form>
  );
}
