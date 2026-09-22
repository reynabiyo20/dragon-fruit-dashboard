import { useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Handshake } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Customer } from '../../types';
import { useCustomerStore } from '../../store/customerStore';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { useProductStore } from '../../store/productStore';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import { useUnitStore } from '../../store/optionStores';
import { InputField, SelectField, TextareaField, CheckboxField } from '../../components/forms/FormField';
import { MultiCreatableSelect } from '../../components/forms/MultiCreatableSelect';
import { LocationSelect } from '../../components/forms/LocationSelect';
import { isValidLocation, PHILIPPINES, countryOf } from '../../constants/geography';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DuplicateWarning } from '../../components/forms/DuplicateWarning';
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck';
import {
  FARM_PARTNER_CATEGORY_OPTIONS, farmPartnerSubcategoryOptions,
  FARM_PARTNER_CATEGORY_FRUIT, FARM_PARTNER_CATEGORY_CUTTINGS, FARM_PARTNER_CATEGORY_BOTH,
  FRUIT_PRODUCT_TYPE, CUTTINGS_PRODUCT_TYPE,
} from '../../constants';
import { ENTITY, toastSuccess, requiredMsg, FIELD } from '../../constants/messages';

// A customer is identity + contact only. How a customer transacts (walk-in,
// online, …) is a property of each Sale, not the customer — see Sale.saleType.
// Exception: a customer may also be a "Farm Partner" the business buys from,
// which cascades into the Vendors module on save.
const schema = z
  .object({
    customerName: z.string().min(1, requiredMsg('Customer name')),
    contactPerson: z.string(),
    phone: z.string(),
    fbMessengerName: z.string(),
    email: z.string(),
    address: z.string(),
    country: z.string().min(1, requiredMsg('Country')),
    province: z.string(), // required for Philippine customers (checked below)
    municipality: z.string(), // optional — a province alone is enough
    farmPartner: z.boolean(),
    farmPartnerCategory: z.string(),
    farmPartnerSubcategory: z.string(),
    notes: z.string(),
  })
  // A Farm Partner must say what they supply.
  .refine((d) => !d.farmPartner || d.farmPartnerCategory.trim().length > 0, {
    path: ['farmPartnerCategory'],
    message: 'Select what this partner supplies',
  })
  // Province is required for LOCAL (Philippine) customers so we can map our
  // footprint. International customers skip it (it's a Philippine-only field).
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

// A Farm Partner can supply several varieties. To stay compatible with the
// persisted data model (a single `farmPartnerSubcategory` string), the list is
// stored comma-separated. These helpers convert between the stored string and
// the array the multi-select works with.
const parseVarieties = (raw: string): string[] =>
  raw.split(',').map((s) => s.trim()).filter(Boolean);
const joinVarieties = (list: string[]): string =>
  [...new Set(list.map((s) => s.trim()).filter(Boolean))].join(', ');

interface CustomerFormProps {
  customer: Customer | null;
  onClose: () => void;
}

