import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { addDays, addWeeks, parseISO } from 'date-fns';
import type { CuttingBatch } from '../../types';
import { useCuttingStore } from '../../store/cuttingStore';
import { InputField, SelectField, TextareaField, DisplayField } from '../../components/forms/FormField';
import { Button } from '../../components/ui/Button';
import { formatPHP, formatDate } from '../../utils/format';
import { todayISO } from '../../utils/date';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import {
  CUTTINGS_PRODUCT_TYPE,
  CUTTING_ROOT_WEEKS_MIN,
  CUTTING_ROOT_WEEKS_DEFAULT,
  CUTTING_ROOT_WEEKS_MAX,
  CUTTING_SOURCE_INTERNAL,
  CUTTING_TYPE_OPTIONS,
  CUTTING_TYPE_GRAFTED,
  CUTTING_CALLUSING_DAYS,
  cuttingReadyWeeks,
} from '../../constants';
import { ENTITY, toastSuccess, VALIDATION, requiredMsg, FIELD } from '../../constants/messages';

const schema = z.object({
  subcategory: z.string().min(1, VALIDATION.varietyRequired),
  cuttingType: z.string().min(1, requiredMsg('Cutting type')),
  // For internal batches this holds the HARVEST date (planting is derived);
  // for customer records it's the acquisition/purchase date entered directly.
  dateSourced: z.string().min(1, VALIDATION.dateRequired),
  dateGrafted: z.string(),
  quantitySourced: z.coerce.number().int().min(1, 'Must source at least 1 cutting'),
  sourceCostPerCutting: z.coerce.number().min(0),
  graftCostPerCutting: z.coerce.number().min(0),
  rootWeeks: z.coerce
    .number()
    .min(CUTTING_ROOT_WEEKS_MIN, `Rooting takes at least ${CUTTING_ROOT_WEEKS_MIN} weeks`)
    .max(CUTTING_ROOT_WEEKS_MAX, `Rooting takes at most ${CUTTING_ROOT_WEEKS_MAX} weeks`),
  notes: z.string(),
});

type FormValues = z.infer<typeof schema>;

const rootWeeksOptions = Array.from(
  { length: CUTTING_ROOT_WEEKS_MAX - CUTTING_ROOT_WEEKS_MIN + 1 },
  (_, i) => {
    const w = CUTTING_ROOT_WEEKS_MIN + i;
    return { value: String(w), label: `${w} weeks` };
  },
);

interface CuttingFormProps {
  batch: CuttingBatch | null;
  onClose: () => void;
}

