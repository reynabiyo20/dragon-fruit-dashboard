import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { Expense, Currency } from '../../types';
import { useExpenseStore } from '../../store/expenseStore';
import { useVendorStore } from '../../store/vendorStore';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import { useServiceCategoryStore } from '../../store/serviceCategoryStore';
import { useExpenseDraftStore, type ServiceDraft } from '../../store/expenseDraftStore';
import {
  useAccountingClassificationStore, useExpenseTypeStore,
} from '../../store/optionStores';
import { InputField, SelectField, TextareaField, CheckboxField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { formatDate } from '../../utils/format';
import { isInternationalLocation } from '../../constants/geography';
import { isFutureDate, todayISO } from '../../utils/date';
import { PAYMENT_OPTIONS, METHODS_REQUIRING_DETAILS, MANUAL_ENTRY, SERVICE_CATEGORIES } from '../../constants';
import { ENTITY, toastSuccess, VALIDATION, FIELD } from '../../constants/messages';
import { AlertCircle } from 'lucide-react';
import { syncTaxonomy } from '../../store/taxonomySync';

/**
 * Service expense form — the "Service" branch of Add Expense.
 *
 * A service isn't a physical product, so there's no quantity/unit/inventory/
 * resell flow. It captures: category (limited to the SERVICE_CATEGORIES),
 * subcategory, a provider (optional vendor), amount, payment, and the
 * bookkeeping classification/type (prefilled from the category). Saved as a
 * single-line expense (no `items`).
 */

const schema = z
  .object({
    date: z.string().min(1, VALIDATION.dateRequired),
    category: z.string().min(1, VALIDATION.categoryRequired),
    subcategory: z.string(),
    vendorId: z.string(),
    vendorName: z.string(),
    amount: z.coerce.number().min(0.01, VALIDATION.amountPositive),
    // Payment method/details are only required when PAID — an unpaid (Pending)
    // service flows to Outstanding without a method.
    paymentMethod: z.string(),
    paymentDetails: z.string(),
    paid: z.boolean(),
    accountingClassification: z.string(),
    expenseType: z.string(),
    description: z.string(),
    notes: z.string(),
  })
  // A paid expense must have a payment method.
  .refine((d) => !d.paid || d.paymentMethod.trim().length > 0, {
    path: ['paymentMethod'],
    message: VALIDATION.paymentMethodRequired,
  })
  // Payment details required for certain methods — only when paid.
  .refine(
    (d) => !d.paid || !METHODS_REQUIRING_DETAILS.includes(d.paymentMethod) || d.paymentDetails.trim().length > 0,
    { path: ['paymentDetails'], message: 'Payment details are required for this payment method' },
  );

type FormValues = z.infer<typeof schema>;

interface ServiceExpenseFormProps {
  expense: Expense | null;
  onClose: () => void;
}

export function ServiceExpenseForm({ expense, onClose }: ServiceExpenseFormProps) {
  // In-progress draft (new expenses only). Read once at mount so its values seed
  // the useState / RHF initializers — see ExpenseForm for the rationale.
  const isNew = !expense;
  const draftSnapshot = useRef(isNew ? useExpenseDraftStore.getState() : null);
  const serviceDraft = draftSnapshot.current?.service ?? {};
  const patchServiceDraft = useExpenseDraftStore((s) => s.patchService);
  const clearDraft = useExpenseDraftStore((s) => s.clear);

  const { addExpense, updateExpense } = useExpenseStore();
  const { vendors, addVendor, addSupply } = useVendorStore();
  const { subcategoriesFor, addEntry, bookkeepingFor } = useExpenseCategoryStore();
  const customServiceNames = useServiceCategoryStore((s) => s.names);
  const addServiceCategory = useServiceCategoryStore((s) => s.add);
  const acValues = useAccountingClassificationStore((s) => s.values);
  const addAccountingClassification = useAccountingClassificationStore((s) => s.add);
  const accountingOptions = acValues.map((v) => ({ value: v, label: v }));
  const expenseTypeValues = useExpenseTypeStore((s) => s.values);
  const addExpenseType = useExpenseTypeStore((s) => s.add);
  const expenseTypeOptions = expenseTypeValues.map((v) => ({ value: v, label: v }));

  const [isPaid, setIsPaid] = useState(serviceDraft.isPaid ?? expense?.paid ?? false);
  const [pendingFutureData, setPendingFutureData] = useState<FormValues | null>(null);

  // Service categories = the built-in list plus any the user has added manually
  // (deduped, case-insensitive). New ones can also be typed inline via the
  // CreatableSelect and are persisted as services (see doSave).
  const serviceCategoryNames = (() => {
    const seen = new Set(SERVICE_CATEGORIES.map((c) => c.toLowerCase()));
    const merged: string[] = [...SERVICE_CATEGORIES];
    customServiceNames.forEach((c) => {
      if (!seen.has(c.toLowerCase())) {
        seen.add(c.toLowerCase());
        merged.push(c);
      }
    });
    return merged.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  })();
  const categoryOptions = serviceCategoryNames.map((c) => ({ value: c, label: c }));

  const { register, handleSubmit, setValue, watch, trigger, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    // Restore any in-progress service draft first (new expenses only).
    defaultValues: {
      date: serviceDraft.date ?? expense?.date ?? todayISO(),
      category: serviceDraft.category ?? expense?.category ?? '',
      subcategory: serviceDraft.subcategory ?? expense?.subcategory ?? '',
      vendorId: serviceDraft.vendorId ?? expense?.vendorId ?? '',
      vendorName: serviceDraft.vendorName ?? expense?.vendorName ?? '',
      amount: serviceDraft.amount ?? expense?.amount ?? 0,
      paymentMethod: serviceDraft.paymentMethod ?? expense?.paymentMethod ?? 'Cash',
      paymentDetails: serviceDraft.paymentDetails ?? expense?.paymentDetails ?? '',
      paid: serviceDraft.paid ?? expense?.paid ?? false,
      accountingClassification: serviceDraft.accountingClassification ?? expense?.accountingClassification ?? '',
      expenseType: serviceDraft.expenseType ?? expense?.expenseType ?? '',
      description: serviceDraft.description ?? expense?.description ?? '',
      notes: serviceDraft.notes ?? expense?.notes ?? '',
    },
  });

  const selectedCategory = watch('category');
  const selectedSubcategory = watch('subcategory');
  const accountingClassification = watch('accountingClassification');
  const expenseType = watch('expenseType');
  const vendorId = watch('vendorId');
  // Currency follows the selected provider's country (international → USD).
  const selectedVendor = vendors.find((v) => v.id === vendorId);
  const currency: Currency = (selectedVendor ? isInternationalLocation(selectedVendor.location) : expense?.currency === 'USD') ? 'USD' : 'PHP';
  const amountLabel = currency === 'USD' ? 'Amount ($)' : 'Amount (₱)';
  const paymentMethod = watch('paymentMethod');
  const paymentDetailsRequired = isPaid && METHODS_REQUIRING_DETAILS.includes(paymentMethod);

  // Toggling Paid: sync RHF `paid`, then re-validate the payment fields so stale
  // errors clear when switched to unpaid and re-apply when switched back to paid.
  const handlePaidChange = (next: boolean) => {
    setIsPaid(next);
    setValue('paid', next, { shouldValidate: true });
    void trigger(['paymentMethod', 'paymentDetails']);
  };

  // ── Draft capture (new expenses only) ────────────────────────────────────────
  // Persist field changes to the service draft as the user types, so a
  // half-filled new service expense survives closing the modal or navigating away.
  useEffect(() => {
    if (!isNew) return;
    const sub = watch((values) => patchServiceDraft(values as ServiceDraft));
    return () => sub.unsubscribe();
  }, [isNew, watch, patchServiceDraft]);

  useEffect(() => {
    if (isNew) patchServiceDraft({ isPaid });
  }, [isNew, isPaid, patchServiceDraft]);

  const subcategoryOptions = subcategoriesFor(selectedCategory).map((s) => ({ value: s, label: s }));

  // Providers offering the selected category (+ subcategory when chosen). A
  // vendor matches when one of its supplies is that category, and — if a
  // subcategory is picked — that subcategory OR a supply with no subcategory.
  // The currently-selected provider is always kept in the list (so an edited
  // expense's provider never disappears), and "Enter manually…" is always shown.
  const norm = (s: string) => s.trim().toLowerCase();
  const providerVendors = (() => {
    if (!selectedCategory) return [];
    const matches = vendors.filter((v) =>
      (v.supplies ?? []).some((s) => {
        if (norm(s.category) !== norm(selectedCategory)) return false;
        if (!selectedSubcategory) return true;
        return norm(s.subcategory) === norm(selectedSubcategory) || s.subcategory.trim() === '';
      }),
    );
    // Always include the currently-selected vendor even if it doesn't (yet)
    // declare this supply — otherwise the controlled <select> would blank out.
    if (vendorId && vendorId !== MANUAL_ENTRY && !matches.some((v) => v.id === vendorId)) {
      const sel = vendors.find((v) => v.id === vendorId);
      if (sel) matches.push(sel);
    }
    return [...matches].sort((a, b) => a.vendor.localeCompare(b.vendor, undefined, { sensitivity: 'base' }));
  })();
  const noProviderMatches = !!selectedCategory && providerVendors.length === 0;

  // Prefill the bookkeeping classification/type from the chosen (category,
  // subcategory) when the field is still empty (never clobbers a manual choice
  // or an edited expense's saved value).
  useEffect(() => {
    if (!selectedCategory.trim()) return;
    const def = bookkeepingFor(selectedCategory, selectedSubcategory);
    if (def.accountingClassification && !accountingClassification.trim()) {
      setValue('accountingClassification', def.accountingClassification, { shouldDirty: false });
    }
    if (def.expenseType && !expenseType.trim()) {
      setValue('expenseType', def.expenseType, { shouldDirty: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, selectedSubcategory]);

  const handleVendorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setValue('vendorId', val === MANUAL_ENTRY ? MANUAL_ENTRY : val);
    if (val === MANUAL_ENTRY || val === '') {
      setValue('vendorName', '');
    } else {
      setValue('vendorName', vendors.find((v) => v.id === val)?.vendor ?? '');
    }
  };

  const onSubmit = (data: FormValues) => {
    if (isFutureDate(data.date)) {
      setPendingFutureData(data);
      return;
    }
    doSave(data);
  };

  const doSave = (data: FormValues) => {
    const category = data.category.trim();
    const subcategory = data.subcategory.trim();

    // Keep the taxonomy in step (idempotent) so a newly-typed category/subcategory
    // shows up in Settings + the dropdowns next time. Registering the category as
    // a SERVICE persists its "service-ness" so an edited expense reopens in the
    // Service form and the inventory/resell flow keeps skipping it.
    if (category) {
      addServiceCategory(category);
      addEntry(category, subcategory);
      syncTaxonomy(category, subcategory);
    }

    // Resolve an optional provider/vendor (manual entry → match or create).
    let resolvedVendorId = data.vendorId === MANUAL_ENTRY ? '' : data.vendorId;
    let resolvedVendorName = data.vendorName.trim();
    let newVendorCreated = false;
    if (data.vendorId === MANUAL_ENTRY && resolvedVendorName) {
      const existing = vendors.find((v) => v.vendor.trim().toLowerCase() === resolvedVendorName.toLowerCase());
      if (existing) {
        resolvedVendorId = existing.id;
        resolvedVendorName = existing.vendor;
      } else {
        const created = addVendor({ vendor: resolvedVendorName, contact: '', phone: '', supplies: [], notes: '' });
        resolvedVendorId = created.id;
        newVendorCreated = true;
      }
    }

    const payload = {
      date: data.date,
      vendorId: resolvedVendorId,
      vendorName: resolvedVendorName,
      category,
      subcategory,
      description: data.description,
      // Services carry no quantity/unit/price — amount is the whole cost.
      quantity: 0,
      unit: '',
      unitPrice: 0,
      amount: data.amount,
      // An unpaid (Pending) service carries no payment method/details — cleared
      // so stale inputs from toggling never persist.
      paymentMethod: isPaid ? data.paymentMethod : '',
      paymentDetails: isPaid ? data.paymentDetails : '',
      accountingClassification: data.accountingClassification,
      expenseType: data.expenseType,
      notes: data.notes,
      paid: isPaid,
      // Local provider → PHP; international provider → USD. Never mixed/converted.
      currency,
    };

    if (expense) {
      updateExpense(expense.id, payload);
      toast.success(toastSuccess(ENTITY.serviceExpense, 'updated'));
    } else {
      addExpense(payload);
      toast.success(toastSuccess(ENTITY.serviceExpense, 'created'));
    }
    if (newVendorCreated) {
      toast.success(`Added "${resolvedVendorName}" to your Vendors`, { duration: 4000 });
    }
    // Record the service against the provider's supplies for future suggestions.
    if (resolvedVendorId && category) addSupply(resolvedVendorId, category, subcategory);

    // Successful create → the in-progress draft is now saved; discard it.
    if (!expense) clearDraft();
    onClose();
  };

  const isManualVendor = vendorId === MANUAL_ENTRY;

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <InputField label={FIELD.date.label} type="date" required error={errors.date?.message} {...register('date')} />
          <CreatableSelect
            label={FIELD.category.label}
            required
            options={categoryOptions}
            placeholder="Select or add a service…"
            error={errors.category?.message}
            value={selectedCategory}
            onChange={(v) => {
              setValue('category', v, { shouldValidate: true, shouldDirty: true });
              // Reset dependent fields on a category change — including the
              // provider, since the list is scoped to the category.
              setValue('subcategory', '', { shouldDirty: true });
              setValue('vendorId', '', { shouldDirty: true });
              setValue('vendorName', '', { shouldDirty: true });
              setValue('accountingClassification', '');
              setValue('expenseType', '');
            }}
            onCreate={(v) => {
              // Persist the new category as a SERVICE and cascade it into both
              // taxonomies so it's selectable across the app next time.
              addServiceCategory(v);
              addEntry(v, '');
              syncTaxonomy(v, '');
              setValue('category', v, { shouldValidate: true, shouldDirty: true });
              setValue('subcategory', '', { shouldDirty: true });
              setValue('vendorId', '', { shouldDirty: true });
              setValue('vendorName', '', { shouldDirty: true });
              setValue('accountingClassification', '');
              setValue('expenseType', '');
              toast.success(`Added service category "${v}"`);
            }}
            createLabel="+ Add new service category…"
            newFieldLabel="New Service Category"
            newFieldPlaceholder="e.g. Consulting"
          />
        </div>

        {/* Similar / exact-duplicate hint for a just-typed category. */}
        <SimilarEntryHint
          value={selectedCategory}
          options={serviceCategoryNames}
          noun="category"
          onPick={(v) => {
            setValue('category', v, { shouldValidate: true, shouldDirty: true });
            setValue('subcategory', '', { shouldDirty: true });
          }}
        />

        {/* Subcategory — from the taxonomy for the chosen service category. */}
        {selectedCategory && (
          <div className="space-y-2">
            <CreatableSelect
              label={FIELD.subcategory.label}
              value={selectedSubcategory}
              options={subcategoryOptions}
              onChange={(v) => setValue('subcategory', v, { shouldDirty: true })}
              onCreate={(v) => {
                addEntry(selectedCategory, v);
                syncTaxonomy(selectedCategory, v);
                toast.success(`Added "${v}" to ${selectedCategory}`);
              }}
              placeholder={subcategoryOptions.length ? 'Select or add…' : 'Add a subcategory…'}
              createLabel="+ Add new subcategory…"
              newFieldLabel="New Subcategory"
              newFieldPlaceholder="e.g. Domestic"
            />
            <SimilarEntryHint
              value={selectedSubcategory ?? ''}
              options={subcategoriesFor(selectedCategory)}
              noun="subcategory"
              onPick={(v) => setValue('subcategory', v, { shouldDirty: true })}
            />
          </div>
        )}

        {/* Provider — filtered to vendors offering the selected category/subcategory */}
        <div>
          <label className="text-sm font-medium text-gray-700">
            Provider <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <select
            className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
            value={vendorId}
            onChange={handleVendorChange}
            disabled={!selectedCategory}
          >
            <option value="">None / not applicable</option>
            {providerVendors.map((v) => {
              const supplyLabel = (v.supplies ?? [])
                .map((s) => s.category)
                .filter((c, i, a) => a.indexOf(c) === i)
                .join(', ');
              return (
                <option key={v.id} value={v.id}>
                  {v.vendor}{supplyLabel ? ` — ${supplyLabel}` : ''}
                </option>
              );
            })}
            <option value={MANUAL_ENTRY}>Enter manually…</option>
          </select>
          {!selectedCategory ? (
            <p className="mt-1 text-xs text-gray-400">Pick a category first to see its providers.</p>
          ) : noProviderMatches ? (
            <p className="mt-1 text-xs text-gold-600">
              No provider offers "{selectedCategory}{selectedSubcategory ? ` – ${selectedSubcategory}` : ''}" yet — enter one manually to add them.
            </p>
          ) : null}
          {isManualVendor && (
            <div className="mt-2">
              <InputField
                label="Provider Name"
                autoFocus
                {...register('vendorName')}
                placeholder="Type provider name…"
              />
            </div>
          )}
        </div>

        <InputField
          label={amountLabel}
          required
          type="number"
          step="0.01"
          error={errors.amount?.message}
          {...register('amount')}
        />

        {/* Payment — the Paid toggle heads the block; its fields depend on it. */}
        <div>
          <CheckboxField
            label="Paid"
            checked={isPaid}
            onChange={handlePaidChange}
            hint={isPaid ? undefined : 'Leave unchecked to record as Pending payment (shows under Outstanding).'}
          />
          {isPaid ? (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SelectField
                label={FIELD.paymentMethod.label}
                required
                options={PAYMENT_OPTIONS}
                error={errors.paymentMethod?.message}
                {...register('paymentMethod')}
              />
              <InputField
                label={FIELD.paymentDetails.label}
                required={paymentDetailsRequired}
                error={errors.paymentDetails?.message}
                {...register('paymentDetails')}
                placeholder={paymentDetailsRequired ? 'e.g. BPI account / ref #' : 'Optional'}
                hint={paymentDetailsRequired ? 'Required for this payment method' : undefined}
              />
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-gold-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>Pending payment — this expense will show under Outstanding until it's marked paid.</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CreatableSelect
            label="Accounting Classification"
            value={accountingClassification}
            options={accountingOptions}
            onChange={(v) => setValue('accountingClassification', v)}
            onCreate={(v) => { addAccountingClassification(v); setValue('accountingClassification', v); }}
            placeholder="Optional — e.g. Operating Expense (OpEx)"
            createLabel="Add new classification…"
            newFieldLabel="New accounting classification"
          />
          <CreatableSelect
            label="Expense Type"
            value={expenseType}
            options={expenseTypeOptions}
            onChange={(v) => setValue('expenseType', v)}
            onCreate={(v) => { addExpenseType(v); setValue('expenseType', v); }}
            placeholder="Optional — e.g. Fixed"
            createLabel="Add new expense type…"
            newFieldLabel="New expense type"
          />
        </div>

        <InputField label="Description" {...register('description')} placeholder="Optional — brief note on the service" />
        <TextareaField label={FIELD.notes.label} {...register('notes')} rows={2} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>
            {expense ? 'Save Changes' : 'Add Expense'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={!!pendingFutureData}
        onClose={() => setPendingFutureData(null)}
        onConfirm={() => {
          if (pendingFutureData) doSave(pendingFutureData);
          setPendingFutureData(null);
        }}
        title="Future-dated expense"
        message={`This expense is dated ${pendingFutureData ? formatDate(pendingFutureData.date) : ''}, which is in the future. Record it as a future expense?`}
        confirmLabel="Yes, record it"
      />
    </>
  );
}
