import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { FarmSection } from '../../types';
import { useFarmStore } from '../../store/farmStore';
import { InputField, SelectField, TextareaField } from '../../components/forms/FormField';
import { Button } from '../../components/ui/Button';
import { FARM_SECTION_TYPE_OPTIONS, FARM_AREA_UNIT_OPTIONS, FARM_LIFECYCLE_STAGE_OPTIONS } from '../../constants';
import { ENTITY, toastSuccess, requiredMsg, VALIDATION, FIELD } from '../../constants/messages';

const schema = z.object({
  sectionType: z.string().min(1, requiredMsg('Section type')),
  area: z.coerce.number().min(0),
  unit: z.string().min(1, VALIDATION.unitRequired),
  currentPlantCapacity: z.coerce.number().min(0),
  plantSubcategory: z.string(),
  pic: z.string(),
  lifecycleStage: z.string(),
  stageDate: z.string(),
  notes: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface FarmFormProps { section: FarmSection | null; onClose: () => void; }

export function FarmForm({ section, onClose }: FarmFormProps) {
  const { addSection, updateSection } = useFarmStore();

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      sectionType: section?.sectionType ?? '',
      area: section?.area ?? 0,
      unit: section?.unit ?? 'Sqm',
      currentPlantCapacity: section?.currentPlantCapacity ?? 0,
      plantSubcategory: section?.plantSubcategory ?? '',
      pic: section?.pic ?? '',
      lifecycleStage: section?.lifecycleStage ?? '',
      stageDate: section?.stageDate ?? '',
      notes: section?.notes ?? '',
    },
  });

  const onSubmit = (data: FormValues) => {
    if (section) { updateSection(section.id, data); toast.success(toastSuccess(ENTITY.farmSection, 'updated')); }
    else { addSection(data); toast.success(toastSuccess(ENTITY.farmSection, 'created')); }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <SelectField label="Section Type" required autoFocus options={FARM_SECTION_TYPE_OPTIONS} placeholder="Select type…" error={errors.sectionType?.message} {...register('sectionType')} />
        <InputField label="Plant Subcategory" {...register('plantSubcategory')} placeholder="e.g. Thai Red" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Area" type="number" step="0.01" error={errors.area?.message} {...register('area')} />
        <SelectField label={FIELD.unit.label} required options={FARM_AREA_UNIT_OPTIONS} error={errors.unit?.message} {...register('unit')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Current Plant Capacity" type="number" step="1" error={errors.currentPlantCapacity?.message} {...register('currentPlantCapacity')} />
        <InputField label="Person-in-Charge (PIC)" {...register('pic')} placeholder="e.g. Tiboy" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <SelectField label="Lifecycle Stage" options={FARM_LIFECYCLE_STAGE_OPTIONS} placeholder="Not tagged…" {...register('lifecycleStage')} />
        <InputField label="Stage Date" type="date" hint="Flowering date drives the ~30-day harvest estimate" {...register('stageDate')} />
      </div>
      <TextareaField label={FIELD.notes.label} {...register('notes')} rows={2} />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{section ? 'Save Changes' : 'Add Section'}</Button>
      </div>
    </form>
  );
}