export function CustomerForm({ customer, onClose }: CustomerFormProps) {
  const { customers, addCustomer, updateCustomer, linkedVendorName, removeLinkedVendor } = useCustomerStore();
  // Managed product taxonomy — a new Farm Partner variety cascades into here
  // (Settings) and into the Product catalog on save.
  const categoryEntries = useProductCategoryStore((s) => s.entries);
  const addCategoryEntry = useProductCategoryStore((s) => s.addEntry);
  // Also mirror new varieties into the expense taxonomy so they show up when
  // recording a purchase from this partner.
  const addExpenseEntry = useExpenseCategoryStore((s) => s.addEntry);
  const isEditing = !!customer;

  const { register, handleSubmit, control, setValue, getValues, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    shouldUnregister: false,
    defaultValues: {
      customerName: customer?.customerName ?? '',
      contactPerson: customer?.contactPerson ?? '',
      phone: customer?.phone ?? '',
      fbMessengerName: customer?.fbMessengerName ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      country: countryOf(customer?.location),
      province: customer?.location?.province ?? '',
      municipality: customer?.location?.municipality ?? '',
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

  // Contact Person mirrors the customer name while the user hasn't typed their
  // own value there, so the default is visible in the field as they fill in the
  // name — but stays fully editable. Seed as "touched" when editing a record
  // whose contact person already differs from its name, so we never clobber it.
  const contactTouched = useRef(
    isEditing && (customer?.contactPerson ?? '') !== (customer?.customerName ?? '')
  );
  const registeredName = register('customerName');
  const registeredContact = register('contactPerson');

  // When editing a customer OFF Farm Partner who has a linked vendor, we pause
  // the save to confirm removing that vendor. Holds the deferred save action and
  // the vendor name to show in the confirmation, until the user confirms/cancels.
  const [pendingUnlink, setPendingUnlink] = useState<{ save: () => void; vendorName: string } | null>(null);

  // Farm Partner conditional fields
  const [isFarmPartner, partnerCategory, partnerSubcategory] = useWatch({
    control,
    name: ['farmPartner', 'farmPartnerCategory', 'farmPartnerSubcategory'],
  });

  // Location — country, plus province/municipality for Philippine records.
  const [country, province, municipality] = useWatch({
    control,
    name: ['country', 'province', 'municipality'],
  });

  // Variety options for the selected category, merged with any variety already
  // present in the managed taxonomy for the relevant product type(s), so the
  // creatable-select shows the live Settings list (not just the seed colours).
  const subcategoryOptions = (() => {
    const base = farmPartnerSubcategoryOptions(partnerCategory ?? '');
    const cats =
      partnerCategory === FARM_PARTNER_CATEGORY_BOTH
        ? [FRUIT_PRODUCT_TYPE, CUTTINGS_PRODUCT_TYPE]
        : partnerCategory === FARM_PARTNER_CATEGORY_FRUIT
          ? [FRUIT_PRODUCT_TYPE]
          : partnerCategory === FARM_PARTNER_CATEGORY_CUTTINGS
            ? [CUTTINGS_PRODUCT_TYPE]
            : [];
    const taxonomy = categoryEntries
      .filter((e) => cats.includes(e.category) && e.subcategory !== '')
      .map((e) => e.subcategory);
    const merged = [...new Set([...base.map((o) => o.value), ...taxonomy])].sort();
    return merged.map((v) => ({ value: v, label: v }));
  })();

  // Selected varieties, derived from the comma-separated stored string.
  const selectedVarieties = parseVarieties(partnerSubcategory ?? '');

  /**
   * Cascade the (possibly new) Farm Partner varieties into the Product Catalog
   * and the managed taxonomy (Settings). Adds each variety under the product
   * type(s) implied by the partner category, creating catalog rows when missing.
   */
  const cascadeVarieties = (category: string, subcategories: string[]) => {
    const subs = [...new Set(subcategories.map((s) => s.trim()).filter(Boolean))];
    if (subs.length === 0) return;
    const productTypes =
      category === FARM_PARTNER_CATEGORY_BOTH
        ? [FRUIT_PRODUCT_TYPE, CUTTINGS_PRODUCT_TYPE]
        : category === FARM_PARTNER_CATEGORY_FRUIT
          ? [FRUIT_PRODUCT_TYPE]
          : category === FARM_PARTNER_CATEGORY_CUTTINGS
            ? [CUTTINGS_PRODUCT_TYPE]
            : [];
    const { findByCategorySub, addProduct } = useProductStore.getState();
    // Resolve the auto-created product's unit to the managed list's canonical
    // casing (e.g. "kg" if Settings renamed "Kg" → "kg") so it mirrors the unit
    // dropdowns everywhere; fall back to the literal if the list has no match.
    const unitValues = useUnitStore.getState().values;
    const canonicalUnit = (u: string) =>
      unitValues.find((v) => v.trim().toLowerCase() === u.trim().toLowerCase()) ?? u;
    productTypes.forEach((type) => {
      subs.forEach((sub) => {
        // Product taxonomy / Settings (dedupes internally) — drives Products & Sales.
        addCategoryEntry(type, sub);
        // Expense taxonomy — drives the Expense form's category/subcategory dropdowns
        // so this partner's variety is selectable when recording a purchase from them.
        addExpenseEntry(type, sub);
        // Product catalog row (skip if it already exists).
        if (!findByCategorySub(type, sub)) {
          addProduct({
            category: type,
            subcategory: sub,
            costPHP: 0,
            sellingPricePHP: 0,
            costUSD: 0,
            sellingPriceUSD: 0,
            unit: canonicalUnit(type === CUTTINGS_PRODUCT_TYPE ? 'piece' : 'Kg'),
            notes: 'Auto-added from a Farm Partner variety.',
          });
        }
      });
    });
  };

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
    // Fold the flat country/province/municipality form fields into the structured
    // location the store persists. International customers carry country only —
    // province/municipality are Philippine-only, so they're blanked.
    const { country: ctry, province: prov, municipality: muni, ...rest } = data;
    const isLocal = ctry === PHILIPPINES;

    // Contact Person defaults to the customer's own name when left blank — most
    // customers are individuals who are their own contact. The user can override
    // it by typing a different name.
    const withContact = {
      ...rest,
      contactPerson: rest.contactPerson.trim() || rest.customerName.trim(),
      location: {
        country: ctry,
        province: isLocal ? prov : '',
        municipality: isLocal ? muni : '',
      },
    };

    // Normalize partner fields: clear category/subcategory when not a partner so
    // stale values don't cascade to Vendors.
    const payload = withContact.farmPartner
      ? withContact
      : { ...withContact, farmPartnerCategory: '', farmPartnerSubcategory: '' };

    // Cascade any new partner varieties into the Product Catalog + Settings taxonomy.
    if (payload.farmPartner && payload.farmPartnerSubcategory.trim()) {
      cascadeVarieties(payload.farmPartnerCategory, parseVarieties(payload.farmPartnerSubcategory));
    }

    // Persist the customer, optionally removing the auto-linked vendor when the
    // customer is no longer a Farm Partner.
    const persist = (removeVendor: boolean) => {
      const syncSuffix = payload.farmPartner ? ' & synced to Vendors' : '';
      if (customer) {
        updateCustomer(customer.id, payload);
        let msg = toastSuccess(ENTITY.customer, 'updated') + syncSuffix;
        if (removeVendor && removeLinkedVendor(customer.customerName)) {
          msg += ' & removed from Vendors';
        }
        toast.success(msg);
      } else {
        addCustomer(payload);
        toast.success(toastSuccess(ENTITY.customer, 'created') + syncSuffix);
      }
      onClose();
    };

    // Turning OFF Farm Partner on an existing customer that has an auto-linked
    // vendor: confirm before removing that vendor (it may carry manual edits).
    const wasPartner = !!customer?.farmPartner;
    if (customer && wasPartner && !payload.farmPartner) {
      const vendorName = linkedVendorName(customer.customerName);
      if (vendorName) {
        setPendingUnlink({ save: () => persist(true), vendorName });
        return;
      }
    }

    persist(false);
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
        <InputField
          label={FIELD.customerName.label}
          required
          autoFocus
          error={errors.customerName?.message}
          {...registeredName}
          onChange={(e) => {
            registeredName.onChange(e);
            // Mirror into Contact Person until the user edits it themselves.
            if (!contactTouched.current) {
              setValue('contactPerson', e.target.value, { shouldDirty: true });
            }
          }}
        />
        <InputField
          label="Contact Person"
          hint="Defaults to the customer name — edit to override"
          {...registeredContact}
          onChange={(e) => {
            registeredContact.onChange(e);
            // Once the user types their own contact (or clears it back to match
            // the name), decide whether we keep mirroring the name.
            contactTouched.current = e.target.value.trim() !== getValues('customerName').trim();
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Phone" type="tel" {...register('phone')} />
        <InputField label="FB Handler" {...register('fbMessengerName')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Email" type="email" {...register('email')} />
        <InputField label="Address" {...register('address')} />
      </div>

      {/* Location — Country, then Province → Municipality for local (PH) customers. */}
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

      {/* Farm Partner — a customer the business also buys from. When enabled the
          customer cascades into the Vendors module on save. */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Handshake className="w-4 h-4 text-primary-600" />
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
          // Category on its own row (kept narrow), then the Subcategories
          // checkbox-list spans the full modal width below it so all varieties
          // are readable rather than squeezed into a half-width column.
          <div className="space-y-3">
            <div className="sm:max-w-xs">
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
            </div>
            <MultiCreatableSelect
              label="Subcategories (Varieties)"
              placeholder={partnerCategory ? 'Select or add a variety…' : 'Select a category first'}
              options={subcategoryOptions}
              disabled={!partnerCategory}
              values={selectedVarieties}
              onChange={(list) =>
                setValue('farmPartnerSubcategory', joinVarieties(list), { shouldDirty: true })
              }
              onCreate={() => { /* persisted by the cascade on save */ }}
              createLabel="+ Add new variety…"
              newFieldLabel="New Variety"
              newFieldPlaceholder="e.g. Moroccan Red"
              hint="Add one or more varieties this partner supplies. New ones are added to your Product Catalog & Settings on save."
            />
          </div>
        )}
      </div>

      <TextareaField label={FIELD.notes.label} {...register('notes')} rows={2} />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{customer ? 'Save Changes' : 'Add Customer'}</Button>
      </div>

      {/* Confirm removing the auto-linked vendor when unchecking Farm Partner. */}
      <ConfirmDialog
        open={!!pendingUnlink}
        onClose={() => setPendingUnlink(null)}
        onConfirm={() => {
          pendingUnlink?.save();
          setPendingUnlink(null);
        }}
        title="Remove linked vendor?"
        message={`"${pendingUnlink?.vendorName}" was auto-added to your Vendors as a Farm Partner. Unchecking Farm Partner will remove that vendor record (any manual edits or supplies on it will be lost). Continue?`}
        confirmLabel="Remove vendor"
      />
    </form>
  );
}
