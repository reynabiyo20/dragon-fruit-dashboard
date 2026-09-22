import { useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { Vendor, VendorSupply } from '../../types';
import { useVendorStore } from '../../store/vendorStore';
import { InputField, TextareaField } from '../../components/forms/FormField';
import { LocationSelect } from '../../components/forms/LocationSelect';
import { VendorSuppliesField } from '../../components/forms/VendorSuppliesField';
import { isValidLocation, PHILIPPINES, countryOf } from '../../constants/geography';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { DuplicateWarning } from '../../components/forms/DuplicateWarning';
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck';
import { ENTITY, toastSuccess, requiredMsg, FIELD } from '../../constants/messages';

const schema = z
  .object({
    vendor: z.string().min(1, requiredMsg('Vendor name')),
    contact: z.string(),
    phone: z.string(),
    country: z.string().min(1, requiredMsg('Country')),
    province: z.string(), // required for Philippine vendors (checked below)
    municipality: z.string(), // optional — a province alone is enough
    notes: z.string(),
  })
  // Province is required for LOCAL (Philippine) vendors. International vendors
  // skip it (province/municipality are Philippine-only fields).
  .refine((d) => d.country !== PHILIPPINES || d.province.trim().length > 0, {
    path: ['province'],
    message: requiredMsg('Province'),
  })
  // The municipality must genuinely belong to the chosen province (PH only).
  .refine((d) => d.country !== PHILIPPINES || !d.municipality || isValidLocation(d.province, d.municipality), {
    path: ['municipality'],
    message: 'Municipality does not match the selected province',
  });

type FormValues = z.infer<typeof schema>;

interface VendorFormProps { vendor: Vendor | null; onClose: () => void; }

export function VendorForm({ vendor, onClose }: VendorFormProps) {
  const { vendors, addVendor, updateVendor } = useVendorStore();
  const isEditing = !!vendor;

  // Structured supplies managed as local state (UI lives in VendorSuppliesField)
  const [supplies, setSupplies] = useState<VendorSupply[]>(vendor?.supplies ?? []);

  const { register, handleSubmit, control, setValue, getValues, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      vendor: vendor?.vendor ?? '',
      contact: vendor?.contact ?? '',
      phone: vendor?.phone ?? '',
      country: countryOf(vendor?.location),
      province: vendor?.location?.province ?? '',
      municipality: vendor?.location?.municipality ?? '',
      notes: vendor?.notes ?? '',
    },
  });

  const [vendorName, phone, contact, country, province, municipality] = useWatch({
    control,
    name: ['vendor', 'phone', 'contact', 'country', 'province', 'municipality'],
  });

  // Contact Person mirrors the vendor name while the user hasn't typed their own
  // value there, so the default is visible in the field as they fill in the name
  // — but stays fully editable. Seed as "touched" when editing a record whose
  // contact already differs from its name, so we never clobber it.
  const contactTouched = useRef(
    isEditing && (vendor?.contact ?? '') !== (vendor?.vendor ?? '')
  );
  const registeredName = register('vendor');
  const registeredContact = register('contact');

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
    // Contact Person defaults to the vendor's own name when left blank. The user
    // can override it by typing a different name.
    const { country: ctry, province: prov, municipality: muni, ...rest } = data;
    const isLocal = ctry === PHILIPPINES;
    const payload = {
      ...rest,
      contact: rest.contact.trim() || rest.vendor.trim(),
      location: {
        country: ctry,
        province: isLocal ? prov : '',
        municipality: isLocal ? muni : '',
      },
      supplies,
    };
    if (vendor) { updateVendor(vendor.id, payload); toast.success(toastSuccess(ENTITY.vendor, 'updated')); }
    else { addVendor(payload); toast.success(toastSuccess(ENTITY.vendor, 'created')); }
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
        <InputField
          label={FIELD.vendorName.label}
          required
          autoFocus
          error={errors.vendor?.message}
          {...registeredName}
          onChange={(e) => {
            registeredName.onChange(e);
            // Mirror into Contact Person until the user edits it themselves.
            if (!contactTouched.current) {
              setValue('contact', e.target.value, { shouldDirty: true });
            }
          }}
        />
        <InputField
          label="Contact Person"
          hint="Defaults to the vendor name — edit to override"
          {...registeredContact}
          onChange={(e) => {
            registeredContact.onChange(e);
            contactTouched.current = e.target.value.trim() !== getValues('vendor').trim();
          }}
        />
      </div>
      <InputField label="Phone" type="tel" {...register('phone')} />

      {/* Location — Country, then Province → Municipality for local (PH) vendors. */}
      <LocationSelect
        required
        value={{ country: country ?? PHILIPPINES, province: province ?? '', municipality: municipality ?? '' }}
        provinceError={errors.province?.message}
        municipalityError={errors.municipality?.message}
        onChange={(loc) => {
          setValue('country', loc.country ?? PHILIPPINES, { shouldValidate: true, shouldDirty: true });
          setValue('province', loc.province, { shouldValidate: true, shouldDirty: true });
          setValue('municipality', loc.municipality, { shouldValidate: true, shouldDirty: true });
        }}
      />

      {/* Structured supplies manager (shared component) */}
      <VendorSuppliesField value={supplies} onChange={setSupplies} />
      {supplies.length === 0 && (
        <p className="text-xs text-gray-400">
          No supplies listed yet. <Badge label="tip" variant="gray" /> You can also let this fill in automatically as you log expenses.
        </p>
      )}

      <TextareaField label={FIELD.notes.label} {...register('notes')} rows={2} />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{vendor ? 'Save Changes' : 'Add Vendor'}</Button>
      </div>
    </form>
  );
}
