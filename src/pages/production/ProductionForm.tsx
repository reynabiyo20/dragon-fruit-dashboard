import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { ProductionEntry } from '../../types';
import { useProductionStore } from '../../store/productionStore';
import { useFarmStore } from '../../store/farmStore';
import { useEmployeeStore } from '../../store/employeeStore';
import { InputField, SelectField, TextareaField, DisplayField } from '../../components/forms/FormField';
import { Button } from '../../components/ui/Button';
import { todayISO, estimateHarvestWindow } from '../../utils/date';
import { formatDate } from '../../utils/format';

const schema = z.object({
  date: z.string().min(1, 'Date is required'),
  farmBlock: z.string(),
  harvestedById: z.string(),
  plants: z.coerce.number().min(0),
  floweringDate: z.string(),
  fruitsHarvested: z.coerce.number().min(0),
  goodFruits: z.coerce.number().min(0),
  weightKg: z.coerce.number().min(0),
  notes: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface ProductionFormProps { entry: ProductionEntry | null; onClose: () => void; }

export function ProductionForm({ entry, onClose }: ProductionFormProps) {
  const { addEntry, updateEntry } = useProductionStore();
  const { sections } = useFarmStore();
  const { activeEmployees } = useEmployeeStore();
  const blockOptions = sections
    .map((s) => ({ value: s.sectionType, label: `${s.sectionType}${s.plantSubcategory ? ` – ${s.plantSubcategory}` : ''} (PIC: ${s.pic})` }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  // Harvester options — active employees, so output can be attributed per worker.
  const harvesters = activeEmployees();
  const harvesterOptions = harvesters
    .map((e) => ({ value: e.id, label: e.position ? `${e.name} — ${e.position}` : e.name }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: entry?.date ?? todayISO(),
      farmBlock: entry?.farmBlock ?? '',
      harvestedById: entry?.harvestedById ?? '',
      plants: entry?.plants ?? 0,
      floweringDate: entry?.floweringDate ?? '',
      fruitsHarvested: entry?.fruitsHarvested ?? 0,
      goodFruits: entry?.goodFruits ?? 0,
      weightKg: entry?.weightKg ?? 0,
      notes: entry?.notes ?? '',
    },
  });

  const fruitsHarvested = Number(useWatch({ control, name: 'fruitsHarvested' })) || 0;
  const goodFruits = Number(useWatch({ control, name: 'goodFruits' })) || 0;
  const damaged = Math.max(0, fruitsHarvested - goodFruits);

  const floweringDate = useWatch({ control, name: 'floweringDate' });
  const harvestWindow = estimateHarvestWindow(floweringDate);

  const onSubmit = (data: FormValues) => {
    // Snapshot the harvester's name so later employee edits don't rewrite history.
    const harvester = harvesters.find((e) => e.id === data.harvestedById);
    const payload = { ...data, harvestedByName: harvester?.name ?? '' };
    if (entry) { updateEntry(entry.id, payload); toast.success('Entry updated'); }
    else { addEntry(payload); toast.success('Harvest logged'); }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Date" type="date" required error={errors.date?.message} {...register('date')} />
        <SelectField label="Farm Block" options={blockOptions} placeholder="Select block…" {...register('farmBlock')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <SelectField label="Harvested By" options={harvesterOptions} placeholder="Unassigned" {...register('harvestedById')} />
        <InputField label="Number of Plants" type="number" step="1" error={errors.plants?.message} {...register('plants')} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <InputField
          label="Flowering Date"
          type="date"
          hint="Fruit ripens ~30 days after flowering"
          error={errors.floweringDate?.message}
          {...register('floweringDate')}
        />
        <div className="p-3 bg-gold-50 rounded-lg border border-gold-100">
          <DisplayField
            label="Est. Harvest Window"
            value={harvestWindow ? `${harvestWindow.label} (${formatDate(harvestWindow.date)})` : 'Set flowering date'}
            highlight={!!harvestWindow}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <InputField label="Fruits Harvested" type="number" step="1" error={errors.fruitsHarvested?.message} {...register('fruitsHarvested')} />
        <InputField label="Good Fruits" type="number" step="1" error={errors.goodFruits?.message} {...register('goodFruits')} />
      </div>

      <div className="p-3 bg-red-50 rounded-lg border border-red-100">
        <DisplayField label="Damaged (auto = Harvested − Good)" value={damaged.toString()} />
      </div>

      <InputField label="Weight (kg)" type="number" step="0.01" error={errors.weightKg?.message} {...register('weightKg')} />
      <TextareaField label="Notes" {...register('notes')} rows={2} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{entry ? 'Save Changes' : 'Log Harvest'}</Button>
      </div>
    </form>
  );
}
