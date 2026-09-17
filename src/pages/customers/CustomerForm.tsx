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
import { InputField, SelectField, TextareaField, CheckboxField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import { Button } from '../../components/ui/Button';
import { DuplicateWarning } from '../../components/forms/DuplicateWarning';
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck';
import { useEntityMatch } from '../../hooks/useEntityMatch';
import {
  FARM_PARTNER_CATEGORY_OPTIONS, farmPartnerSubcategoryOptions,
  FARM_PARTNER_CATEGORY_FRUIT, FARM_PARTNER_CATEGORY_CUTTINGS, FARM_PARTNER_CATEGORY_BOTH,
  FRUIT_PRODUCT_TYPE, CUTTINGS_PRODUCT_TYPE,
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
  // Managed product taxonomy — a new Farm Partner variety cascades into here
  // (Settings) and into the Product catalog on save.
  const categoryEntries = useProductCategoryStore((s) => s.entries);
  const addCategoryEntry = useProductCategoryStore((s) => s.addEntry);
  // Also mirror new varieties into the expense taxonomy so they show up when
  // recording a purchase from this partner.
  const addExpenseEntry = useExpenseCategoryStore((s) => s.addEntry);
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
  const [isFarmPartner, partnerCategory, partnerSubcategory] = useWatch({
    control,
    name: ['farmPartner', 'farmPartnerCategory', 'farmPartnerSubcategory'],
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

  // "Did you mean?" — surface an existing variety that closely matches the typed
  // one (partial, case-insensitive) so users don't create near-duplicates.
  const { matches: varietyMatches, exact: varietyExact } = useEntityMatch(
    partnerSubcategory ?? '',
    subcategoryOptions,
    (o) => o.label,
    !!isFarmPartner && !!(partnerSubcategory ?? '').trim(),
    3,
  );

  /**
   * Cascade a (possibly new) Farm Partner variety into the Product Catalog and
   * the managed taxonomy (Settings). Adds the variety under the product type(s)
   * implied by the partner category, creating catalog rows when missing.
   */
  const cascadeVariety = (category: string, subcategory: string) => {
    const sub = subcategory.trim();
    if (!sub) return;
    const productTypes =
      category === FARM_PARTNER_CATEGORY_BOTH
        ? [FRUIT_PRODUCT_TYPE, CUTTINGS_PRODUCT_TYPE]
        : category === FARM_PARTNER_CATEGORY_FRUIT
          ? [FRUIT_PRODUCT_TYPE]
          : category === FARM_PARTNER_CATEGORY_CUTTINGS
            ? [CUTTINGS_PRODUCT_TYPE]
            : [];
    const { findByCategorySub, addProduct } = useProductStore.getState();
    productTypes.forEach((type) => {
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
          unit: type === CUTTINGS_PRODUCT_TYPE ? 'piece' : 'Kg',
          notes: 'Auto-added from a Farm Partner variety.',
        });
      }
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
    // Normalize partner fields: clear category/subcategory when not a partner so
    // stale values don't cascade to Vendors.
    const payload = data.farmPartner
      ? data
      : { ...data, farmPartnerCategory: '', farmPartnerSubcategory: '' };

    // Cascade a new partner variety into the Product Catalog + Settings taxonomy.
    if (payload.farmPartner && payload.farmPartnerSubcategory.trim()) {
      cascadeVariety(payload.farmPartnerCategory, payload.farmPartnerSubcategory);
    }

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
            <div>
              <CreatableSelect
                label="Subcategory (Variety)"
                placeholder={partnerCategory ? 'Select or add a variety…' : 'Select a category first'}
                options={subcategoryOptions}
                disabled={!partnerCategory}
                value={partnerSubcategory ?? ''}
                onChange={(v) => setValue('farmPartnerSubcategory', v, { shouldDirty: true })}
                onCreate={(v) => setValue('farmPartnerSubcategory', v, { shouldDirty: true })}
                createLabel="+ Add new variety…"
                newFieldLabel="New Variety"
                newFieldPlaceholder="e.g. Moroccan Red"
              />
              {/* Similar-variety recommendation to avoid near-duplicates. */}
              <SimilarEntryHint
                value={partnerSubcategory ?? ''}
                options={subcategoryOptions.map((o) => o.value)}
                noun="variety"
                onPick={(v) => setValue('farmPartnerSubcategory', v, { shouldDirty: true })}
              />
              {partnerSubcategory?.trim() && !varietyExact && varietyMatches.length === 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  New variety — it'll be added to your Product Catalog &amp; Settings on save.
                </p>
              )}
            </div>
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