export function CuttingForm({ batch, onClose }: CuttingFormProps) {
  const { addBatch, updateBatch } = useCuttingStore();
  // Cutting varieties come from the managed taxonomy so Settings changes flow here.
  // Select the raw entries (stable ref) and derive the list — calling a store
  // method in the selector returns a new array each render → infinite loop.
  const categoryEntries = useProductCategoryStore((s) => s.entries);
  const varietyOptions = useMemo(() => {
    const subs = categoryEntries
      .filter((e) => e.category === CUTTINGS_PRODUCT_TYPE && e.subcategory !== '')
      .map((e) => e.subcategory);
    return [...new Set(subs)].sort().map((v) => ({ value: v, label: v }));
  }, [categoryEntries]);

  // New records are always internal batches; when editing, keep the record's
  // existing source. Internal batches use a Harvest Date (planting is derived).
  const isInternal = (batch?.source ?? CUTTING_SOURCE_INTERNAL) === CUTTING_SOURCE_INTERNAL;

  // The primary date input:
  //  - Internal: the harvest date (stored on the batch; planting = harvest + hold).
  //  - Customer: the acquisition/purchase date (stored directly as dateSourced).
  const initialPrimaryDate = isInternal
    ? (batch?.harvestDate ?? batch?.dateSourced ?? todayISO())
    : (batch?.dateSourced ?? todayISO());

  const { register, handleSubmit, control, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      subcategory: batch?.subcategory ?? '',
      cuttingType: batch?.cuttingType ?? CUTTING_TYPE_GRAFTED,
      dateSourced: initialPrimaryDate,
      dateGrafted: batch?.dateGrafted ?? '',
      quantitySourced: batch?.quantitySourced ?? 0,
      sourceCostPerCutting: batch?.sourceCostPerCutting ?? 0,
      graftCostPerCutting: batch?.graftCostPerCutting ?? 0,
      rootWeeks: batch?.rootWeeks ?? CUTTING_ROOT_WEEKS_DEFAULT,
      notes: batch?.notes ?? '',
    },
  });

  // ── Live cost + readiness preview ──
  const qty = Number(useWatch({ control, name: 'quantitySourced' })) || 0;
  const sourceCost = Number(useWatch({ control, name: 'sourceCostPerCutting' })) || 0;
  const graftCost = Number(useWatch({ control, name: 'graftCostPerCutting' })) || 0;
  const dateSourced = useWatch({ control, name: 'dateSourced' });
  const dateGrafted = useWatch({ control, name: 'dateGrafted' });
  const rootWeeks = Number(useWatch({ control, name: 'rootWeeks' })) || 0;
  const variety = useWatch({ control, name: 'subcategory' });
  const cuttingType = useWatch({ control, name: 'cuttingType' });

  const totalCost = qty * (sourceCost + graftCost);
  const readyDate =
    dateGrafted && rootWeeks > 0
      ? addWeeks(parseISO(dateGrafted), rootWeeks).toISOString()
      : '';

  // Derived planting/acquisition date. Internal batches callus/heal for a fixed
  // hold after harvest, so planting = harvest + CUTTING_CALLUSING_DAYS. Customer
  // records skip the delay and plant on the acquisition date itself.
  const plantingDate = (() => {
    if (!dateSourced) return '';
    try {
      return isInternal
        ? addDays(parseISO(dateSourced), CUTTING_CALLUSING_DAYS).toISOString()
        : parseISO(dateSourced).toISOString();
    } catch {
      return '';
    }
  })();

  // Estimated ready date = planting/acquisition date + variety/type growth cycle.
  const estimatedReadyDate = (() => {
    if (!plantingDate) return '';
    try {
      return addWeeks(parseISO(plantingDate), cuttingReadyWeeks(variety ?? '', cuttingType ?? '')).toISOString();
    } catch {
      return '';
    }
  })();

  /**
   * Create a brand-new cutting variety from the Variety picker: add it to the
   * managed taxonomy and notify the user. Only announces genuinely new varieties
   * (case-insensitive) so re-selecting an existing one stays quiet.
   */
  const handleCreateVariety = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const alreadyExists = varietyOptions.some(
      (o) => o.value.trim().toLowerCase() === name.toLowerCase(),
    );
    // Write through to BOTH the product and expense taxonomies so the new
    // variety shows up everywhere (Products, Sales, Expenses) and in Settings.
    syncTaxonomy(CUTTINGS_PRODUCT_TYPE, name);
    if (!alreadyExists) {
      toast.success(`Added new cutting variety "${name}"`, { icon: '🌱', duration: 4000 });
    }
  };

  const onSubmit = (data: FormValues) => {
    if (batch) {
      // Editing: map the primary date input back to the right field for the
      // record's source. Internal → harvestDate (store derives planting); the
      // store recompute ignores an incoming dateSourced for internal batches.
      const patch = isInternal
        ? { ...data, harvestDate: data.dateSourced }
        : data;
      updateBatch(batch.id, patch);
      toast.success(toastSuccess(ENTITY.batch, 'updated'));
    } else {
      // Manually created batches are our own nursery propagation. The primary
      // date input is the harvest date; the store derives the planting date.
      addBatch({ ...data, source: CUTTING_SOURCE_INTERNAL, harvestDate: data.dateSourced });
      toast.success(toastSuccess(ENTITY.batch, 'created'));
    }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <CreatableSelect
          label={FIELD.variety.label}
          required
          value={watch('subcategory')}
          options={varietyOptions}
          onChange={(v) => setValue('subcategory', v, { shouldValidate: true, shouldDirty: true })}
          onCreate={handleCreateVariety}
          placeholder={FIELD.variety.placeholder}
          error={errors.subcategory?.message}
          createLabel="+ Create new variety…"
          newFieldLabel="New Variety"
          newFieldPlaceholder="e.g. Thai White"
        />
        <InputField
          label={isInternal ? 'Harvest Date' : 'Acquisition / Purchase Date'}
          type="date"
          required
          hint={isInternal ? `Planting starts after a ${CUTTING_CALLUSING_DAYS}-day callusing hold` : undefined}
          error={errors.dateSourced?.message}
          {...register('dateSourced')}
        />
      </div>

      {/* Internal batches: show the derived planting/acquisition date and the
          mandatory callusing/nursery hold that precedes the growth countdown. */}
      {isInternal && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 bg-gold-50 rounded-lg border border-gold-100">
          <DisplayField
            label={`Nursery / Callusing Hold (${CUTTING_CALLUSING_DAYS} days)`}
            value={dateSourced ? `${formatDate(dateSourced)} → ${plantingDate ? formatDate(plantingDate) : '—'}` : 'Set harvest date'}
          />
          <DisplayField
            label="Planting / Acquisition Date (auto)"
            value={plantingDate ? formatDate(plantingDate) : 'Set harvest date'}
            highlight={!!plantingDate}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label="Cutting Type"
          required
          hint="Rooted stock is ready sooner than unrooted cuttings"
          options={CUTTING_TYPE_OPTIONS}
          error={errors.cuttingType?.message}
          {...register('cuttingType')}
        />
        <InputField
          label="Date Grafted / Planted"
          type="date"
          hint="Sets the rooting clock. For purchased cuttings already advanced, backdate this to reflect their real progress. Leave blank if not grafted yet."
          error={errors.dateGrafted?.message}
          {...register('dateGrafted')}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Quantity Sourced (cuttings)"
          type="number"
          required
          error={errors.quantitySourced?.message}
          {...register('quantitySourced')}
        />
        <SelectField
          label="Expected Rooting Time"
          hint="Cuttings typically root in 2–4 weeks"
          error={errors.rootWeeks?.message}
          options={rootWeeksOptions}
          {...register('rootWeeks')}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Source Cost / Cutting (₱)"
          type="number"
          step="0.01"
          hint="Optional — own-farm harvest is usually 0; set only if the cuttings were bought"
          error={errors.sourceCostPerCutting?.message}
          {...register('sourceCostPerCutting')}
        />
        <InputField
          label="Graft / Prep Cost / Cutting (₱)"
          type="number"
          step="0.01"
          hint="Optional — supplies, labor, etc."
          error={errors.graftCostPerCutting?.message}
          {...register('graftCostPerCutting')}
        />
      </div>



      {/* Auto-calculated preview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3 bg-primary-50 rounded-lg border border-primary-100">
        <DisplayField
          label="Total Batch Cost (qty × cost/cutting)"
          value={formatPHP(totalCost)}
          highlight
        />
        <DisplayField
          label="Est. Ready (from planting date)"
          value={estimatedReadyDate ? formatDate(estimatedReadyDate) : (isInternal ? 'Set harvest date' : 'Set acquisition date')}
          highlight={!!estimatedReadyDate}
        />
        <DisplayField
          label="Rooting Ready (graft date)"
          value={readyDate ? formatDate(readyDate) : 'Set graft date'}
          highlight={!!readyDate}
        />
      </div>

      <TextareaField label={FIELD.notes.label} rows={2} {...register('notes')} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{batch ? 'Save Changes' : 'Add Batch'}</Button>
      </div>
    </form>
  );
}
