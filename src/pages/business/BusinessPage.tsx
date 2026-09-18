import { useForm } from 'react-hook-form';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { useBusinessStore } from '../../store/businessStore';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { SectionCard } from '../../components/ui/SectionCard';
import { InputField, TextareaField } from '../../components/forms/FormField';

const schema = z.object({
  businessName: z.string().min(1, 'Business name is required'),
  owner: z.string().min(1, 'Owner is required'),
  farmAddress: z.string().default(''),
  startedYear: z.coerce.number().min(1900).max(2100),
  fiscalYear: z.coerce.number().min(2000).max(2100),
  banksRaw: z.string().default(''),
  notes: z.string().default(''),
});

type FormValues = z.infer<typeof schema>;

export function BusinessPage() {
  const { info, setInfo } = useBusinessStore();

  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<FormValues>({
    defaultValues: {
      businessName: info.businessName,
      owner: info.owner,
      farmAddress: info.farmAddress,
      startedYear: info.startedYear,
      fiscalYear: info.fiscalYear,
      banksRaw: info.banks.join(', '),
      notes: info.notes,
    },
  });

  const onSubmit = (data: FormValues) => {
    setInfo({
      businessName: data.businessName,
      owner: data.owner,
      farmAddress: data.farmAddress,
      startedYear: data.startedYear,
      fiscalYear: data.fiscalYear,
      banks: data.banksRaw.split(',').map((b) => b.trim()).filter(Boolean),
      notes: data.notes,
    });
    toast.success('Business information saved');
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Business Information"
        subtitle="General settings for Dragon Fruit Depot"
        actions={
          <Button
            icon={<Save className="w-4 h-4" />}
            form="business-form"
            type="submit"
            loading={isSubmitting}
            disabled={!isDirty}
          >
            Save Changes
          </Button>
        }
      />

      <form id="business-form" onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <SectionCard title="General Info">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <InputField label="Business Name" required error={errors.businessName?.message} {...register('businessName')} />
              <InputField label="Owner(s)" required error={errors.owner?.message} {...register('owner')} />
            </div>
            <InputField label="Farm Address" error={errors.farmAddress?.message} {...register('farmAddress')} placeholder="e.g. Bulacan, Philippines" />
            <div className="grid grid-cols-2 gap-4">
              <InputField label="Year Started" type="number" error={errors.startedYear?.message} {...register('startedYear')} />
              <InputField label="Fiscal Year" type="number" error={errors.fiscalYear?.message} {...register('fiscalYear')} />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Banking & Payment">
          <InputField
            label="Banks / Payment Methods"
            error={errors.banksRaw?.message}
            {...register('banksRaw')}
            placeholder="Comma-separated: BDO, BPI, Gcash, Zelle"
            hint="Separate multiple banks/methods with commas"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {info.banks.map((b) => (
              <span key={b} className="px-2.5 py-0.5 text-xs font-medium bg-primary-100 text-primary-700 rounded-full">{b}</span>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Notes">
          <TextareaField label="Additional Notes" {...register('notes')} rows={4} placeholder="Any other business information…" />
        </SectionCard>
      </form>
    </div>
  );
}
