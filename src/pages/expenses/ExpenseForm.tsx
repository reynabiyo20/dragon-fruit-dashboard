import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { Expense, ExpenseItem, Vendor, VendorSupply, Currency } from '../../types';
import { useExpenseStore } from '../../store/expenseStore';
import { useVendorStore } from '../../store/vendorStore';
import { useVendorProductStore } from '../../store/vendorProductStore';
import { useProductStore } from '../../store/productStore';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import { useEntityMatch } from '../../hooks/useEntityMatch';
import { EntityMatchSuggestions } from '../../components/forms/EntityMatchSuggestions';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import { InputField, SelectField, TextareaField, CheckboxField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { VendorSuppliesField } from '../../components/forms/VendorSuppliesField';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { formatPHP, formatUSD, formatDate, categoryLabel } from '../../utils/format';
import { isInternationalLocation } from '../../constants/geography';
import { isFutureDate, todayISO } from '../../utils/date';
import { useUnitStore, useAccountingClassificationStore, useExpenseTypeStore } from '../../store/optionStores';
import { PAYMENT_OPTIONS, METHODS_REQUIRING_DETAILS, MANUAL_ENTRY, INVENTORY_LINKED_TYPES, CUTTINGS_PRODUCT_TYPE, FRUIT_PRODUCT_TYPE, CUTTING_TYPE_OPTIONS, CUTTING_TYPE_GRAFTED, isServiceCategory } from '../../constants';
import type { CuttingPurchaseState } from '../../types';
import { AlertCircle } from 'lucide-react';
import { ENTITY, toastSuccess, VALIDATION, FIELD } from '../../constants/messages';
import { syncTaxonomy } from '../../store/taxonomySync';
import { unlinkResellProduct } from '../../store/productLink';
import { useExpenseDraftStore, type ProductDraft } from '../../store/expenseDraftStore';

/** Categories whose purchases always cascade into the sellable Products list. */
const ALWAYS_RESELL_CATEGORIES = INVENTORY_LINKED_TYPES as readonly string[];
import { ProductItemsPicker } from './ProductItemsPicker';
import { ServiceExpenseForm } from './ServiceExpenseForm';

type ExpenseMode = 'single' | 'itemized';
/** Top-level Add Expense choice: a physical product/material vs a service. */
type ExpenseKind = 'product' | 'service';

/**
 * Categories where a formal vendor is NOT required — services, utilities, and
 * miscellaneous spend. The provider (if any) is captured by the subcategory
 * (e.g. Delivery → LBC) or the description.
 */
const OPTIONAL_VENDOR_CATEGORIES = [
  'Delivery',
  'Utilities', // Electricity / Water / Internet — provider captured by subcategory
  'Gas',
  'Air Fare',
  'Operational Transportation',
  'Meals',
  'Other',
];

/**
 * Categories whose purchases must specify a variety (subcategory): Cuttings and
 * Fruit are always bought as a specific variety and map 1:1 onto inventory/
 * product rows, so a bare category with no subcategory is never valid.
 */
const SUBCATEGORY_REQUIRED_CATEGORIES = [CUTTINGS_PRODUCT_TYPE, FRUIT_PRODUCT_TYPE] as const;

/** Delivery uses From / To / Price instead of Quantity / Unit Price */
const DELIVERY_CATEGORY = 'Delivery';

/**
 * Air Fare has no vendor (it's a travel cost, not a supplier purchase). It
 * captures an optional From / To route and optional Quantity / Price, but the
 * total Amount is always required.
 */
const AIR_FARE_CATEGORY = 'Air Fare';

const schema = z
  .object({
    // Single-line vs itemized. Category/amount/vendor validation below is
    // enforced only in single mode; itemized mode validates its own line items.
    mode: z.enum(['single', 'itemized']),
    date: z.string().min(1, VALIDATION.dateRequired),
    vendorId: z.string(),
    vendorName: z.string(),
    category: z.string(),
    subcategory: z.string(),
    quantity: z.coerce.number().min(0),
    unit: z.string(),
    unitPrice: z.coerce.number().min(0),
    deliveryFrom: z.string(),
    deliveryTo: z.string(),
    amount: z.coerce.number().min(0),
    description: z.string(),
    // Payment method/details are only required when the expense is PAID — an
    // unpaid (Pending) expense flows to Outstanding without a method.
    paymentMethod: z.string(),
    paymentDetails: z.string(),
    paid: z.boolean(),
    accountingClassification: z.string(),
    expenseType: z.string(),
    notes: z.string(),
  })
  .superRefine((d, ctx) => {
    // Payment validation applies to BOTH modes and is gated on `paid`:
    //  1. A paid expense must have a payment method.
    //  2. Certain methods (Bank Transfer, Gcash, Zelle, Check) also require
    //     payment details — but only when paid.
    if (d.paid) {
      if (d.paymentMethod.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentMethod'], message: VALIDATION.paymentMethodRequired });
      }
      if (METHODS_REQUIRING_DETAILS.includes(d.paymentMethod) && d.paymentDetails.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentDetails'], message: 'Payment details are required for this payment method' });
      }
    }

    if (d.mode === 'itemized') return; // itemized validates line items separately
    if (d.category.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: VALIDATION.categoryRequired });
    }
    // Cuttings and Fruit purchases are always tied to a specific variety, so a
    // subcategory (the variety) is mandatory for these categories — they map 1:1
    // onto inventory/product rows and can't be recorded against the bare category.
    if (SUBCATEGORY_REQUIRED_CATEGORIES.some((c) => c.toLowerCase() === d.category.trim().toLowerCase())
      && d.subcategory.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subcategory'], message: VALIDATION.subcategoryRequired });
    }
    // The effective amount is derived from Quantity × Price when both are set
    // (the quantifiable path, where Amount is read-only), otherwise the amount
    // typed directly (service / delivery / air-fare). Validate the effective
    // value so the read-only quantifiable Amount never triggers a spurious error.
    const qty = Number(d.quantity) || 0;
    const price = Number(d.unitPrice) || 0;
    // When the user has started a quantifiable line (entered a quantity OR a
    // price) point the error at the missing input rather than the derived amount.
    if (qty > 0 && price <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unitPrice'], message: VALIDATION.priceRequired });
    } else if (price > 0 && qty <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: VALIDATION.quantityRequired });
    } else {
      const effectiveAmount = qty > 0 && price > 0 ? qty * price : Number(d.amount) || 0;
      if (effectiveAmount < 0.01) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: VALIDATION.amountPositive });
      }
    }
    // Vendor required only for categories that aren't in the optional list
    if (!OPTIONAL_VENDOR_CATEGORIES.includes(d.category) && d.vendorName.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vendorName'], message: VALIDATION.vendorRequired });
    }
  });

type FormValues = z.infer<typeof schema>;

/**
 * Delivery / Air Fare expenses fold their route into the description as
 * "From <a> to <b>" (see the description-assembly block in doSubmit). Parse that
 * back out so editing pre-fills the From / To fields the user originally entered.
 */
function parseDeliveryRoute(description: string): { from: string; to: string } {
  const match = /From\s+(.+?)\s+to\s+(.+?)(?:\)|,|$)/i.exec(description ?? '');
  if (!match) return { from: '', to: '' };
  const from = match[1] === '?' ? '' : match[1].trim();
  const to = match[2] === '?' ? '' : match[2].trim();
  return { from, to };
}

interface ExpenseFormProps {
  expense: Expense | null;
  onClose: () => void;
}

