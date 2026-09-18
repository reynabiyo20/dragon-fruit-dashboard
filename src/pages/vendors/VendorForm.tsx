import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { Vendor, VendorSupply } from '../../types';
import { useVendorStore } from '../../store/vendorStore';
import { InputField, TextareaField } from '../../components/forms/FormField';
import { VendorSuppliesField } from '../../components/forms/VendorSuppliesField';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { DuplicateWarning } from '../../components/forms/DuplicateWarning';
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck';

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
  const isEditing = !!vendor;

  // Structured supplies managed as local state (UI lives in VendorSuppliesField)
  const [supplies, setSupplies] = useState<VendorSupply[]>(vendor?.supplies ?? []);

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

      {/* Structured supplies manager (shared component) */}
      <VendorSuppliesField value={supplies} onChange={setSupplies} />
      {supplies.length === 0 && (
        <p className="text-xs text-gray-400">
          No supplies listed yet. <Badge label="tip" variant="gray" /> You can also let this fill in automatically as you log expenses.
        </p>
      )}

      <TextareaField label="Notes" {...register('notes')} rows={2} />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{vendor ? 'Save Changes' : 'Add Vendor'}</Button>
      </div>
    </form>
  );
}
