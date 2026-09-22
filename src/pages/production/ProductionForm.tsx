import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { ProductionEntry } from '../../types';
import { useProductionStore } from '../../store/productionStore';
import { useFarmStore } from '../../store/farmStore';
import { useEmployeeStore } from '../../store/employeeStore';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { InputField, SelectField, TextareaField, DisplayField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { Button } from '../../components/ui/Button';
import { todayISO } from '../../utils/date';
import { formatNumber } from '../../utils/format';
import {
  CUTTINGS_PRODUCT_TYPE, FRUIT_PRODUCT_TYPE, CUTTING_TYPE_OPTIONS, CUTTING_TYPE_GRAFTED,
  CUTTING_ROOT_WEEKS_MIN, CUTTING_ROOT_WEEKS_MAX, CUTTING_ROOT_WEEKS_DEFAULT, CUTTING_CALLUSING_DAYS,
} from '../../constants';
import { ENTITY, toastSuccess, requiredMsg, FIELD } from '../../constants/messages';

const HARVEST_KIND_OPTIONS = [
  { value: 'Fruit', label: 'Fruit' },
  { value: 'Cuttings', label: 'Cuttings' },
];

const schema = z.object({
  date: z.string().min(1, requiredMsg('Harvest date')),
  sectionId: z.string(),
  subcategory: z.string(),
  harvestKind: z.enum(['Fruit', 'Cuttings']),
  harvestedById: z.string(),
  plants: z.coerce.number().min(0),
  fruitsHarvested: z.coerce.number().min(0),
  goodFruits: z.coerce.number().min(0),
  weightKg: z.coerce.number().min(0),
  // Cuttings-only propagation details for the internal batch this harvest creates.
  cuttingType: z.string(),
  rootWeeks: z.coerce.number().min(CUTTING_ROOT_WEEKS_MIN).max(CUTTING_ROOT_WEEKS_MAX),
  dateGrafted: z.string(),
  notes: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface ProductionFormProps { entry: ProductionEntry | null; onClose: () => void; }

export function ProductionForm({ entry, onClose }: ProductionFormProps) {
  const { addEntry, updateEntry } = useProductionStore();
  const { sections, getSection, varietiesForSection, plantsForSectionVariety } = useFarmStore();
  const { activeEmployees } = useEmployeeStore();
  const categoryEntries = useProductCategoryStore((s) => s.entries);

  const sectionOptions = sections
    .map((s) => ({ value: s.id, label: `${s.sectionType}${s.plantSubcategory ? ` – ${s.plantSubcategory}` : ''} (PIC: ${s.pic})` }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  // Full variety list from the shared product taxonomy — the fallback when a
  // section has no standing plantings recorded yet.
  const taxonomyVarietyOptions = [
    ...new Set(categoryEntries.filter((e) => e.subcategory !== '').map((e) => e.subcategory)),
  ].sort().map((v) => ({ value: v, label: v }));
  // Harvester options — active employees, so output can be attributed per worker.
  const harvesters = activeEmployees();
  const harvesterOptions = harvesters
    .map((e) => ({ value: e.id, label: e.position ? `${e.name} — ${e.position}` : e.name }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

  // Resolve a starting sectionId from a legacy free-text farmBlock (match by type).
  const initialSectionId =
    entry?.sectionId ??
    (entry?.farmBlock ? sections.find((s) => s.sectionType === entry.farmBlock)?.id ?? '' : '');

  const { register, handleSubmit, control, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      date: entry?.date ?? todayISO(),
      sectionId: initialSectionId,
      subcategory: entry?.subcategory ?? '',
      harvestKind: (entry?.harvestKind ?? 'Fruit'),
      harvestedById: entry?.harvestedById ?? '',
      plants: entry?.plants ?? 0,
      fruitsHarvested: entry?.fruitsHarvested ?? 0,
      goodFruits: entry?.goodFruits ?? 0,
      weightKg: entry?.weightKg ?? 0,
      cuttingType: entry?.cuttingType ?? CUTTING_TYPE_GRAFTED,
      rootWeeks: entry?.rootWeeks ?? CUTTING_ROOT_WEEKS_DEFAULT,
      dateGrafted: entry?.dateGrafted ?? '',
      notes: entry?.notes ?? '',
    },
  });

  const fruitsHarvested = Number(useWatch({ control, name: 'fruitsHarvested' })) || 0;
  const goodFruits = Number(useWatch({ control, name: 'goodFruits' })) || 0;
  const damaged = Math.max(0, fruitsHarvested - goodFruits);

  const subcategory = useWatch({ control, name: 'subcategory' });
  const harvestKind = useWatch({ control, name: 'harvestKind' });
  const sectionId = useWatch({ control, name: 'sectionId' });
  const weightKg = Number(useWatch({ control, name: 'weightKg' })) || 0;
  const isCuttings = harvestKind === 'Cuttings';

  // Farm Info is the source of truth: scope the Variety dropdown to what's
  // actually planted in the chosen section. When the section has no standing
  // plantings recorded yet (or none is selected), fall back to the full taxonomy
  // so logging is never blocked.
  const sectionVarieties = sectionId ? varietiesForSection(sectionId) : [];
  const varietyOptions = sectionVarieties.length > 0
    ? sectionVarieties.map((v) => ({ value: v, label: v }))
    : taxonomyVarietyOptions;
  const varietyFromSection = sectionVarieties.length > 0;

  /**
   * Pre-fill Number of Plants from the section's standing planting for the given
   * variety (still editable — a harvest may cover only part of a section). Only
   * fills when we have a positive living count; never zeroes out a manual entry.
   */
  const prefillPlants = (secId: string, variety: string) => {
    if (!secId || !variety.trim()) return;
    const count = plantsForSectionVariety(secId, variety);
    if (count > 0) setValue('plants', count, { shouldDirty: true });
  };

  // What this harvest will credit to inventory, previewed to the user.
  const creditPreview = (() => {
    const variety = (subcategory ?? '').trim();
    if (!variety) return null;
    if (isCuttings) {
      return goodFruits > 0
        ? `Creates an internal ${variety} batch of ${formatNumber(goodFruits, 0)} cuttings — track it in Cuttings to reserve/plant.`
        : null;
    }
    return weightKg > 0
      ? `Adds ${formatNumber(weightKg, 1)} kg to ${FRUIT_PRODUCT_TYPE} → ${variety} inventory.`
      : null;
  })();

  const onSubmit = (data: FormValues) => {
    // Snapshot the harvester's name so later employee edits don't rewrite history.
    const harvester = harvesters.find((e) => e.id === data.harvestedById);
    // Keep farmBlock (free-text section type) populated for back-compat/display.
    const section = data.sectionId ? getSection(data.sectionId) : undefined;
    // Keep the taxonomy in step so a newly-typed variety shows everywhere.
    if (data.subcategory.trim()) {
      syncTaxonomy(isCuttings ? CUTTINGS_PRODUCT_TYPE : FRUIT_PRODUCT_TYPE, data.subcategory.trim());
    }
    const payload = {
      ...data,
      farmBlock: section?.sectionType ?? entry?.farmBlock ?? '',
      harvestedByName: harvester?.name ?? '',
      // Farm-harvested cuttings are always raw off the plant → Needs Packing.
      // (Cuttings bought already-packed come through the Expense channel.)
      cuttingState: 'bare' as const,
    };
    if (entry) { updateEntry(entry.id, payload); toast.success(toastSuccess(ENTITY.productionEntry, 'updated')); }
    else { addEntry(payload); toast.success(toastSuccess(ENTITY.productionEntry, 'created')); }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Harvest Date" type="date" required error={errors.date?.message} {...register('date')} />
        {(() => {
          const reg = register('sectionId');
          return (
            <SelectField
              label="Section"
              options={sectionOptions}
              placeholder="Select section…"
              hint="Variety + plant count come from this section's Farm Info plantings."
              {...reg}
              onChange={(e) => {
                reg.onChange(e);
                const secId = e.target.value;
                // Scope variety to the new section: if the current variety isn't
                // planted there, clear it so the user picks from the section's list.
                const vs = secId ? varietiesForSection(secId) : [];
                if (vs.length > 0 && subcategory && !vs.some((v) => v.toLowerCase() === subcategory.toLowerCase())) {
                  setValue('subcategory', '', { shouldDirty: true });
                } else if (secId && subcategory) {
                  // Same variety still valid → refresh the plant count from this section.
                  prefillPlants(secId, subcategory);
                }
              }}
            />
          );
        })()}
      </div>

      {/* Harvest kind + variety drive the inventory credit. */}
      <div className="grid grid-cols-2 gap-4">
        <SelectField label="Harvest Kind" options={HARVEST_KIND_OPTIONS} {...register('harvestKind')} />
        <CreatableSelect
          label="Variety"
          options={varietyOptions}
          placeholder={varietyFromSection ? 'Select from this section…' : 'Select or add…'}
          value={subcategory}
          onChange={(v) => {
            setValue('subcategory', v, { shouldDirty: true });
            prefillPlants(sectionId, v);
          }}
          onCreate={(v) => {
            syncTaxonomy(isCuttings ? CUTTINGS_PRODUCT_TYPE : FRUIT_PRODUCT_TYPE, v);
            setValue('subcategory', v, { shouldDirty: true });
            prefillPlants(sectionId, v);
          }}
          createLabel="+ Add new variety…"
          newFieldLabel="New Variety"
          newFieldPlaceholder="e.g. Thai White"
        />
      </div>

      {isCuttings && (
        <div className="space-y-3 p-3 bg-berry-50 rounded-lg border border-berry-100">
          <p className="text-xs text-berry-800">
            Harvested cuttings become an internal <span className="font-medium">Cutting Batch</span> — they
            callus for {CUTTING_CALLUSING_DAYS} days, then root, then you reserve them for replant or delivery
            (managed on the Cuttings page). Bought cuttings still come in through Expenses.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SelectField label="Cutting Type" options={CUTTING_TYPE_OPTIONS} {...register('cuttingType')} />
            <InputField
              label="Rooting Weeks"
              type="number"
              step="1"
              hint={`${CUTTING_ROOT_WEEKS_MIN}–${CUTTING_ROOT_WEEKS_MAX} weeks`}
              error={errors.rootWeeks?.message}
              {...register('rootWeeks')}
            />
            <InputField
              label="Date Grafted"
              type="date"
              hint="Optional — leave blank if not yet grafted"
              error={errors.dateGrafted?.message}
              {...register('dateGrafted')}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <SelectField label="Harvested By" options={harvesterOptions} placeholder="Unassigned" {...register('harvestedById')} />
        <InputField
          label="Number of Plants"
          type="number"
          step="1"
          hint={varietyFromSection ? 'Pre-filled from Farm Info — edit if this harvest covers only part of the section.' : undefined}
          error={errors.plants?.message}
          {...register('plants')}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <InputField label={isCuttings ? 'Cuttings Harvested' : 'Fruits Harvested'} type="number" step="1" error={errors.fruitsHarvested?.message} {...register('fruitsHarvested')} />
        <InputField label={isCuttings ? 'Good Cuttings' : 'Good Fruits'} type="number" step="1" error={errors.goodFruits?.message} {...register('goodFruits')} hint={isCuttings ? 'Credits Cuttings inventory' : undefined} />
      </div>

      <div className="p-3 bg-red-50 rounded-lg border border-red-100">
        <DisplayField label="Damaged (auto = Harvested − Good)" value={damaged.toString()} />
      </div>

      {!isCuttings && (
        <InputField label="Weight (kg)" type="number" step="0.01" error={errors.weightKg?.message} {...register('weightKg')} hint="Credits Fruit inventory (kg)" />
      )}

      {/* Inventory credit preview */}
      {creditPreview ? (
        <p className="text-xs text-leaf-700 bg-leaf-50 border border-leaf-100 rounded-lg px-3 py-2">
          {creditPreview}
        </p>
      ) : (
        <p className="text-xs text-gray-400">
          Pick a variety{isCuttings ? ' and enter good cuttings' : ' and enter a weight'} to credit inventory. Without a variety this harvest is logged but not added to stock.
        </p>
      )}

      <TextareaField label={FIELD.notes.label} {...register('notes')} rows={2} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{entry ? 'Save Changes' : 'Log Harvest'}</Button>
      </div>
    </form>
  );
}
