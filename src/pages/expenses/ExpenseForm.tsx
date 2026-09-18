import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { Expense, ExpenseItem, Vendor, VendorSupply } from '../../types';
import { useExpenseStore } from '../../store/expenseStore';
import { useVendorStore } from '../../store/vendorStore';
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
import { formatPHP, formatDate, categoryLabel } from '../../utils/format';
import { isFutureDate, todayISO } from '../../utils/date';
import { useUnitStore, useAccountingClassificationStore, useExpenseTypeStore } from '../../store/optionStores';
import { PAYMENT_OPTIONS, MANUAL_ENTRY, INVENTORY_LINKED_TYPES, CUTTINGS_PRODUCT_TYPE } from '../../constants';
import { syncTaxonomy } from '../../store/taxonomySync';
import { unlinkResellProduct } from '../../store/productLink';

/** Categories whose purchases always cascade into the sellable Products list. */
const ALWAYS_RESELL_CATEGORIES = INVENTORY_LINKED_TYPES as readonly string[];
import { ProductItemsPicker } from './ProductItemsPicker';

type ExpenseMode = 'single' | 'itemized';

/**
 * Categories where a formal vendor is NOT required — services, utilities, and
 * miscellaneous spend. The provider (if any) is captured by the subcategory
 * (e.g. Delivery → LBC) or the description.
 */