export function ExpenseForm({ expense, onClose }: ExpenseFormProps) {
  // ── In-progress draft (new expenses only) ────────────────────────────────────
  // Only NEW expenses are drafted; editing works off the saved record. We read
  // the persisted draft ONCE at mount (via a ref-stable snapshot) so its values
  // seed the useState / RHF initializers below — restoring through initializers
  // (not post-mount setValue) keeps the category/vendor "reset" effects from
  // treating a restore as a user edit and wiping dependent fields.
  const draftStore = useExpenseDraftStore;
  const isNew = !expense;
  const draftSnapshot = useRef(isNew ? draftStore.getState() : null);
  const productDraft = draftSnapshot.current?.product ?? {};
  const patchProductDraft = useExpenseDraftStore((s) => s.patchProduct);
  const setDraftKind = useExpenseDraftStore((s) => s.setKind);
  const clearDraft = useExpenseDraftStore((s) => s.clear);

  const { addExpense, updateExpense, latestUnitPrice } = useExpenseStore();
  const { vendors, addVendor, addSupply } = useVendorStore();
  const { categories, subcategoriesFor, addEntry, isQuantifiable, bookkeepingFor } = useExpenseCategoryStore();
  // Vendor-product catalog — used to persist a new/edited itemized line's unit +
  // default price so a product not yet in the catalog is saved for next time.
  const addVendorProduct = useVendorProductStore((s) => s.addProduct);
  const linkVendorPrice = useVendorProductStore((s) => s.linkVendorPrice);
  const updateVendorProduct = useVendorProductStore((s) => s.updateProduct);
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addUnit = useUnitStore((s) => s.add);
  const acOptions = useAccountingClassificationStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addAccountingClassification = useAccountingClassificationStore((s) => s.add);
  const expenseTypeOptions = useExpenseTypeStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addExpenseType = useExpenseTypeStore((s) => s.add);
  const upsertSellableProduct = useProductStore((s) => s.upsertFromPurchase);
  const findSellableProduct = useProductStore((s) => s.findByCategorySub);
  // Full product list — used to constrain the single-expense subcategory dropdown
  // to real product varieties when the category is also a product type.
  const productList = useProductStore((s) => s.products);
  const [isPaid, setIsPaid] = useState(productDraft.isPaid ?? expense?.paid ?? false);
  // "We resell this" — cascades a quantifiable purchase into the sellable Products
  // list. Defaults on when editing an expense whose product already exists there.
  const [isResell, setIsResell] = useState(
    productDraft.isResell ?? (!!expense && !!findSellableProduct(expense.category, expense.subcategory)),
  );
  // Cuttings only: what the purchased cuttings are for. Defaults to 'packed'.
  //  - 'packed'/'bare' → sellable inventory pool (Ready for Sale / Needs Packing)
  //  - 'replant'       → creates a Propagation batch (For Replant lifecycle)
  const [cuttingState, setCuttingState] = useState<CuttingPurchaseState>(
    productDraft.cuttingState ?? expense?.cuttingState ?? 'packed',
  );
  // Cuttings + replant only: the cutting type of the purchased cuttings, so the
  // Propagation batch tracks the right rooting/ready timeline.
  const [cuttingType, setCuttingType] = useState<string>(
    productDraft.cuttingType ?? expense?.cuttingType ?? CUTTING_TYPE_GRAFTED,
  );
  // Holds validated form data pending a future-date confirmation (null = none)
  const [pendingFutureData, setPendingFutureData] = useState<FormValues | null>(null);

  // Itemized (multi-item, product-based) vs single (category/service) mode.
  const hasExistingItems = !!expense?.items && expense.items.length > 0;
  // Top-level Product vs Service. On edit, a single-line expense whose category
  // is a service category reopens in the Service form; everything else is a
  // Product. A new expense restores the last-open kind from the draft, else
  // defaults to Product.
  const [kind, setKind] = useState<ExpenseKind>(
    expense
      ? (!hasExistingItems && isServiceCategory(expense.category) ? 'service' : 'product')
      : (draftSnapshot.current?.kind ?? 'product'),
  );
  const [mode, setMode] = useState<ExpenseMode>(
    hasExistingItems ? 'itemized' : (productDraft.mode ?? 'single'),
  );
  const [items, setItems] = useState<ExpenseItem[]>(productDraft.items ?? expense?.items ?? []);
  const [itemsError, setItemsError] = useState('');

  // Product mode lists only NON-service categories — services are recorded via
  // the Service form (the Product/Service chooser above).
  const categoryOptions = categories()
    .filter((c) => !isServiceCategory(c))
    .map((c) => ({ value: c, label: c }));

  const { register, handleSubmit, setValue, watch, getValues, trigger, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    // Restore any in-progress draft first (new expenses only), then fall back to
    // the edited record's values, then to blank/today defaults.
    defaultValues: {
      mode: hasExistingItems ? 'itemized' : (productDraft.mode ?? 'single'),
      date: productDraft.date ?? expense?.date ?? todayISO(),
      vendorId: productDraft.vendorId ?? expense?.vendorId ?? '',
      vendorName: productDraft.vendorName ?? expense?.vendorName ?? '',
      // Top-level category (the combined "Cat – Sub" label is derived at display time).
      category: productDraft.category ?? expense?.category ?? '',
      subcategory: productDraft.subcategory ?? expense?.subcategory ?? '',
      quantity: productDraft.quantity ?? expense?.quantity ?? 0,
      unit: productDraft.unit ?? expense?.unit ?? '',
      unitPrice: productDraft.unitPrice ?? expense?.unitPrice ?? 0,
      // Recover the delivery/air-fare route from the saved description on edit
      deliveryFrom: productDraft.deliveryFrom ?? parseDeliveryRoute(expense?.description ?? '').from,
      deliveryTo: productDraft.deliveryTo ?? parseDeliveryRoute(expense?.description ?? '').to,
      amount: productDraft.amount ?? expense?.amount ?? 0,
      description: productDraft.description ?? expense?.description ?? '',
      paymentMethod: productDraft.paymentMethod ?? expense?.paymentMethod ?? 'Cash',
      paymentDetails: productDraft.paymentDetails ?? expense?.paymentDetails ?? '',
      paid: productDraft.paid ?? expense?.paid ?? false,
      accountingClassification: productDraft.accountingClassification ?? expense?.accountingClassification ?? '',
      expenseType: productDraft.expenseType ?? expense?.expenseType ?? '',
      notes: productDraft.notes ?? expense?.notes ?? '',
    },
  });

  // Keep the RHF `mode` field in sync so the resolver validates the right path
  useEffect(() => {
    setValue('mode', mode);
    setItemsError('');
  }, [mode, setValue]);

  // ── Draft capture (new expenses only) ────────────────────────────────────────
  // Persist RHF field changes to the draft store as the user types, so a
  // half-filled new expense survives closing the modal or navigating away.
  useEffect(() => {
    if (!isNew) return;
    const sub = watch((values) => patchProductDraft(values as ProductDraft));
    return () => sub.unsubscribe();
  }, [isNew, watch, patchProductDraft]);

  // Remember which top-level form (Product vs Service) is open.
  useEffect(() => {
    if (isNew) setDraftKind(kind);
  }, [isNew, kind, setDraftKind]);

  const selectedCategory = watch('category');
  const selectedSubcategory = watch('subcategory');
  const accountingClassification = watch('accountingClassification');
  const expenseType = watch('expenseType');
  const quantity = Number(watch('quantity')) || 0;
  const unitPrice = Number(watch('unitPrice')) || 0;
  const vendorId = watch('vendorId');
  const vendorName = watch('vendorName');
  const paymentMethod = watch('paymentMethod');
  // Payment details are required only when PAID and the method needs a reference.
  const paymentDetailsRequired = isPaid && METHODS_REQUIRING_DETAILS.includes(paymentMethod);

  // ── Currency (international support) ─────────────────────────────────────────
  // A purchase from an international vendor is recorded in USD; local vendors in
  // PHP. The currency follows the selected vendor's country. When editing, fall
  // back to the saved expense currency (for a manual vendor with no record).
  const selectedVendor = vendors.find((v) => v.id === vendorId);
  const isInternational = selectedVendor
    ? isInternationalLocation(selectedVendor.location)
    : expense?.currency === 'USD';
  const currency: Currency = isInternational ? 'USD' : 'PHP';
  const money = (amount: number) => (currency === 'USD' ? formatUSD(amount) : formatPHP(amount));
  const priceUnitLabel = currency === 'USD' ? 'Price / Unit ($)' : 'Price / Unit (₱)';
  const amountLabel = currency === 'USD' ? 'Amount ($)' : 'Amount (₱)';

  // Toggling Paid: sync the RHF `paid` field so the resolver knows whether a
  // payment method is required, and re-validate the payment fields so stale
  // "payment method required" errors clear when switched to unpaid (Pending),
  // and re-apply when switched back to paid.
  const handlePaidChange = (next: boolean) => {
    setIsPaid(next);
    setValue('paid', next, { shouldValidate: true });
    void trigger(['paymentMethod', 'paymentDetails']);
  };

  const isDelivery = selectedCategory === DELIVERY_CATEGORY;
  const isAirFare = selectedCategory === AIR_FARE_CATEGORY;
  const isCuttingCategory = selectedCategory.trim().toLowerCase() === CUTTINGS_PRODUCT_TYPE.toLowerCase();
  // Show Qty + Unit Price (which drives the Inventory cascade) whenever the
  // purchase is for a SPECIFIC product — i.e. a subcategory is selected — or the
  // category is a quantifiable material / inventory-linked product type. A
  // subcategorized purchase is a specific item that must be accounted for as
  // stock, regardless of the category's quantifiable flag.
  const isInventoryLinkedCategory =
    ALWAYS_RESELL_CATEGORIES.includes(selectedCategory.trim());
  const hasSpecificProduct = !!selectedSubcategory.trim();
  const showQtyPrice =
    !isDelivery &&
    !isAirFare &&
    (isQuantifiable(selectedCategory) || isInventoryLinkedCategory || hasSpecificProduct);
  const vendorOptional = OPTIONAL_VENDOR_CATEGORIES.includes(selectedCategory);
  // Subcategories from the expense taxonomy, but when the selected category is
  // ALSO a product type (exists in the product store), restrict the list to the
  // varieties that are real products — so you can only expense a variety you
  // actually carry. Non-product categories (Gas, Utilities, …) keep their full
  // taxonomy subcategory list.
  const taxonomySubcategories = subcategoriesFor(selectedCategory);
  const existingSubcategories = (() => {
    const norm = (s: string) => s.trim().toLowerCase();
    const cat = norm(selectedCategory);
    const productSubs = productList
      .filter((p) => norm(p.category) === cat && p.subcategory.trim() !== '')
      .map((p) => p.subcategory);
    // Category isn't a product type → keep the taxonomy list unchanged.
    if (productSubs.length === 0) return taxonomySubcategories;
    // Product type → show exactly the varieties that exist in the product store
    // (deduped, sorted), so you can only expense a variety you actually carry.
    return [...new Set(productSubs)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  })();
  const subcategoryOptions = existingSubcategories.map((s) => ({ value: s, label: s }));
  // Cuttings / Fruit purchases must name a variety, so the subcategory is
  // mandatory for those categories (mirrors the schema's superRefine check).
  const subcategoryRequired = SUBCATEGORY_REQUIRED_CATEGORIES.some(
    (c) => c.toLowerCase() === selectedCategory.trim().toLowerCase(),
  );
  const allCategories = categories();

  // ── Single-mode: vendor-first flow ───────────────────────────────────────────
  // In single mode the Vendor is chosen FIRST (next to the Date), so its dropdown
  // lists every vendor rather than being scoped by a not-yet-chosen category.
  const singleVendorList = [...vendors].sort((a, b) =>
    a.vendor.localeCompare(b.vendor, undefined, { sensitivity: 'base' }),
  );
  // Categories the currently-selected vendor supplies (distinct, non-service).
  // Drives the Category dropdown so it only offers what this vendor actually
  // provides. With no real vendor selected (empty or manual entry) we fall back
  // to every non-service category so the flow still works before/without a vendor.
  const vendorSupplyCategories = (() => {
    if (!selectedVendor) return null; // null → use the full category list
    const cats = (selectedVendor.supplies ?? [])
      .map((s) => s.category)
      .filter((c) => c.trim() !== '' && !isServiceCategory(c));
    return [...new Set(cats)].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  })();
  // Category dropdown options for single mode: scoped to the selected vendor's
  // supplies when a real vendor is chosen, otherwise all non-service categories.
  // Always include the currently-selected category so a controlled value that
  // isn't in the vendor's supplies (e.g. on edit) still renders.
  const singleCategoryOptions = (() => {
    if (!vendorSupplyCategories) return categoryOptions;
    const scoped = [...vendorSupplyCategories];
    if (selectedCategory && !scoped.includes(selectedCategory)) scoped.push(selectedCategory);
    return scoped.map((c) => ({ value: c, label: c }));
  })();

  // ── Manual vendor entry matching (recommend, don't enforce) ─────────────────
  const isManualVendor = vendorId === MANUAL_ENTRY;
  // Supplies the user assigns to a NEW vendor being created inline. Persisted to
  // the vendor on save and cascaded into the taxonomy by VendorSuppliesField.
  const [newVendorSupplies, setNewVendorSupplies] = useState<VendorSupply[]>(productDraft.newVendorSupplies ?? []);

  // Persist the non-RHF pieces of the draft (toggles, itemized lines, inline
  // vendor supplies) whenever any of them change (new expenses only).
  useEffect(() => {
    if (!isNew) return;
    patchProductDraft({ isPaid, isResell, cuttingState, cuttingType, mode, items, newVendorSupplies });
  }, [isNew, isPaid, isResell, cuttingState, cuttingType, mode, items, newVendorSupplies, patchProductDraft]);

  const { matches: vendorMatches, exact: exactVendorMatch } = useEntityMatch(
    vendorName, vendors, (v) => v.vendor, isManualVendor
  );

  const useExistingVendor = (v: Vendor) => {
    setValue('vendorId', v.id);
    setValue('vendorName', v.vendor);
  };

  /**
   * Explicitly save a manually-typed vendor to the Vendors store and select it.
   * Reuses an existing vendor when the name already exists (case-insensitive).
   * Selecting a real vendorId enables the product picker for itemized purchases.
   */
  const saveManualVendor = () => {
    const name = (vendorName ?? '').trim();
    if (!name) {
      toast.error('Enter a vendor name first');
      return;
    }
    const existing = vendors.find((v) => v.vendor.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      setValue('vendorId', existing.id);
      setValue('vendorName', existing.vendor);
      toast.success(`Selected existing vendor "${existing.vendor}"`);
      return;
    }
    const created = addVendor({ vendor: name, contact: '', phone: '', supplies: newVendorSupplies, notes: '' });
    setValue('vendorId', created.id);
    setValue('vendorName', created.vendor);
    setNewVendorSupplies([]);
    toast.success(`Added "${created.vendor}" to your Vendors`, { duration: 4000 });
  };

  // Reset dependent fields when the user CHANGES the category. We track the
  // previously-seen category value (seeded from the record being edited) and only
  // clear dependent fields on a genuine change. Comparing against the previous
  // value — rather than a one-shot "skip first render" flag — keeps an edited
  // expense's saved subcategory/vendor/qty/price intact even when the effect runs
  // more than once on mount (e.g. React StrictMode double-invokes effects in dev).
  const prevCategory = useRef(expense?.category || '');
  useEffect(() => {
    if (selectedCategory === prevCategory.current) return;
    prevCategory.current = selectedCategory;
    // Vendor is chosen first (vendor-first flow) and drives the category list, so
    // changing the category must NOT clear the selected vendor — only the fields
    // that hang off the category.
    setValue('subcategory', '');
    setValue('quantity', 0);
    setValue('unit', '');
    setValue('unitPrice', 0);
    setValue('deliveryFrom', '');
    setValue('deliveryTo', '');
    // Clear the bookkeeping fields so the prefill effect can repopulate them from
    // the newly-selected category's taxonomy default (see the prefill effect).
    setValue('accountingClassification', '');
    setValue('expenseType', '');
  }, [selectedCategory, setValue]);

  // Vendor-first flow: when the user CHANGES the vendor, drop a selected category
  // that the new vendor doesn't supply (its options would no longer list it), so
  // the Category field never shows a value outside the vendor's scope. Tracks the
  // previous vendor id so an edited expense's saved category survives mount.
  const prevVendorId = useRef(expense?.vendorId ?? '');
  useEffect(() => {
    if (vendorId === prevVendorId.current) return;
    prevVendorId.current = vendorId;
    // Only meaningful for a real vendor with a category already chosen.
    if (!vendorId || vendorId === MANUAL_ENTRY || !selectedCategory) return;
    const supplied = (selectedVendor?.supplies ?? []).some(
      (s) => s.category === selectedCategory,
    );
    if (!supplied) {
      setValue('category', '', { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  // Auto-calculate amount from quantity × unit price (quantifiable + air fare)
  useEffect(() => {
    if ((showQtyPrice || isAirFare) && quantity > 0 && unitPrice > 0) {
      setValue('amount', quantity * unitPrice);
    }
  }, [quantity, unitPrice, showQtyPrice, isAirFare, setValue]);

  // ── Prefill bookkeeping from the category taxonomy ───────────────────────────
  // When the chosen (category, subcategory) has a bookkeeping default (synced from
  // the "Expense Categories" sheet), fill the Accounting Classification / Expense
  // Type — but only when the field is still empty, so we never clobber a value the
  // user set or an edited expense's saved value. Both remain freely editable.
  useEffect(() => {
    if (!selectedCategory.trim()) return;
    const def = bookkeepingFor(selectedCategory, selectedSubcategory);
    // Read the LIVE form values (not the watched closure, which can be stale on
    // the same render the category-reset just cleared them) so a category with
    // no top-level default — e.g. Root Stock, whose default lives on its
    // "base/ full" subcategory — still prefills instead of saving blank.
    if (def.accountingClassification && !getValues('accountingClassification').trim()) {
      setValue('accountingClassification', def.accountingClassification, { shouldDirty: false });
    }
    if (def.expenseType && !getValues('expenseType').trim()) {
      setValue('expenseType', def.expenseType, { shouldDirty: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, selectedSubcategory]);

  // ── Prefill bookkeeping for ITEMIZED purchases ───────────────────────────────
  // Itemized expenses have no form-level category (it lives on the line items),
  // so the effect above never fires. Derive the classification/type from the
  // FIRST line's (category, subcategory) taxonomy default and fill the fields
  // while empty, so a saved itemized purchase carries its bookkeeping (and shows
  // it in the table) instead of blank "—". Still user-editable.
  const primaryItemKey = items.length > 0 ? `${items[0].category}||${items[0].subcategory}` : '';
  useEffect(() => {
    if (mode !== 'itemized') return;
    const primary = items[0];
    if (!primary || !primary.category.trim()) return;
    const def = bookkeepingFor(primary.category, primary.subcategory ?? '');
    if (def.accountingClassification && !getValues('accountingClassification').trim()) {
      setValue('accountingClassification', def.accountingClassification, { shouldDirty: false });
    }
    if (def.expenseType && !getValues('expenseType').trim()) {
      setValue('expenseType', def.expenseType, { shouldDirty: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, primaryItemKey]);

  // ── Prefill unit price from the latest matching expense ──────────────────────
  // When adding a new quantifiable expense and the user picks a supply
  // (category + subcategory), default the unit + cost. Source of truth is the
  // Product store (in sync with Settings): its `unit` and `costPHP` are used
  // first, falling back to the last matching expense price when the product has
  // no cost yet. All values remain editable.
  const [prefilledPrice, setPrefilledPrice] = useState<number | undefined>();
  useEffect(() => {
    if (expense) return;              // don't prefill when editing
    if (!showQtyPrice) return;
    if (!selectedSubcategory) return; // need a specific supply to look up

    // 1) Default the unit from the matching product (source of truth).
    const product = findSellableProduct(selectedCategory, selectedSubcategory);
    if (product?.unit) {
      setValue('unit', product.unit, { shouldValidate: true });
    }

    // 2) Default the price: prefer the product's cost, else the last price paid.
    const vId = vendorId && vendorId !== MANUAL_ENTRY ? vendorId : undefined;
    const last = latestUnitPrice(selectedCategory, selectedSubcategory, vId);
    const productCost = product && product.costPHP > 0 ? product.costPHP : undefined;
    const defaultPrice = productCost ?? last;
    if (defaultPrice !== undefined) {
      setValue('unitPrice', defaultPrice);
      setPrefilledPrice(defaultPrice);
    } else {
      setPrefilledPrice(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, selectedSubcategory, vendorId, showQtyPrice]);

  const handleVendorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const nextVendorId = val === MANUAL_ENTRY ? MANUAL_ENTRY : val;
    // Itemized products are scoped to the selected vendor, so switching to a
    // different vendor clears the previously-picked line items (they belonged to
    // the old vendor). Only clears on a genuine change, and only in itemized mode.
    if (mode === 'itemized' && nextVendorId !== vendorId && items.length > 0) {
      setItems([]);
      setItemsError('');
      toast('Cleared selected products — they belonged to the previous vendor.', { icon: '🧹', duration: 3000 });
    }
    setValue('vendorId', nextVendorId);
    if (val === MANUAL_ENTRY || val === '') {
      setValue('vendorName', '');
    } else {
      const vendor = vendors.find((v) => v.id === val);
      setValue('vendorName', vendor?.vendor ?? '');
    }
  };

  // ── Itemized (multi-item) submit ─────────────────────────────────────────────
  const submitItemized = (data: FormValues) => {
    // Resolve vendor (itemized purchases always come from a vendor)
    let resolvedVendorId = data.vendorId === MANUAL_ENTRY ? '' : data.vendorId;
    let resolvedVendorName = data.vendorName.trim();
    let newVendorCreated = false;

    if (data.vendorId === MANUAL_ENTRY && resolvedVendorName) {
      const nameKey = resolvedVendorName.toLowerCase();
      const existing = vendors.find((v) => v.vendor.trim().toLowerCase() === nameKey);
      if (existing) {
        resolvedVendorId = existing.id;
        resolvedVendorName = existing.vendor;
      } else {
        const created = addVendor({ vendor: resolvedVendorName, contact: '', phone: '', supplies: newVendorSupplies, notes: '' });
        resolvedVendorId = created.id;
        newVendorCreated = true;
      }
    }

    if (!resolvedVendorName || !resolvedVendorId) {
      toast.error('Select or enter a vendor for an itemized purchase');
      return;
    }
    if (items.length === 0) {
      setItemsError('Add at least one item, or switch to a single expense');
      return;
    }

    // Sanitize the line items (recompute totals; drop empty rows defensively)
    const cleanItems: ExpenseItem[] = items
      .filter((it) => it.name.trim().length > 0)
      .map((it) => ({
        ...it,
        quantity: Number(it.quantity) || 0,
        unitPrice: Number(it.unitPrice) || 0,
        total: (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
      }));

    if (cleanItems.length === 0) {
      setItemsError('Add at least one item');
      return;
    }

    // Quantity, unit and price are required on every line before saving.
    const incomplete = cleanItems.find(
      (it) => it.quantity <= 0 || !it.unit.trim() || it.unitPrice <= 0,
    );
    if (incomplete) {
      setItemsError(
        `Set quantity, unit and price for every item (check "${incomplete.name}").`,
      );
      return;
    }

    const amount = cleanItems.reduce((sum, it) => sum + it.total, 0);

    // Description defaults to a compact summary of the items when left blank
    const summary = cleanItems
      .map((it) => (it.quantity ? `${it.quantity}${it.unit ? ` ${it.unit}` : ''} ${it.name}` : it.name))
      .join(', ');
    const description = data.description.trim() || summary;

    // Primary category label = first item's category (display convenience)
    const primary = cleanItems[0];

    // Save-time safety net: if the classification/type weren't set (e.g. the
    // prefill effect hadn't committed before a fast submit), fall back to the
    // primary item's taxonomy default so the saved expense — and the table —
    // always carries its bookkeeping.
    const primaryDefault = bookkeepingFor(primary.category, primary.subcategory ?? '');
    const accountingClassification = data.accountingClassification.trim() || primaryDefault.accountingClassification;
    const expenseType = data.expenseType.trim() || primaryDefault.expenseType;

    const payload = {
      date: data.date,
      vendorId: resolvedVendorId,
      vendorName: resolvedVendorName,
      category: primary.category,
      subcategory: primary.subcategory,
      description,
      quantity: 0,
      unit: '',
      unitPrice: 0,
      items: cleanItems,
      amount,
      // An unpaid (Pending) expense carries no payment method/details — cleared
      // so stale inputs from toggling never persist.
      paymentMethod: isPaid ? data.paymentMethod : '',
      paymentDetails: isPaid ? data.paymentDetails : '',
      accountingClassification,
      expenseType,
      notes: data.notes,
      paid: isPaid,
      // Local vendor → PHP; international vendor → USD. Never mixed/converted.
      currency,
    };

    if (expense) {
      updateExpense(expense.id, payload);
      toast.success(toastSuccess(ENTITY.expense, 'updated'));
    } else {
      addExpense(payload);
      toast.success(toastSuccess(ENTITY.expense, 'created'));
    }
    if (newVendorCreated) {
      toast.success(`Added "${resolvedVendorName}" to your Vendors`, { duration: 4000 });
    }

    // ── Cascade purchased items into the vendor's supplies list ─────────────────
    // Every distinct category/subcategory in this purchase is recorded against the
    // vendor so it appears on the Vendors page (no-op if already present).
    const seen = new Set<string>();
    cleanItems.forEach((it) => {
      const key = `${it.category}||${it.subcategory}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (it.category) addSupply(resolvedVendorId, it.category, it.subcategory);

      // ── Persist the line to the vendor-product catalog ──────────────────────
      // Ensure a catalog product exists for this line and save its unit + this
      // vendor's default price, so a product NOT already in the catalog is
      // captured (and an existing one's price is refreshed) for next time. Also
      // register the (category, subcategory) in the managed taxonomy.
      if (it.category && it.subcategory.trim()) {
        const product = addVendorProduct({
          name: it.name || it.subcategory || it.category,
          category: it.category,
          subcategory: it.subcategory,
          unit: it.unit,
        });
        // Backfill the catalog unit if this line has one and the product didn't.
        if (it.unit.trim() && !product.unit) {
          updateVendorProduct(product.id, { unit: it.unit });
        }
        // Save this vendor's default price from the line (editable next time).
        if (it.unitPrice > 0) {
          linkVendorPrice(resolvedVendorId, product.id, it.unitPrice);
        }
        // Keep the expense/product taxonomies in step with the purchased line.
        addEntry(it.category, it.subcategory);
        syncTaxonomy(it.category, it.subcategory);
      }

      // Cascade into the sellable Products list when the line is flagged resell,
      // OR when its category is always-resell (Cuttings / Fruit / Fertilizer).
      // Cost is seeded from this line; selling price is left for the user.
      const shouldResell = it.resell || ALWAYS_RESELL_CATEGORIES.includes(it.category);
      if (shouldResell && it.subcategory.trim()) {
        const existingProduct = findSellableProduct(it.category, it.subcategory);
        const wasNew = !existingProduct;
        const learnedCost = it.unitPrice > 0 && (wasNew || existingProduct.costPHP === 0);
        upsertSellableProduct({
          category: it.category,
          subcategory: it.subcategory,
          unit: it.unit,
          costPHP: it.unitPrice,
        });
        const label = categoryLabel(it.category, it.subcategory);
        if (wasNew) {
          toast.success(`"${label}" added to Products for sale`);
        } else if (learnedCost) {
          toast.success(`Saved default cost ${formatPHP(it.unitPrice)} for "${label}"`, { duration: 4000 });
        }
      } else if (!ALWAYS_RESELL_CATEGORIES.includes(it.category) && it.subcategory.trim()) {
        // Line no longer flagged resell (e.g. unchecked on edit) → remove the
        // auto-created product if safe. Inventory is left untouched.
        const label = categoryLabel(it.category, it.subcategory);
        const result = unlinkResellProduct(it.category, it.subcategory);
        if (result === 'removed') {
          toast(`Removed "${label}" from Products for sale (kept in Inventory)`, { icon: '↩️', duration: 4000 });
        } else if (result === 'kept-priced' || result === 'kept-sold') {
          toast(`"${label}" stays in Products — it has ${result === 'kept-sold' ? 'sales history' : 'a selling price set'}`, { icon: '⚠️', duration: 5000 });
        }
      }
    });

    // Successful create → the in-progress draft is now saved; discard it.
    if (!expense) clearDraft();
    onClose();
  };

  const onSubmit = (data: FormValues) => {
    // Confirm before recording an expense dated in the future (covers both modes)
    if (isFutureDate(data.date)) {
      setPendingFutureData(data);
      return;
    }
    doSubmit(data);
  };

  const doSubmit = (data: FormValues) => {
    if (mode === 'itemized') {
      submitItemized(data);
      return;
    }

    const effectiveCategory = data.category;
    const effectiveSubcategory = data.subcategory;

    // Safety net: ensure the chosen category + subcategory exist in the managed
    // taxonomy (no-op if already present). Covers values added inline so they
    // appear, sorted, in the dropdowns next time and drive the inventory link.
    if (effectiveCategory.trim()) {
      addEntry(effectiveCategory.trim(), effectiveSubcategory.trim());
      // Mirror into the product taxonomy so it's selectable in Products/Sales too.
      syncTaxonomy(effectiveCategory.trim(), effectiveSubcategory.trim());
    }

    // For quantifiable (material) categories and product types, quantity, unit and
    // price are all required so the purchase is fully specified and feeds
    // inventory/price history. For a merely subcategorized line under a
    // non-quantifiable category they're optional (a subcategorized service/lump
    // sum), but if a quantity IS entered it still cascades to inventory.
    const requireQtyPrice = isQuantifiable(selectedCategory) || isInventoryLinkedCategory;
    if (showQtyPrice && requireQtyPrice) {
      if (data.quantity <= 0) { toast.error(VALIDATION.quantityRequired); return; }
      if (!data.unit.trim()) { toast.error(VALIDATION.unitRequired); return; }
      if (data.unitPrice <= 0) { toast.error(VALIDATION.priceRequired); return; }
    }

    // ── Description assembly ──────────────────────────────────────────────────
    const parts: string[] = [];
    if ((isDelivery || isAirFare) && (data.deliveryFrom.trim() || data.deliveryTo.trim())) {
      parts.push(`From ${data.deliveryFrom.trim() || '?'} to ${data.deliveryTo.trim() || '?'}`);
    }
    if ((showQtyPrice || isAirFare) && data.quantity > 0 && data.unitPrice > 0) {
      const qtyLabel = data.unit ? `${data.quantity} ${data.unit}` : `${data.quantity}`;
      parts.push(`${qtyLabel} × ${formatPHP(data.unitPrice)}`);
    }
    let description = data.description;
    if (parts.length > 0) {
      const detail = parts.join(', ');
      description = description ? `${description} (${detail})` : detail;
    }

    // ── Vendor resolution (manual entry → match or create) ────────────────────
    let resolvedVendorId = data.vendorId === MANUAL_ENTRY ? '' : data.vendorId;
    let resolvedVendorName = data.vendorName.trim();
    let newVendorCreated = false;

    if (data.vendorId === MANUAL_ENTRY && resolvedVendorName) {
      const nameKey = resolvedVendorName.toLowerCase();
      const existing = vendors.find((v) => v.vendor.trim().toLowerCase() === nameKey);
      if (existing) {
        resolvedVendorId = existing.id;
        resolvedVendorName = existing.vendor;
      } else {
        // Seed the new vendor's supplies with the user's up-front selections,
        // plus this purchase's own category (unless vendor is optional) —
        // de-duplicated so we never list the same (category, subcategory) twice.
        const seededSupplies: VendorSupply[] = [...newVendorSupplies];
        if (!vendorOptional && effectiveCategory) {
          const dup = seededSupplies.some(
            (s) => s.category === effectiveCategory && s.subcategory === effectiveSubcategory,
          );
          if (!dup) seededSupplies.push({ category: effectiveCategory, subcategory: effectiveSubcategory });
        }
        const created = addVendor({
          vendor: resolvedVendorName,
          contact: '',
          phone: '',
          supplies: seededSupplies,
          notes: '',
        });
        resolvedVendorId = created.id;
        newVendorCreated = true;
      }
    }

    // Record quantity/unit/unitPrice for quantifiable supplies and air fare (optional there)
    const recordDetail = showQtyPrice || isAirFare;
    const recordQty = recordDetail ? data.quantity : 0;
    const recordUnit = showQtyPrice ? data.unit : '';
    const recordUnitPrice = recordDetail ? data.unitPrice : 0;

    // Save-time safety net: if the classification/type weren't set (e.g. the
    // prefill effect hadn't committed, or a category whose default lives on a
    // subcategory row like Root Stock), fall back to the taxonomy default so the
    // saved expense — and the table — always carries its bookkeeping.
    const bkDefault = bookkeepingFor(effectiveCategory, effectiveSubcategory);
    const accountingClassification = data.accountingClassification.trim() || bkDefault.accountingClassification;
    const expenseType = data.expenseType.trim() || bkDefault.expenseType;

    const payload = {
      date: data.date,
      vendorId: resolvedVendorId,
      vendorName: resolvedVendorName,
      category: effectiveCategory,
      subcategory: effectiveSubcategory,
      description,
      quantity: recordQty,
      unit: recordUnit,
      unitPrice: recordUnitPrice,
      amount: data.amount,
      // An unpaid (Pending) expense carries no payment method/details — cleared
      // so stale inputs from toggling never persist.
      paymentMethod: isPaid ? data.paymentMethod : '',
      paymentDetails: isPaid ? data.paymentDetails : '',
      accountingClassification,
      expenseType,
      notes: data.notes,
      paid: isPaid,
      // Local vendor → PHP; international vendor → USD. Never mixed/converted.
      currency,
      // Cuttings only: record the purpose (packed/bare/replant) so the cascade
      // routes it correctly. For replant, also carry the cutting type so the
      // Propagation batch tracks the right timeline. Left undefined otherwise.
      ...(isCuttingCategory && showQtyPrice ? { cuttingState } : {}),
      ...(isCuttingCategory && showQtyPrice && cuttingState === 'replant' ? { cuttingType } : {}),
    };

    if (expense) {
      updateExpense(expense.id, payload);
      toast.success(toastSuccess(ENTITY.expense, 'updated'));
    } else {
      addExpense(payload);
      toast.success(toastSuccess(ENTITY.expense, 'created'));
    }

    if (newVendorCreated) {
      toast.success(`Added "${resolvedVendorName}" to your Vendors`, { duration: 4000 });
    }

    // ── Auto-learn: add this supply to the vendor's list if it's new ─────────────
    // Silently keeps each vendor's supply catalog accurate from real purchases.
    // Skipped for newly-created vendors (already seeded above) and service categories.
    if (!newVendorCreated && resolvedVendorId && !vendorOptional) {
      const added = addSupply(resolvedVendorId, effectiveCategory, effectiveSubcategory);
      if (added) {
        const supplyLabel = effectiveSubcategory ? `${effectiveCategory} – ${effectiveSubcategory}` : effectiveCategory;
        toast(`Learned: ${resolvedVendorName} supplies ${supplyLabel}`, { icon: '🧠', duration: 3000 });
      }
    }

    // ── Resell cascade: add to the sellable Products list ────────────────────
    // Everything purchased flows to Inventory; Products gets items the business
    // resells (cost seeded from this purchase; selling price left blank). Cuttings,
    // Fruit and Fertilizer are ALWAYS resellable stock, so they cascade regardless
    // of the checkbox; other categories cascade only when flagged.
    const cascadeToProducts =
      (isResell || ALWAYS_RESELL_CATEGORIES.includes(effectiveCategory.trim())) &&
      showQtyPrice &&
      effectiveSubcategory.trim();
    if (cascadeToProducts) {
      const existingProduct = findSellableProduct(effectiveCategory, effectiveSubcategory);
      const wasNew = !existingProduct;
      // Whether this purchase will set the product's default cost: either it's a
      // brand-new product, or an existing one with no cost yet (costPHP 0).
      const learnedCost = recordUnitPrice > 0 && (wasNew || existingProduct.costPHP === 0);
      upsertSellableProduct({
        category: effectiveCategory,
        subcategory: effectiveSubcategory,
        unit: recordUnit,
        costPHP: recordUnitPrice,
      });
      const label = categoryLabel(effectiveCategory, effectiveSubcategory);
      if (wasNew) {
        toast.success(`"${label}" added to Products for sale`);
      } else if (learnedCost) {
        toast.success(`Saved default cost ${formatPHP(recordUnitPrice)} for "${label}"`, { duration: 4000 });
      }
    } else if (
      // Un-resell reversal (edit): the user cleared "we resell this" for a
      // non-always-resell category → remove the auto-created product from
      // Products if it's safe. Inventory is left untouched.
      !isResell &&
      showQtyPrice &&
      effectiveSubcategory.trim() &&
      !ALWAYS_RESELL_CATEGORIES.includes(effectiveCategory.trim())
    ) {
      const label = categoryLabel(effectiveCategory, effectiveSubcategory);
      const result = unlinkResellProduct(effectiveCategory, effectiveSubcategory);
      if (result === 'removed') {
        toast(`Removed "${label}" from Products for sale (kept in Inventory)`, { icon: '↩️', duration: 4000 });
      } else if (result === 'kept-priced' || result === 'kept-sold') {
        toast(`"${label}" stays in Products — it has ${result === 'kept-sold' ? 'sales history' : 'a selling price set'}`, { icon: '⚠️', duration: 5000 });
      }
    }

    // Successful create → the in-progress draft is now saved; discard it.
    if (!expense) clearDraft();
    onClose();
  };

  const showManualVendorFields = isManualVendor;

  const descriptionHint = isDelivery
    ? 'Brief description of what was delivered'
    : isAirFare
      ? 'Purpose of travel (optional)'
      : 'Brief description of what was purchased';

  // ── Top-level Product vs Service chooser ──────────────────────────────────
  // Shown for both new and existing expenses. Switching to Service hands off to
  // the dedicated ServiceExpenseForm (no quantity/unit/inventory/resell).
  const kindChooser = (
    <div>
      <span className="block text-sm font-medium text-gray-700 mb-1">What are you recording?</span>
      <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
        {([
          { value: 'product', label: 'Product / Material' },
          { value: 'service', label: 'Service' },
        ] as const).map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={kind === opt.value}
            onClick={() => setKind(opt.value)}
            className={[
              'px-3 py-1.5 text-sm rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
              kind === opt.value ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-400">
        {kind === 'service'
          ? 'A service (utilities, delivery, insurance, labor, …) — no quantity or inventory.'
          : 'A physical product or material — captures quantity, unit, price and feeds inventory.'}
      </p>
    </div>
  );

  if (kind === 'service') {
    return (
      <div className="space-y-4">
        {kindChooser}
        <ServiceExpenseForm expense={expense} onClose={onClose} />
      </div>
    );
  }

  return (
    <>
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {kindChooser}
      {/* Mode toggle: itemized product purchase vs single expense */}
      <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
        <button
          type="button"
          onClick={() => setMode('single')}
          className={[
            'px-3 py-1.5 text-sm rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
            mode === 'single' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
          ].join(' ')}
        >
          Single expense
        </button>
        <button
          type="button"
          onClick={() => setMode('itemized')}
          className={[
            'px-3 py-1.5 text-sm rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
            mode === 'itemized' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
          ].join(' ')}
        >
          Itemized purchase
        </button>
      </div>

      {mode === 'itemized' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <InputField label={FIELD.date.label} type="date" required error={errors.date?.message} {...register('date')} />
            <div>
              <label className="text-sm font-medium text-gray-700">{FIELD.vendor.label} <span className="text-red-500">*</span></label>
              <select
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                value={vendorId}
                onChange={handleVendorChange}
              >
                <option value="">Select vendor…</option>
                {[...vendors]
                  .sort((a, b) => a.vendor.localeCompare(b.vendor, undefined, { sensitivity: 'base' }))
                  .map((v) => (
                    <option key={v.id} value={v.id}>{v.vendor}</option>
                  ))}
                <option value={MANUAL_ENTRY}>Enter manually…</option>
              </select>
            </div>
          </div>

          {/* Manual vendor entry — full width so the supplies picker isn't
              squeezed into the half-width Vendor column above. */}
          {isManualVendor && (
            <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
              <InputField
                label="Vendor Name"
                required
                autoFocus
                {...register('vendorName')}
                placeholder="Type vendor name…"
              />
              <VendorSuppliesField
                value={newVendorSupplies}
                onChange={setNewVendorSupplies}
                hint="Optional — the categories & subcategories this vendor supplies. Saved to the vendor for future suggestions."
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-500">
                  Save this vendor to pick and add products for the purchase below.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 whitespace-nowrap"
                  onClick={saveManualVendor}
                  disabled={!(vendorName ?? '').trim()}
                >
                  Save to Vendors
                </Button>
              </div>
              <EntityMatchSuggestions
                query={vendorName}
                matches={vendorMatches}
                exact={exactVendorMatch}
                labelOf={(v) => v.vendor}
                keyOf={(v) => v.id}
                onUseExisting={useExistingVendor}
                noun="vendor"
              />
            </div>
          )}

          <ProductItemsPicker
            vendorId={isManualVendor ? '' : vendorId}
            vendorName={vendorName}
            items={items}
            onChange={(next) => { setItems(next); setItemsError(''); }}
          />
          {itemsError && <p className="text-xs text-red-500">{itemsError}</p>}

          {/* Payment — Paid toggle heads the block; its fields depend on it. */}
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
              options={acOptions}
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
          <InputField label="Description" {...register('description')} placeholder="Optional — defaults to an item summary" />
          <TextareaField label={FIELD.notes.label} {...register('notes')} rows={2} />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>
              {expense ? 'Save Changes' : 'Add Expense'}
            </Button>
          </div>
        </div>
      ) : (
      <>
      {/* Vendor-first: Date + Vendor sit together; Vendor scopes the Category list. */}
      <div className="grid grid-cols-2 gap-4">
        <InputField label={FIELD.date.label} type="date" required error={errors.date?.message} {...register('date')} />
        {/* Vendor — Air Fare has no vendor; show a disabled "not applicable" field */}
        {isAirFare ? (
          <div>
            <label className="text-sm font-medium text-gray-700">
              {FIELD.vendor.label} <span className="text-gray-400 font-normal">(not applicable)</span>
            </label>
            <input
              type="text"
              value="Not applicable"
              disabled
              readOnly
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-400 cursor-not-allowed"
            />
          </div>
        ) : (
          <div>
            <label className="text-sm font-medium text-gray-700">
              {FIELD.vendor.label} {!vendorOptional && <span className="text-red-500">*</span>}
              {vendorOptional && <span className="text-gray-400 font-normal"> (optional)</span>}
            </label>
            <select
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              value={vendorId}
              onChange={handleVendorChange}
            >
              <option value="">{vendorOptional ? 'None / not applicable' : 'Select vendor…'}</option>
              {singleVendorList.map((v) => {
                const supplyLabel = (v.supplies ?? []).map((s) => s.category).filter((c, i, a) => a.indexOf(c) === i).join(', ');
                return (
                  <option key={v.id} value={v.id}>
                    {v.vendor}{supplyLabel ? ` — ${supplyLabel}` : ''}
                  </option>
                );
              })}
              <option value={MANUAL_ENTRY}>Enter manually…</option>
            </select>
          </div>
        )}
      </div>

      {/* Vendor supporting UI (errors, manual-entry panel) — full width below the row */}
      {!isAirFare && (
        <div>
          {/* Vendor-required error for the dropdown itself (manual-entry field shows its own) */}
          {errors.vendorName?.message && !showManualVendorFields && (
            <p className="text-xs text-red-500 mt-1">{errors.vendorName.message}</p>
          )}

          {/* When a real vendor is selected and the chosen category isn't yet in its
              supplies, reassure the user it'll be learned on save (auto-learn). */}
          {vendorId && vendorId !== MANUAL_ENTRY && selectedCategory &&
            !(selectedVendor?.supplies ?? []).some((s) => s.category === selectedCategory) && (
            <p className="text-xs text-gray-500 mt-1">
              "{selectedCategory}{selectedSubcategory ? ` – ${selectedSubcategory}` : ''}" will be added to this vendor's supplies when you save.
            </p>
          )}

          {/* Manual vendor entry with suggestions */}
          {showManualVendorFields && (
            <div className="mt-2 space-y-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
              <InputField
                label="Vendor Name"
                required={!vendorOptional}
                autoFocus
                error={errors.vendorName?.message}
                {...register('vendorName')}
                placeholder="Type vendor name…"
              />

              {/* No supplies picker here: the Category field below already
                  captures what this vendor supplies, and that purchase category
                  is auto-added to the new vendor's supplies on save. */}

              {/* Save the vendor to the Vendors list now (without waiting for the
                  expense to be saved) — mirrors the itemized-mode flow. */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-500">
                  Save this vendor to your Vendors list now, or it's saved automatically with the expense.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 whitespace-nowrap"
                  onClick={saveManualVendor}
                  disabled={!(vendorName ?? '').trim()}
                >
                  Save to Vendors
                </Button>
              </div>

              <EntityMatchSuggestions
                query={vendorName}
                matches={vendorMatches}
                exact={exactVendorMatch}
                labelOf={(v) => v.vendor}
                keyOf={(v) => v.id}
                onUseExisting={useExistingVendor}
                noun="vendor"
              />
            </div>
          )}
        </div>
      )}

      {/* Category — scoped to the selected vendor's supplies (vendor-first). */}
      <CreatableSelect
        label={FIELD.category.label}
        required
        options={singleCategoryOptions}
        // Detect duplicates/similar names against ALL product categories (not just
        // the vendor-scoped visible list) so a new category typed here is flagged
        // if it already exists elsewhere in the taxonomy.
        matchOptions={categoryOptions}
        placeholder={FIELD.category.placeholder}
        value={selectedCategory}
        onChange={(v) => setValue('category', v, { shouldDirty: true, shouldValidate: true })}
        onCreate={(v) => {
          // New expense categories from a purchase default to quantifiable, so
          // Quantity/Unit/Price show and the item can feed inventory / be resold.
          addEntry(v, '', true);
          syncTaxonomy(v, '');
          setValue('category', v, { shouldDirty: true, shouldValidate: true });
          setValue('subcategory', '', { shouldDirty: true });
          toast.success(`Added category "${v}"`);
        }}
        error={errors.category?.message}
        createLabel="+ Add new category…"
        newFieldLabel="New Category"
        newFieldPlaceholder="e.g. Equipment Rental"
      />

      {/* Similar / exact-duplicate hint for a just-typed category. */}
      <SimilarEntryHint
        value={selectedCategory}
        options={allCategories}
        noun="category"
        onPick={(v) => { setValue('category', v, { shouldDirty: true, shouldValidate: true }); setValue('subcategory', '', { shouldDirty: true }); }}
      />

      {/* Subcategory — shown for any selected category. Users can pick an existing
          subcategory or add a new one inline; new values are saved to the Expense
          Categories list and appear (sorted) in the dropdown next time. */}
      {selectedCategory && (
        <div className="space-y-2">
          <CreatableSelect
            label={isDelivery ? 'Courier / Provider' : vendorOptional ? 'Provider / Subcategory' : 'Subcategory'}
            required={subcategoryRequired}
            error={errors.subcategory?.message}
            value={selectedSubcategory}
            options={subcategoryOptions}
            onChange={(v) => setValue('subcategory', v, { shouldDirty: true, shouldValidate: true })}
            onCreate={(v) => {
              // Persist under the current category so it appears (sorted) next time.
              addEntry(selectedCategory, v);
              syncTaxonomy(selectedCategory, v);
              toast.success(`Added subcategory "${v}" to ${selectedCategory}`);
            }}
            placeholder={subcategoryOptions.length ? 'Select or add…' : 'Add a subcategory…'}
            createLabel="+ Add new subcategory…"
            newFieldLabel="New Subcategory"
            newFieldPlaceholder="e.g. Magnesium"
          />

          {/* Similar / exact-duplicate hint for a just-typed subcategory. */}
          <SimilarEntryHint
            value={selectedSubcategory ?? ''}
            options={existingSubcategories}
            noun="subcategory"
            onPick={(v) => setValue('subcategory', v, { shouldDirty: true })}
          />
        </div>
      )}

      {/* Amount capture — depends on the category type */}
      {isAirFare ? (
        /* ── Air Fare: From / To + optional Qty / Price, Amount required ──── */
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <InputField label="From" {...register('deliveryFrom')} placeholder="Origin (optional)" hint="Optional" />
            <InputField label="To" {...register('deliveryTo')} placeholder="Destination (optional)" hint="Optional" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <InputField label={FIELD.quantity.label} type="number" step="0.01" {...register('quantity')} placeholder="Optional" hint="e.g. no. of tickets" />
            <InputField label={priceUnitLabel} type="number" step="0.01" {...register('unitPrice')} placeholder="Optional" hint="Optional" />
            <InputField
              label={amountLabel}
              type="number"
              step="0.01"
              required
              error={errors.amount?.message}
              {...register('amount')}
              hint={quantity > 0 && unitPrice > 0 ? 'Auto-calculated' : 'Total fare'}
            />
          </div>
        </div>
      ) : isDelivery ? (
        /* ── Delivery: From / To / Price ─────────────────────────────────── */
        <div className="grid grid-cols-3 gap-4">
          <InputField label="From" {...register('deliveryFrom')} placeholder="Pickup location" />
          <InputField label="To" {...register('deliveryTo')} placeholder="Drop-off location" />
          <InputField
            label={currency === 'USD' ? 'Price ($)' : 'Price (₱)'}
            type="number"
            step="0.01"
            required
            error={errors.amount?.message}
            {...register('amount')}
            hint="Delivery cost"
          />
        </div>
      ) : showQtyPrice ? (
        /* ── Quantifiable: Quantity + Unit × Unit Price → Amount ─────────── */
        <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <InputField label={FIELD.quantity.label} required type="number" step="0.01" error={errors.quantity?.message} {...register('quantity')} placeholder={FIELD.quantity.placeholder} />
          <CreatableSelect
            label={FIELD.unit.label}
            required
            options={unitOptions}
            placeholder={FIELD.unit.placeholder}
            value={watch('unit')}
            onChange={(v) => setValue('unit', v, { shouldDirty: true })}
            onCreate={addUnit}
            createLabel="+ Add new unit…"
            newFieldLabel="New Unit"
            newFieldPlaceholder="e.g. crate"
          />
          <InputField
            label={priceUnitLabel}
            required
            type="number"
            step="0.01"
            error={errors.unitPrice?.message}
            {...register('unitPrice')}
            placeholder={FIELD.unitPrice.placeholder}
            hint={prefilledPrice !== undefined ? `Default: ${money(prefilledPrice)} — editable` : undefined}
          />
          {/* Amount is auto-calculated from Quantity × Price for quantifiable
              purchases — read-only so it can't drift from the line math (which
              was the source of the confusing "amount must be > 0" error). */}
          <InputField
            label={amountLabel}
            type="number"
            step="0.01"
            readOnly
            value={quantity > 0 && unitPrice > 0 ? (quantity * unitPrice).toFixed(2) : ''}
            placeholder="Quantity × Price"
            error={errors.amount?.message}
            hint="Auto-calculated from Quantity × Price"
            className="bg-gray-50 text-gray-700 cursor-not-allowed"
          />
        </div>
        {isCuttingCategory && (
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">Purpose</span>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="cuttingState"
                  checked={cuttingState === 'packed'}
                  onChange={() => setCuttingState('packed')}
                  className="text-primary-600 focus:ring-primary-500"
                />
                Already packed
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="cuttingState"
                  checked={cuttingState === 'bare'}
                  onChange={() => setCuttingState('bare')}
                  className="text-primary-600 focus:ring-primary-500"
                />
                Bare / needs packing
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="cuttingState"
                  checked={cuttingState === 'replant'}
                  onChange={() => setCuttingState('replant')}
                  className="text-primary-600 focus:ring-primary-500"
                />
                For replant (farm)
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {cuttingState === 'packed'
                ? 'Adds to Ready for Sale — sellable right away.'
                : cuttingState === 'bare'
                  ? 'Adds to Needs Packing — pack it in Inventory before it can be sold.'
                  : 'Creates a Propagation batch reserved for the farm — track it there through rooting and planting. Not added to sellable stock.'}
            </p>
            {/* Replant: capture the cutting type so the Propagation batch tracks
                the correct rooting/ready timeline. */}
            {cuttingState === 'replant' && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Cutting Type</label>
                <select
                  value={cuttingType}
                  onChange={(e) => setCuttingType(e.target.value)}
                  className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  aria-label="Cutting type for the replant batch"
                >
                  {CUTTING_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Rooted stock is ready sooner than unrooted cuttings.
                </p>
              </div>
            )}
          </div>
        )}
        <CheckboxField
          label="We resell this"
          checked={isResell}
          onChange={setIsResell}
          hint="Adds it to Products for sale, seeding the cost from this purchase (set the selling price later). Leave off for supplies you only consume. Inventory is updated either way."
        />
        </div>
      ) : (
        /* ── Non-quantifiable service/lump-sum: Amount only ──────────────── */
        <InputField
          label={amountLabel}
          type="number"
          step="0.01"
          required
          error={errors.amount?.message}
          {...register('amount')}
        />
      )}

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
          options={acOptions}
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

      <InputField label="Description" {...register('description')} placeholder={descriptionHint} />
      <TextareaField label={FIELD.notes.label} {...register('notes')} rows={2} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>
          {expense ? 'Save Changes' : 'Add Expense'}
        </Button>
      </div>
      </>
      )}
    </form>

    <ConfirmDialog
      open={!!pendingFutureData}
      onClose={() => setPendingFutureData(null)}
      onConfirm={() => {
        if (pendingFutureData) doSubmit(pendingFutureData);
        setPendingFutureData(null);
      }}
      title="Future-dated expense"
      message={`This expense is dated ${pendingFutureData ? formatDate(pendingFutureData.date) : ''}, which is in the future. Record it as a future expense?`}
      confirmLabel="Yes, record it"
    />
    </>
  );
}
