import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Handshake } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Customer } from '../../types';
import { useCustomerStore } from '../../store/customerStore';
import { InputField, SelectField, TextareaField, CheckboxField } from '../../components/forms/FormField';
import { Button } from '../../components/ui/Button';
import { DuplicateWarning } from '../../components/forms/DuplicateWarning';
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck';
import {
  FARM_PARTNER_CATEGORY_OPTIONS, farmPartnerSubcategoryOptions,
} from '../../constants';

// A customer is identity + contact only. How a customer transacts (walk-in,
// online, …) is a property of each Sale, not the customer — see Sale.saleType.
// Exception: a customer may also be a "Farm Partner" the business buys from,
// which cascades into the Vendors module on save.
const schema = z
  .object({
    customerName: z.string().min(1, 'Customer name is required'),
    contactPerson: z.string(),
    phone: z.string(),
    fbMessengerName: z.string(),
    email: z.string(),
    address: z.string(),
    farmPartner: z.boolean(),
    farmPartnerCategory: z.string(),
    farmPartnerSubcategory: z.string(),
    notes: z.string(),
  })
  // A Farm Partner must say what they supply.
  .refine((d) => !d.farmPartner || d.farmPartnerCategory.trim().length > 0, {
    path: ['farmPartnerCategory'],
    message: 'Select what this partner supplies',
  });

type FormValues = z.infer<typeof schema>;

interface CustomerFormProps {
  customer: Customer | null;
  onClose: () => void;
}

export function CustomerForm({ customer, onClose }: CustomerFormProps) {
  const { customers, addCustomer, updateCustomer } = useCustomerStore();
  const isEditing = !!customer;

  const { register, handleSubmit, control, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    shouldUnregister: false,
    defaultValues: {
      customerName: customer?.customerName ?? '',
      contactPerson: customer?.contactPerson ?? '',
      phone: customer?.phone ?? '',
      fbMessengerName: customer?.fbMessengerName ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      farmPartner: customer?.farmPartner ?? false,
      farmPartnerCategory: customer?.farmPartnerCategory ?? '',
      farmPartnerSubcategory: customer?.farmPartnerSubcategory ?? '',
      notes: customer?.notes ?? '',
    },
  });

  // Watch fields used for duplicate detection
  const [name, phone, email, fb, contactPerson] = useWatch({
    control,
    name: ['customerName', 'phone', 'email', 'fbMessengerName', 'contactPerson'],
  });

  // Farm Partner conditional fields
  const [isFarmPartner, partnerCategory] = useWatch({
    control,
    name: ['farmPartner', 'farmPartnerCategory'],
  });
  const subcategoryOptions = farmPartnerSubcategoryOptions(partnerCategory ?? '');

  // Exclude the record being edited from the candidate list
  const candidates = customer ? customers.filter((c) => c.id !== customer.id) : customers;
  const duplicates = useDuplicateCheck(
    candidates,
    [
      { label: 'Name', value: name ?? '', of: (c) => c.customerName },
      { label: 'Phone', value: phone ?? '', of: (c) => c.phone },
      { label: 'Email', value: email ?? '', of: (c) => c.email },
      { label: 'FB Handler', value: fb ?? '', of: (c) => c.fbMessengerName },
      { label: 'Contact Person', value: contactPerson ?? '', of: (c) => c.contactPerson },
    ],
    !isEditing
  );

  const onSubmit = (data: FormValues) => {
    // Normalize partner fields: clear category/subcategory when not a partner so
    // stale values don't cascade to Vendors.
    const payload = data.farmPartner
      ? data
      : { ...data, farmPartnerCategory: '', farmPartnerSubcategory: '' };

    if (customer) {
      updateCustomer(customer.id, payload);
      toast.success(payload.farmPartner ? 'Customer updated & synced to Vendors' : 'Customer updated');
    } else {
      addCustomer(payload);
      toast.success(payload.farmPartner ? 'Customer added & synced to Vendors' : 'Customer added');
    }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {!isEditing && (
        <DuplicateWarning
          matches={duplicates}
          atLimit={duplicates.length >= 5}
          labelOf={(c) => c.customerName}
          keyOf={(c) => c.id}
          noun="customer"
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <InputField label="Customer Name" required autoFocus error={errors.customerName?.message} {...register('customerName')} />
        <InputField label="Contact Person" {...register('contactPerson')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Phone" type="tel" {...register('phone')} />
        <InputField label="FB Handler" {...register('fbMessengerName')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Email" type="email" {...register('email')} />
        <InputField label="Address" {...register('address')} />
      </div>

      {/* Farm Partner — a customer the business also buys from. When enabled the
          customer cascades into the Vendors module on save. */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Handshake className="w-4 h-4 text-green-600" />
          Farm Partner
        </div>
        <CheckboxField
          label="Farm Partner?"
          checked={!!isFarmPartner}
          onChange={(checked) => {
            setValue('farmPartner', checked, { shouldValidate: true, shouldDirty: true });
            if (!checked) {
              setValue('farmPartnerCategory', '', { shouldValidate: true });
              setValue('farmPartnerSubcategory', '');
            }
          }}
          hint="This customer also supplies us with fruit or cuttings. Saving syncs them to Vendors."
        />

        {isFarmPartner && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField
              label="Category"
              required
              placeholder="Select category…"
              options={FARM_PARTNER_CATEGORY_OPTIONS}
              error={errors.farmPartnerCategory?.message}
              value={partnerCategory ?? ''}
              onChange={(e) => {
                setValue('farmPartnerCategory', e.target.value, { shouldValidate: true, shouldDirty: true });
                // Reset subcategory when the category (and thus its scope) changes.
                setValue('farmPartnerSubcategory', '');
              }}
            />
            <SelectField
              label="Subcategory"
              placeholder={partnerCategory ? 'Select subcategory…' : 'Select a category first'}
              options={subcategoryOptions}
              disabled={!partnerCategory}
              {...register('farmPartnerSubcategory')}
            />
          </div>
        )}
      </div>

      <TextareaField label="Notes" {...register('notes')} rows={2} />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{customer ? 'Save Changes' : 'Add Customer'}</Button>
      </div>
    </form>
  );
}