const OPTIONAL_VENDOR_CATEGORIES = [
  'Delivery',
  'Electricity',
  'Water',
  'Gas',
  'Air Fare',
  'Operational Transportation',
  'Meals',
  'Other',
];

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
    date: z.string().min(1, 'Date is required'),
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
    paymentMethod: z.string().min(1, 'Payment method is required'),
    accountingClassification: z.string(),
    expenseType: z.string(),
    notes: z.string(),
  })
  .superRefine((d, ctx) => {
    if (d.mode === 'itemized') return; // itemized validates line items separately
    if (d.category.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: 'Category is required' });
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
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unitPrice'], message: 'Price is required' });
    } else if (price > 0 && qty <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantity'], message: 'Quantity is required' });
    } else {
      const effectiveAmount = qty > 0 && price > 0 ? qty * price : Number(d.amount) || 0;
      if (effectiveAmount < 0.01) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'Amount must be greater than 0' });
      }
    }
    // Vendor required only for categories that aren't in the optional list
    if (!OPTIONAL_VENDOR_CATEGORIES.includes(d.category) && d.vendorName.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vendorName'], message: 'Vendor is required for this category' });
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
  const { addExpense, updateExpense, latestUnitPrice } = useExpenseStore();
  const { vendors, addVendor, addSupply } = useVendorStore();
  const { categories, subcategoriesFor, addEntry, isQuantifiable } = useExpenseCategoryStore();
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addUnit = useUnitStore((s) => s.add);
  const acOptions = useAccountingClassificationStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addAccountingClassification = useAccountingClassificationStore((s) => s.add);
  const expenseTypeOptions = useExpenseTypeStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addExpenseType = useExpenseTypeStore((s) => s.add);
  const upsertSellableProduct = useProductStore((s) => s.upsertFromPurchase);
  const findSellableProduct = useProductStore((s) => s.findByCategorySub);
  const [isPaid, setIsPaid] = useState(expense?.paid ?? false);
  // "We resell this" — cascades a quantifiable purchase into the sellable Products
  // list. Defaults on when editing an expense whose product already exists there.
  const [isResell, setIsResell] = useState(
    !!expense && !!findSellableProduct(expense.category, expense.subcategory),
  );
  // Cuttings only: whether the purchased cuttings arrive packed (ready to sell)
  // or bare (still need packing). Defaults to 'packed'. Drives which inventory
  // pool the quantity lands in (packed/Ready-for-Sale vs needsPacking).
  const [cuttingState, setCuttingState] = useState<'packed' | 'bare'>(
    expense?.cuttingState ?? 'packed',
  );
  // Holds validated form data pending a future-date confirmation (null = none)
  const [pendingFutureData, setPendingFutureData] = useState<FormValues | null>(null);

  // Itemized (multi-item, product-based) vs single (category/service) mode.
  const hasExistingItems = !!expense?.items && expense.items.length > 0;
  const [mode, setMode] = useState<ExpenseMode>(hasExistingItems ? 'itemized' : 'single');
  const [items, setItems] = useState<ExpenseItem[]>(expense?.items ?? []);
  const [itemsError, setItemsError] = useState('');

  const categoryOptions = categories().map((c) => ({ value: c, label: c }));

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      mode: hasExistingItems ? 'itemized' : 'single',
      date: expense?.date ?? todayISO(),
      vendorId: expense?.vendorId ?? '',
      vendorName: expense?.vendorName ?? '',
      // Top-level category (the combined "Cat – Sub" label is derived at display time).
      category: expense?.category || '',
      subcategory: expense?.subcategory ?? '',
      quantity: expense?.quantity ?? 0,
      unit: expense?.unit ?? '',
      unitPrice: expense?.unitPrice ?? 0,
      // Recover the delivery/air-fare route from the saved description on edit
      deliveryFrom: parseDeliveryRoute(expense?.description ?? '').from,
      deliveryTo: parseDeliveryRoute(expense?.description ?? '').to,
      amount: expense?.amount ?? 0,
      description: expense?.description ?? '',
      paymentMethod: expense?.paymentMethod ?? 'Cash',
      accountingClassification: expense?.accountingClassification ?? '',
      expenseType: expense?.expenseType ?? '',
      notes: expense?.notes ?? '',
    },
  });

  // Keep the RHF `mode` field in sync so the resolver validates the right path
  useEffect(() => {
    setValue('mode', mode);
    setItemsError('');
  }, [mode, setValue]);

  const selectedCategory = watch('category');
  const selectedSubcategory = watch('subcategory');
  const accountingClassification = watch('accountingClassification');
  const expenseType = watch('expenseType');
  const quantity = Number(watch('quantity')) || 0;
  const unitPrice = Number(watch('unitPrice')) || 0;
  const vendorId = watch('vendorId');
  const vendorName = watch('vendorName');

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
  const existingSubcategories = subcategoriesFor(selectedCategory);
  const subcategoryOptions = existingSubcategories.map((s) => ({ value: s, label: s }));
  const allCategories = categories();

  // ── Vendor filtering by category + subcategory (structured supplies) ─────────
  const matchingVendors = vendors.filter((v) => {
    if (!selectedCategory) return true;
    const list = v.supplies ?? [];
    if (list.length === 0) return false;
    return list.some((s) => {
      if (s.category !== selectedCategory) return false;
      // If a subcategory is chosen, match it OR a vendor whose supply has no subcategory
      if (selectedSubcategory) return s.subcategory === selectedSubcategory || s.subcategory === '';
      return true;
    });
  });
  const noVendorMatches = !!selectedCategory && matchingVendors.length === 0;
  const vendorList = (() => {
    const base = [...(noVendorMatches ? vendors : matchingVendors)];
    // Always include the currently-selected vendor as an option, even if it
    // doesn't supply the chosen category — otherwise picking an existing vendor
    // from the match suggestions sets a vendorId with no matching <option>, and
    // the controlled <select> silently falls back to "Select vendor…".
    if (vendorId && vendorId !== MANUAL_ENTRY && !base.some((v) => v.id === vendorId)) {
      const selected = vendors.find((v) => v.id === vendorId);
      if (selected) base.push(selected);
    }
    return base.sort((a, b) => a.vendor.localeCompare(b.vendor, undefined, { sensitivity: 'base' }));
  })();

  // ── Manual vendor entry matching (recommend, don't enforce) ─────────────────
  const isManualVendor = vendorId === MANUAL_ENTRY;
  // Supplies the user assigns to a NEW vendor being created inline. Persisted to
  // the vendor on save and cascaded into the taxonomy by VendorSuppliesField.
  const [newVendorSupplies, setNewVendorSupplies] = useState<VendorSupply[]>([]);
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
    setValue('subcategory', '');
    setValue('vendorId', '');
    setValue('vendorName', '');
    setValue('quantity', 0);
    setValue('unit', '');
    setValue('unitPrice', 0);
    setValue('deliveryFrom', '');
    setValue('deliveryTo', '');
  }, [selectedCategory, setValue]);

  // Auto-calculate amount from quantity × unit price (quantifiable + air fare)
  useEffect(() => {
    if ((showQtyPrice || isAirFare) && quantity > 0 && unitPrice > 0) {
      setValue('amount', quantity * unitPrice);
    }
  }, [quantity, unitPrice, showQtyPrice, isAirFare, setValue]);

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
    setValue('vendorId', val === MANUAL_ENTRY ? MANUAL_ENTRY : val);
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
      paymentMethod: data.paymentMethod,
      accountingClassification: data.accountingClassification,
      expenseType: data.expenseType,
      notes: data.notes,
      paid: isPaid,
    };

    if (expense) {
      updateExpense(expense.id, payload);
      toast.success('Expense updated');
    } else {
      addExpense(payload);
      toast.success('Expense added');
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
      if (data.quantity <= 0) { toast.error('Quantity is required'); return; }
      if (!data.unit.trim()) { toast.error('Unit is required'); return; }
      if (data.unitPrice <= 0) { toast.error('Price / unit is required'); return; }
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
      paymentMethod: data.paymentMethod,
      accountingClassification: data.accountingClassification,
      expenseType: data.expenseType,
      notes: data.notes,
      paid: isPaid,
      // Cuttings only: record whether the purchase is packed or bare so the
      // inventory cascade routes it to the right pool. Left undefined otherwise.
      ...(isCuttingCategory && showQtyPrice ? { cuttingState } : {}),
    };

    if (expense) {
      updateExpense(expense.id, payload);
      toast.success('Expense updated');
    } else {
      addExpense(payload);
      toast.success('Expense added');
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

    onClose();
  };

  const showManualVendorFields = isManualVendor;

  const descriptionHint = isDelivery
    ? 'Brief description of what was delivered'
    : isAirFare
      ? 'Purpose of travel (optional)'
      : 'Brief description of what was purchased';

  return (
    <>
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
            <InputField label="Date" type="date" required error={errors.date?.message} {...register('date')} />
            <div>
              <label className="text-sm font-medium text-gray-700">Vendor <span className="text-red-500">*</span></label>
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

          <SelectField
            label="Payment Method"
            required
            options={PAYMENT_OPTIONS}
            error={errors.paymentMethod?.message}
            {...register('paymentMethod')}
          />
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
          <CheckboxField label="Paid" checked={isPaid} onChange={setIsPaid} />
          <TextareaField label="Notes" {...register('notes')} rows={2} />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>
              {expense ? 'Save Changes' : 'Add Expense'}
            </Button>
          </div>
        </div>
      ) : (
      <>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Date" type="date" required error={errors.date?.message} {...register('date')} />
        <CreatableSelect
          label="Category"
          required
          options={categoryOptions}
          placeholder="Select category…"
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
      </div>

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
            value={selectedSubcategory}
            options={subcategoryOptions}
            onChange={(v) => setValue('subcategory', v, { shouldDirty: true })}
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

      {/* Vendor — Air Fare has no vendor; show a disabled "not applicable" field */}
      {isAirFare ? (
        <div>
          <label className="text-sm font-medium text-gray-700">
            Vendor <span className="text-gray-400 font-normal">(not applicable)</span>
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
          Vendor {!vendorOptional && <span className="text-red-500">*</span>}
          {vendorOptional && <span className="text-gray-400 font-normal"> (optional)</span>}
        </label>
        <select
          className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          value={vendorId}
          onChange={handleVendorChange}
        >
          <option value="">{vendorOptional ? 'None / not applicable' : 'Select vendor…'}</option>
          {vendorList.map((v) => {
            const supplyLabel = (v.supplies ?? []).map((s) => s.category).filter((c, i, a) => a.indexOf(c) === i).join(', ');
            return (
              <option key={v.id} value={v.id}>
                {v.vendor}{supplyLabel ? ` — ${supplyLabel}` : ''}
              </option>
            );
          })}
          <option value={MANUAL_ENTRY}>Enter manually…</option>
        </select>

        {/* Vendor-required error for the dropdown itself (manual-entry field shows its own) */}
        {errors.vendorName?.message && !showManualVendorFields && (
          <p className="text-xs text-red-500 mt-1">{errors.vendorName.message}</p>
        )}

        {noVendorMatches && !vendorOptional && (
          vendorId && vendorId !== MANUAL_ENTRY ? (
            // A real vendor is selected: on save this purchase adds the
            // category/subcategory to that vendor's supplies (auto-learn), so
            // reassure the user instead of implying nothing is captured.
            <p className="text-xs text-gray-500 mt-1">
              "{selectedCategory}{selectedSubcategory ? ` – ${selectedSubcategory}` : ''}" will be added to this vendor's supplies when you save.
            </p>
          ) : (
            <p className="text-xs text-gold-600 mt-1">
              No vendors supply "{selectedCategory}" yet. Pick a vendor to record it under, or enter one manually.
            </p>
          )
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

            <VendorSuppliesField
              value={newVendorSupplies}
              onChange={setNewVendorSupplies}
              hint="Optional — the categories & subcategories this vendor supplies. Saved to the vendor for future suggestions."
            />

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

      {/* Amount capture — depends on the category type */}
      {isAirFare ? (
        /* ── Air Fare: From / To + optional Qty / Price, Amount required ──── */
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <InputField label="From" {...register('deliveryFrom')} placeholder="Origin (optional)" hint="Optional" />
            <InputField label="To" {...register('deliveryTo')} placeholder="Destination (optional)" hint="Optional" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <InputField label="Quantity" type="number" step="0.01" {...register('quantity')} placeholder="Optional" hint="e.g. no. of tickets" />
            <InputField label="Price / Unit (₱)" type="number" step="0.01" {...register('unitPrice')} placeholder="Optional" hint="Optional" />
            <InputField
              label="Amount (₱)"
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
            label="Price (₱)"
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
          <InputField label="Quantity" required type="number" step="0.01" error={errors.quantity?.message} {...register('quantity')} placeholder="e.g. 5" />
          <CreatableSelect
            label="Unit"
            required
            options={unitOptions}
            placeholder="Select or add…"
            value={watch('unit')}
            onChange={(v) => setValue('unit', v, { shouldDirty: true })}
            onCreate={addUnit}
            createLabel="+ Add new unit…"
            newFieldLabel="New Unit"
            newFieldPlaceholder="e.g. crate"
          />
          <InputField
            label="Price / Unit (₱)"
            required
            type="number"
            step="0.01"
            error={errors.unitPrice?.message}
            {...register('unitPrice')}
            placeholder="e.g. 250"
            hint={prefilledPrice !== undefined ? `Default: ${formatPHP(prefilledPrice)} — editable` : undefined}
          />
          {/* Amount is auto-calculated from Quantity × Price for quantifiable
              purchases — read-only so it can't drift from the line math (which
              was the source of the confusing "amount must be > 0" error). */}
          <InputField
            label="Amount (₱)"
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
            <span className="block text-sm font-medium text-gray-700 mb-1">Condition</span>
            <div className="flex gap-4">
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
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {cuttingState === 'packed'
                ? 'Adds to Ready for Sale — sellable right away.'
                : 'Adds to Needs Packing — pack it in Inventory before it can be sold.'}
            </p>
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
          label="Amount (₱)"
          type="number"
          step="0.01"
          required
          error={errors.amount?.message}
          {...register('amount')}
        />
      )}

      <SelectField
        label="Payment Method"
        required
        options={PAYMENT_OPTIONS}
        error={errors.paymentMethod?.message}
        {...register('paymentMethod')}
      />

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
      <CheckboxField label="Paid" checked={isPaid} onChange={setIsPaid} />
      <TextareaField label="Notes" {...register('notes')} rows={2} />

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
