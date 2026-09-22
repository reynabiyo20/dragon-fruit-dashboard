import { useState, useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2, AlertCircle, UserPlus, PackagePlus, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Sale, SaleItem, Customer, Currency } from '../../types';
import { useSaleStore } from '../../store/saleStore';
import { useCustomerStore } from '../../store/customerStore';
import { useProductStore } from '../../store/productStore';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { useEmployeeStore } from '../../store/employeeStore';
import { useCommissionStore } from '../../store/commissionStore';
import { useCuttingStore } from '../../store/cuttingStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { computeSaleDeliveryReadiness } from '../../utils/cuttingPacking';
import { useSaleDraftStore, type SaleDraft } from '../../store/saleDraftStore';
import { useEntityMatch } from '../../hooks/useEntityMatch';
import { EntityMatchSuggestions } from '../../components/forms/EntityMatchSuggestions';
import { InputField, SelectField, TextareaField, CheckboxField, DisplayField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useSaleTypeStore, useUnitStore } from '../../store/optionStores';
import { formatPHP, formatUSD, formatDate, categoryLabel } from '../../utils/format';
import { COUNTRY_OPTIONS, PHILIPPINES, countryOf, isInternationalLocation } from '../../constants/geography';
import { isFutureDate, todayISO } from '../../utils/date';
import { generateId } from '../../utils/id';
import { isOfficialInvoice } from '../../utils/invoice';
import {
  PAYMENT_OPTIONS, METHODS_REQUIRING_DETAILS, MANUAL_ENTRY, ONLINE_ORDERS,
  CUTTINGS_PRODUCT_TYPE, CUTTING_SMALL_ORDER_THRESHOLD, CUTTING_SMALL_ORDER_SURCHARGE,
  CUTTING_TYPE_GRAFTED,
} from '../../constants';
import { ENTITY, toastSuccess, VALIDATION, FIELD } from '../../constants/messages';
import type { Product } from '../../types';

/** Whether a product is a cutting (subject to the small-order surcharge rule). */
function isCuttingProduct(product: Product | undefined): boolean {
  return product?.category === CUTTINGS_PRODUCT_TYPE;
}

/**
 * Whether a sale line is inventory-tracked. Everything the business sells is
 * tracked in inventory now, so any resolvable product qualifies — its inventory
 * row is created on receipt if it doesn't exist yet. This drives the "Received
 * by Customer" flag, which moves inventory `sold` on fulfillment.
 */
function isStockProduct(product: Product | undefined): boolean {
  return !!product && !!product.category;
}

const schema = z
  .object({
    date: z.string().min(1, VALIDATION.dateRequired),
    invoiceNumber: z.string(),
    customerId: z.string(),
    customerName: z.string().min(1, VALIDATION.customerRequired),
    // Country of the customer/sale. Drives the currency: Philippines → PHP,
    // any other country → USD (kept strictly separate — never converted).
    country: z.string(),
    // How this sale happened (walk-in, online, …)
    saleType: z.string(),
    // Online-order contact fields (validated conditionally below)
    customerPhone: z.string(),
    customerFbMessenger: z.string(),
    customerAddress: z.string(),
    paymentMethod: z.string(),
    paymentDetails: z.string(),
    paid: z.boolean(),
    soldByEmployeeId: z.string(),
    notes: z.string(),
  })
  // A paid sale needs a payment method; an unpaid one is "Pending payment"
  // (no method needed — it flows to Outstanding until settled).
  .refine(
    (d) => !d.paid || d.paymentMethod.trim().length > 0,
    { path: ['paymentMethod'], message: VALIDATION.paymentMethodRequired }
  )
  // Payment details required for certain methods — only when the sale is paid.
  .refine(
    (d) => !d.paid || !METHODS_REQUIRING_DETAILS.includes(d.paymentMethod) || d.paymentDetails.trim().length > 0,
    { path: ['paymentDetails'], message: 'Payment details are required for this payment method' }
  )
  // Online-order sales require a delivery address
  .refine(
    (d) => d.saleType !== ONLINE_ORDERS || d.customerAddress.trim().length > 0,
    { path: ['customerAddress'], message: 'Delivery address is required for online orders' }
  )
  // Online-order sales require a contact number
  .refine(
    (d) => d.saleType !== ONLINE_ORDERS || d.customerPhone.trim().length > 0,
    { path: ['customerPhone'], message: 'Contact number is required for online orders' }
  );

type FormValues = z.infer<typeof schema>;

interface SaleFormProps {
  sale: Sale | null;
  onClose: () => void;
}

interface EditableItem extends SaleItem {
  _key: string;
}

export function SaleForm({ sale, onClose }: SaleFormProps) {
  // In-progress draft (new sales only). Read once at mount so its values seed
  // the useState / RHF initializers below — restoring through initializers (not
  // post-mount setValue) keeps the form's reset/sync effects from treating a
  // restore as a user edit.
  const isNew = !sale;
  const draftSnapshot = useRef(isNew ? useSaleDraftStore.getState().draft : null);
  const saleDraft = draftSnapshot.current ?? {};
  const patchSaleDraft = useSaleDraftStore((s) => s.patch);
  const clearSaleDraft = useSaleDraftStore((s) => s.clear);

  const { addSale, updateSale } = useSaleStore();
  const { customers, addCustomer } = useCustomerStore();
  // Editable sale-type list (walk-in, online, …), shared with Settings
  const saleTypeValues = useSaleTypeStore((s) => s.values);
  const addSaleType = useSaleTypeStore((s) => s.add);
  const saleTypeOptions = saleTypeValues.map((v) => ({ value: v, label: v }));
  const { products } = useProductStore();
  const addProduct = useProductStore((s) => s.addProduct);
  const updateProduct = useProductStore((s) => s.updateProduct);
  const findSellableProduct = useProductStore((s) => s.findByCategorySub);
  // Products & Sales share this taxonomy — drives the cascading Category /
  // Subcategory filters and inline creation below.
  const { subcategoriesFor, addEntry } = useProductCategoryStore();
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addUnit = useUnitStore((s) => s.add);
  const { employees } = useEmployeeStore();
  const { setForSale, removeForSale } = useCommissionStore();
  const recordCuttingPurchase = useCuttingStore((s) => s.recordCustomerPurchase);
  // Inventory rows drive the cutting stock cap: a cutting sale can't exceed the
  // variety's on-hand stock (ending quantity).
  const inventoryItems = useInventoryStore((s) => s.items);

  /**
   * On-hand stock for a product — its inventory `endingQty` (beginning +
   * purchased − used − sold + packed), i.e. everything physically available to
   * sell. Returns undefined when there's no matching inventory row yet (so the
   * line isn't capped — the row is created on receipt), and 0 when the row
   * exists but is out of stock.
   */
  const availableStockOf = (product: Product | undefined): number | undefined => {
    if (!isStockProduct(product) || !product) return undefined;
    const norm = (s: string) => s.trim().toLowerCase();
    const row = inventoryItems.find(
      (i) => norm(i.category) === norm(product.category) && norm(i.subcategory) === norm(product.subcategory),
    );
    return row ? row.endingQty : undefined;
  };

  /**
   * Ready-to-sell (already packed) stock for a CUTTING product — the inventory
   * `availableForSale` pool. Cuttings on hand split into two pools: `packed`
   * (mirrored into availableForSale, ready to go) and `needsPacking` (bare stock
   * that must be packed first). The on-hand total (endingQty) covers both, so a
   * sale can be within stock yet still require packing before it can ship. This
   * is the "ready" portion used to detect that shortfall. Returns undefined for
   * non-cutting products (packing doesn't apply) or when there's no inventory row.
   */
  const readyStockOf = (product: Product | undefined): number | undefined => {
    if (!isCuttingProduct(product) || !product) return undefined;
    const norm = (s: string) => s.trim().toLowerCase();
    const row = inventoryItems.find(
      (i) => norm(i.category) === norm(product.category) && norm(i.subcategory) === norm(product.subcategory),
    );
    return row ? row.availableForSale ?? 0 : undefined;
  };

  // Salespeople = employees with a commission % > 0
  const salespeople = employees.filter((e) => e.commission > 0);

  // Build initial line items once, assigning a stable _key to each. We also
  // capture which lines carry a custom (overridden) surcharge so a saved
  // discount isn't reset by the aggregate rule on edit.
  const [initialItems, initialOverrides] = (() => {
    // Restore an in-progress draft's lines (new sales only), keeping their stable
    // _key so the surcharge/quantity maps below stay aligned. Otherwise build
    // from the edited sale's saved items.
    if (isNew && (saleDraft.items?.length ?? 0) > 0) {
      const rows = saleDraft.items as EditableItem[];
      return [rows, saleDraft.surchargeOverridden ?? {}] as const;
    }
    const rows: EditableItem[] = (sale?.items ?? []).map((i) => ({
      ...i,
      surcharge: (i as SaleItem).surcharge ?? 0,
      _key: generateId(),
    }));
    const overrides: Record<string, boolean> = {};
    rows.forEach((r) => {
      if (r.surcharge !== 0 && r.surcharge !== CUTTING_SMALL_ORDER_SURCHARGE) {
        overrides[r._key] = true;
      }
    });
    return [rows, overrides] as const;
  })();

  const [items, setItems] = useState<EditableItem[]>(initialItems);
  // Tracks lines whose surcharge the user has manually overridden (e.g. a
  // discount), so the aggregate auto-rule doesn't clobber it. Seeded from any
  // saved custom surcharge so a prior discount is preserved on edit.
  const [surchargeOverridden, setSurchargeOverridden] = useState<Record<string, boolean>>(initialOverrides);
  // Tracks lines whose quantity the user has actually entered. A fresh line
  // defaults to qty 1, but that placeholder shouldn't trigger the small-order
  // cuttings surcharge/warning until a real quantity is confirmed. Existing
  // (saved) lines count as already-entered.
  const [quantityEntered, setQuantityEntered] = useState<Record<string, boolean>>(() => {
    // Restore the draft's per-line "quantity entered" flags when present;
    // otherwise treat every seeded (saved) line as already-entered.
    if (isNew && saleDraft.quantityEntered) return saleDraft.quantityEntered;
    const seeded: Record<string, boolean> = {};
    initialItems.forEach((r) => { seeded[r._key] = true; });
    return seeded;
  });
  const [isPaid, setIsPaid] = useState(saleDraft.isPaid ?? sale?.paid ?? false);
  const [isDelivered, setIsDelivered] = useState(saleDraft.isDelivered ?? sale?.delivered ?? false);
  // Per-item validation errors keyed by _key
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  // Bulk product-picker (checklist) open state + search filter
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  // Cascading taxonomy filters (both optional). Subcategory is scoped to the
  // active category; when no category is chosen it shows every subcategory.
  const [activeCategory, setActiveCategory] = useState('');
  const [activeSubcategory, setActiveSubcategory] = useState('');
  // Inline "new product" create panel (category + subcategory + default unit).
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [createError, setCreateError] = useState('');
  // Holds validated form data pending a future-date confirmation (null = none)
  const [pendingFutureData, setPendingFutureData] = useState<FormValues | null>(null);

  const productLabel = (p: Product) => categoryLabel(p.category, p.subcategory);
  const norm = (s: string) => s.trim().toLowerCase();

  // ── Cascading filter option lists — derived from EXISTING PRODUCTS ───────────
  // A sale can only pick products that exist in the Products store, so the
  // Category / Subcategory filters offer only categories/varieties that actually
  // have a product. (Brand-new ones are added via the "New product" panel below,
  // which uses the full managed taxonomy.)
  const sortAlpha = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  const productCategories = useMemo(
    () => [...new Set(products.map((p) => p.category.trim()).filter(Boolean))].sort(sortAlpha),
    [products],
  );
  const categoryOptions = productCategories.map((c) => ({ value: c, label: c }));
  // Subcategories that have a product, scoped to the active category. With no
  // category chosen, offer every product subcategory (deduped, sorted).
  const subcategoryList = useMemo(() => {
    const subs = products
      .filter((p) => (activeCategory ? norm(p.category) === norm(activeCategory) : true))
      .map((p) => p.subcategory.trim())
      .filter(Boolean);
    return [...new Set(subs)].sort(sortAlpha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, activeCategory]);
  const subcategoryOptions = subcategoryList.map((s) => ({ value: s, label: s }));

  // ── Checklist entries ───────────────────────────────────────────────────────
  // The checklist lists only EXISTING products (a sale can't pick a category/
  // subcategory that isn't a real product). A product that doesn't exist yet is
  // added via the "New product" panel, which creates it and then it appears here.
  type PickerEntry = { key: string; label: string; category: string; subcategory: string; product: Product };

  const matchesFilters = (category: string, subcategory: string, label: string): boolean =>
    (activeCategory ? norm(category) === norm(activeCategory) : true) &&
    (activeSubcategory ? norm(subcategory) === norm(activeSubcategory) : true) &&
    label.toLowerCase().includes(productSearch.trim().toLowerCase());

  const pickerEntries: PickerEntry[] = products
    .map((p): PickerEntry => ({
      key: `p:${p.id}`,
      label: productLabel(p),
      category: p.category,
      subcategory: p.subcategory,
      product: p,
    }))
    .filter((e) => matchesFilters(e.category, e.subcategory, e.label))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

  // ── Inline taxonomy creation ────────────────────────────────────────────────
  /**
   * The Subcategory FILTER's "New product…" option opens the dedicated New
   * Product panel (prefilled) rather than creating on the spot — a new variety
   * needs a default unit, captured there.
   */
  const handleCreateSubcategory = (value: string) => {
    setNewCategory(activeCategory);
    setNewSubcategory(value.trim());
    setNewUnit('');
    setCreateError('');
    setShowCreateProduct(true);
  };

  const resetCreateProduct = () => {
    setNewCategory('');
    setNewSubcategory('');
    setNewUnit('');
    setCreateError('');
    setShowCreateProduct(false);
  };

  // Subcategory options for the New Product panel, scoped to the panel's own
  // category selection (independent of the active filter).
  const newSubcategoryOptions = (newCategory ? subcategoriesFor(newCategory) : []).map((s) => ({ value: s, label: s }));

  /**
   * Create (or bind to) a category + subcategory product with a default unit.
   * Case-insensitive dedup: if the product already exists it's reused (and a
   * missing unit backfilled) rather than duplicated. Registers the pair in both
   * shared taxonomies and applies the new variety to the filters so it shows in
   * the checklist immediately.
   */
  const handleCreateProduct = () => {
    const cat = newCategory.trim();
    const sub = newSubcategory.trim();
    const unit = newUnit.trim();
    if (!cat) { setCreateError('Category is required'); return; }
    if (!sub) { setCreateError('Subcategory is required'); return; }

    addEntry(cat, sub);
    syncTaxonomy(cat, sub);

    const existing = findSellableProduct(cat, sub);
    if (existing) {
      // Bind to the existing product; backfill its unit only if it has none.
      if (unit && !existing.unit.trim()) {
        updateProduct(existing.id, { unit });
      }
      toast.success(`Using existing "${categoryLabel(cat, sub)}"`);
    } else {
      addProduct({
        category: cat,
        subcategory: sub,
        costPHP: 0,
        sellingPricePHP: 0,
        costUSD: 0,
        sellingPriceUSD: 0,
        unit,
        notes: '',
      });
      toast.success(`Added "${categoryLabel(cat, sub)}"${unit ? ` (${unit})` : ''}`);
    }

    // Surface the new variety through the filters so it appears in the checklist.
    setActiveCategory(cat);
    setActiveSubcategory(sub);
    resetCreateProduct();
  };

  // Resolve the original customer (for prefilling online-order contact fields)
  const existingCustomer = sale ? customers.find((c) => c.id === sale.customerId) : undefined;

  const { register, handleSubmit, setValue, watch, trigger, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    // Restore any in-progress draft first (new sales only), then the edited
    // sale's values, then blank/today defaults.
    defaultValues: {
      date: saleDraft.date ?? sale?.date ?? todayISO(),
      invoiceNumber: saleDraft.invoiceNumber ?? sale?.invoiceNumber ?? '',
      customerId: saleDraft.customerId ?? sale?.customerId ?? '',
      customerName: saleDraft.customerName ?? sale?.customerName ?? '',
      // Country drives the currency. On edit prefer the linked customer's country;
      // else infer from the saved sale currency (USD → international placeholder).
      country: saleDraft.country ?? (existingCustomer
        ? countryOf(existingCustomer.location)
        : sale?.currency === 'USD' ? 'Other' : PHILIPPINES),
      // Prefer the contact snapshot saved on the sale (survives edits even for a
      // one-off customer), then fall back to the linked customer's record.
      customerPhone: saleDraft.customerPhone ?? sale?.customerPhone ?? existingCustomer?.phone ?? '',
      customerFbMessenger: saleDraft.customerFbMessenger ?? sale?.customerFbMessenger ?? existingCustomer?.fbMessengerName ?? '',
      customerAddress: saleDraft.customerAddress ?? sale?.customerAddress ?? existingCustomer?.address ?? '',
      saleType: saleDraft.saleType ?? sale?.saleType ?? '',
      paymentMethod: saleDraft.paymentMethod ?? sale?.paymentMethod ?? 'Cash',
      paymentDetails: saleDraft.paymentDetails ?? sale?.paymentDetails ?? '',
      paid: saleDraft.paid ?? sale?.paid ?? false,
      soldByEmployeeId: saleDraft.soldByEmployeeId ?? sale?.soldByEmployeeId ?? '',
      notes: saleDraft.notes ?? sale?.notes ?? '',
    },
  });

  const lineTotal = (i: EditableItem) => i.quantity * (i.unitPrice + (i.surcharge || 0));
  const subtotal = items.reduce((sum, i) => sum + lineTotal(i), 0);

  // ── Combined-order cuttings surcharge ───────────────────────────────────────
  // The small-order surcharge is based on the COMBINED quantity of cuttings
  // across every line, not each line. If the total cuttings in this sale is
  // under the threshold, every (non-overridden) cutting line gets +₱100/unit;
  // once the combined total reaches the threshold, the surcharge is removed.
  // Only lines whose quantity has actually been entered count toward the
  // combined total — an untouched default (qty 1) is a placeholder and must not
  // trigger the surcharge or warning on its own.
  const totalCuttingQty = items.reduce((sum, i) => {
    const product = products.find((p) => p.id === i.productId);
    return isCuttingProduct(product) && quantityEntered[i._key] ? sum + i.quantity : sum;
  }, 0);
  const isSmallCuttingOrder = totalCuttingQty > 0 && totalCuttingQty < CUTTING_SMALL_ORDER_THRESHOLD;
  // Whether this sale includes any inventory-tracked line. Everything sold is
  // tracked in inventory, so any line with a resolvable product qualifies —
  // this drives the "Received by Customer?" flag, which moves inventory `sold`
  // on fulfillment (and the cutting pool for cuttings).
  const hasStockItems = items.some((i) => isStockProduct(products.find((p) => p.id === i.productId)));

  // A signature of the cutting lines (which products, which are overridden) so
  // the sync effect re-runs whenever a cutting line is added/removed/repointed,
  // not only when the small-order boolean flips.
  const cuttingLineSignature = items
    .filter((i) => isCuttingProduct(products.find((p) => p.id === i.productId)))
    .map((i) => `${i._key}:${surchargeOverridden[i._key] ? 'x' : '.'}:${quantityEntered[i._key] ? 'q' : '-'}`)
    .join('|');

  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((i): EditableItem => {
        const product = products.find((p) => p.id === i.productId);
        if (!isCuttingProduct(product)) return i;
        // Respect a manual override (discount/waive) on this line.
        if (surchargeOverridden[i._key]) return i;
        // A line with an unconfirmed (default) quantity never gets the surcharge.
        const eligible = isSmallCuttingOrder && quantityEntered[i._key];
        const target = eligible ? CUTTING_SMALL_ORDER_SURCHARGE : 0;
        if ((i.surcharge || 0) === target) return i;
        changed = true;
        return { ...i, surcharge: target, total: i.quantity * (i.unitPrice + target) };
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSmallCuttingOrder, cuttingLineSignature]);
  const selectedCustomerId = watch('customerId');
  const customerName = watch('customerName');
  const saleType = watch('saleType');
  const paymentMethod = watch('paymentMethod');
  const isOnlineOrder = saleType === ONLINE_ORDERS;
  const paymentDetailsRequired = isPaid && METHODS_REQUIRING_DETAILS.includes(paymentMethod);
  const isManualEntry = selectedCustomerId === MANUAL_ENTRY;

  // ── Currency (international support) ─────────────────────────────────────────
  // A sale is international (USD) when its country is outside the Philippines.
  // Local sales stay PHP. PHP and USD are never mixed or converted.
  const saleCountry = watch('country');
  const isInternational = isInternationalLocation({ country: saleCountry, province: '', municipality: '' });
  const currency: Currency = isInternational ? 'USD' : 'PHP';
  const money = (amount: number) => (currency === 'USD' ? formatUSD(amount) : formatPHP(amount));
  const priceLabel = currency === 'USD' ? 'Unit Price ($)' : 'Unit Price (₱)';

  // Toggling Paid: keep the RHF `paid` field in sync so the resolver knows
  // whether a payment method is required, and re-validate the payment fields so
  // stale errors clear when the sale is switched to unpaid (Pending payment).
  const handlePaidChange = (next: boolean) => {
    setIsPaid(next);
    setValue('paid', next, { shouldValidate: true });
    void trigger(['paymentMethod', 'paymentDetails']);
  };

  // ── Draft capture (new sales only) ────────────────────────────────────────────
  // Persist RHF field changes to the draft store as the user types, so a
  // half-filled new sale survives closing the modal or navigating away.
  useEffect(() => {
    if (!isNew) return;
    const sub = watch((values) => patchSaleDraft(values as SaleDraft));
    return () => sub.unsubscribe();
  }, [isNew, watch, patchSaleDraft]);

  // Persist the non-RHF pieces (line items + their surcharge/quantity maps, and
  // the paid/received toggles) whenever any of them change.
  useEffect(() => {
    if (!isNew) return;
    patchSaleDraft({ items, surchargeOverridden, quantityEntered, isPaid, isDelivered });
  }, [isNew, items, surchargeOverridden, quantityEntered, isPaid, isDelivered, patchSaleDraft]);

  // ── Late-binding invoice number display ─────────────────────────────────────
  // The system owns the invoice number (not typed): a DRAFT- id while pending,
  // and the official INV- number the moment the sale is finalized (paid).
  const invoiceDisplay = (() => {
    const existing = sale?.invoiceNumber ?? '';
    if (isOfficialInvoice(existing)) {
      return { value: existing, official: true, hint: 'Official invoice number — finalized and permanent.' };
    }
    if (isPaid) {
      // New sale being saved as paid, or a draft about to be finalized on save.
      return existing
        ? { value: existing, official: false, hint: 'An official invoice number will be assigned when you save.' }
        : { value: 'Assigned on save', official: false, hint: 'An official invoice number will be assigned when you save.' };
    }
    // Pending (unpaid): show the draft id (or that one will be created on save).
    return existing
      ? { value: existing, official: false, hint: 'Temporary draft — the official number is assigned when the sale is marked paid.' }
      : { value: 'Draft (assigned on save)', official: false, hint: 'A temporary draft number is used until the sale is marked paid.' };
  })();

  // ── Manual-entry customer matching ──────────────────────────────────────────
  const { matches: nameMatches, exact: exactMatch } = useEntityMatch(
    customerName, customers, (c) => c.customerName, isManualEntry
  );

  /** Link the manually-typed name to an existing customer record */
  const linkExistingCustomer = (c: Customer) => {
    setValue('customerId', c.id);
    setValue('customerName', c.customerName);
    setValue('customerPhone', c.phone ?? '');
    setValue('customerFbMessenger', c.fbMessengerName ?? '');
    setValue('customerAddress', c.address ?? '');
    // Adopt the customer's country so the sale currency follows them.
    setValue('country', countryOf(c.location), { shouldValidate: true });
  };

  /**
   * Explicitly persist the manually-entered customer to the Customers list and
   * link this sale to the new record. Guards against empties and exact-name dupes
   * (the button is also disabled in those cases). Customers are identity-only —
   * the sale type stays on the sale, not the customer.
   */
  const saveNewCustomer = () => {
    const name = customerName?.trim();
    if (!name) {
      toast.error('Enter a customer name first');
      return;
    }
    const nameKey = name.toLowerCase();
    const existing = customers.find((c) => c.customerName.trim().toLowerCase() === nameKey);
    if (existing) {
      // Don't create a duplicate — link to the one that already exists.
      linkExistingCustomer(existing);
      toast('Linked to existing customer');
      return;
    }
    const created = addCustomer({
      customerName: name,
      contactPerson: '',
      phone: watch('customerPhone'),
      fbMessengerName: watch('customerFbMessenger'),
      email: '',
      address: watch('customerAddress'),
      // Capture the country so a new international customer is recorded as such
      // (matches the sale-submit path); province/municipality stay blank until
      // the customer is edited in the Customers page.
      location: { country: watch('country') || PHILIPPINES, province: '', municipality: '' },
      notes: '',
    });
    setValue('customerId', created.id);
    toast.success(`Added "${name}" to your Customers`);
  };

  // ── Item management ─────────────────────────────────────────────────────────
  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((i) => i._key !== key));
    setItemErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setQuantityEntered((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // ── Bulk product selection (checklist) ──────────────────────────────────────
  /**
   * Default unit price for a product in the sale's currency (USD for
   * international). Prefers the product's selling price; when that isn't set
   * yet, falls back to its unit cost so a product with only a cost still opens
   * the line pre-filled instead of at 0.
   */
  const defaultUnitPrice = (product: Product): number => {
    const sellingPrice = currency === 'USD' ? product.sellingPriceUSD : product.sellingPricePHP;
    if (sellingPrice > 0) return sellingPrice;
    const unitCost = currency === 'USD' ? product.costUSD : product.costPHP;
    return unitCost > 0 ? unitCost : 0;
  };

  /**
   * Whether adding/selling this product is blocked because it's out of stock.
   * A product is out of stock when its inventory row exists with an ending
   * quantity of 0 (or less). Products with no inventory row yet return
   * `undefined` from `availableStockOf` and are not blocked (the row is created
   * on receipt). Editing an already-received sale is exempt — its quantity is
   * already deducted from stock, so re-checking would wrongly block it.
   */
  const isOutOfStock = (product: Product | undefined): boolean => {
    const alreadyAccounted = !!sale && !!sale.delivered;
    if (alreadyAccounted) return false;
    const stock = availableStockOf(product);
    return stock !== undefined && stock <= 0;
  };

  /** Add a product as a new line pre-filled from the catalog (qty 1, default price). */
  const addProductLine = (product: Product) => {
    // Block selling a product that's out of stock — nothing to sell.
    if (isOutOfStock(product)) {
      toast.error(`No stock for "${productLabel(product)}" — add stock via Expenses or Propagation first.`);
      return;
    }
    const key = generateId();
    setItems((prev) => {
      const quantity = 1;
      const unitPrice = defaultUnitPrice(product);
      return [
        ...prev,
        {
          _key: key,
          productId: product.id,
          productName: productLabel(product),
          quantity,
          unitPrice,
          surcharge: 0,
          total: quantity * unitPrice,
        },
      ];
    });
    // Count the default qty as intended so the cuttings surcharge rule applies.
    setQuantityEntered((prev) => ({ ...prev, [key]: true }));
  };

  /** Remove every line tied to a product id (checklist uncheck). */
  const removeProductLines = (productId: string) => {
    setItems((prev) => {
      const removed = prev.filter((i) => i.productId === productId).map((i) => i._key);
      if (removed.length > 0) {
        setItemErrors((e) => {
          const next = { ...e };
          removed.forEach((k) => delete next[k]);
          return next;
        });
        setQuantityEntered((q) => {
          const next = { ...q };
          removed.forEach((k) => delete next[k]);
          return next;
        });
      }
      return prev.filter((i) => i.productId !== productId);
    });
  };

  /** Product ids already on a line (drives the checklist checked state). */
  const selectedProductIds = new Set(items.map((i) => i.productId).filter(Boolean));

  const toggleProduct = (product: Product) => {
    if (selectedProductIds.has(product.id)) removeProductLines(product.id);
    else addProductLine(product);
  };

  // Every checklist entry is backed by a real product, so toggling/checking is a
  // straight product operation.
  const toggleEntry = (entry: PickerEntry) => toggleProduct(entry.product);
  const isEntryChecked = (entry: PickerEntry): boolean => selectedProductIds.has(entry.product.id);

  const updateItem = (key: string, field: keyof SaleItem, value: string | number) => {
    // Reject picking a product-variety that's already on another line. Each
    // product should appear once — the user adjusts that line's quantity instead.
    if (field === 'productId' && value) {
      const duplicate = items.find((i) => i._key !== key && i.productId === value);
      if (duplicate) {
        const product = products.find((p) => p.id === value);
        const label = product ? productLabel(product) : 'That product';
        setItemErrors((prev) => ({
          ...prev,
          [key]: `${label} is already in this sale — adjust its quantity instead of adding it twice.`,
        }));
        toast.error(`${label} is already in this sale. Modify the quantity on the existing line.`);
        return; // don't apply the duplicate selection
      }
    }
    // A manual surcharge edit marks the line as overridden so the auto-rule stops.
    if (field === 'surcharge') {
      setSurchargeOverridden((prev) => ({ ...prev, [key]: true }));
    }
    // Editing the quantity — or picking a product (the default qty of 1 is then a
    // real, intended quantity) — confirms the line so it counts toward the
    // combined cuttings total and the small-order surcharge can apply.
    if (field === 'quantity' || (field === 'productId' && value)) {
      setQuantityEntered((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
    }

    // ── Inventory stock cap ──────────────────────────────────────────────────
    // A sale of an inventory-tracked product (Cuttings / Fruit / Fertilizer)
    // can't exceed the variety's on-hand stock (ending qty). If the entered
    // quantity is over, clamp it to what's in stock and flag an error.
    let clampError = '';
    let effectiveValue = value;
    if (field === 'quantity') {
      const line = items.find((i) => i._key === key);
      const product = products.find((p) => p.id === line?.productId);
      const stock = availableStockOf(product);
      if (stock !== undefined && typeof value === 'number' && value > stock) {
        effectiveValue = Math.max(0, stock);
        clampError =
          stock > 0
            ? `Only ${stock} in stock — quantity set to ${stock}.`
            : 'None in stock — add stock via Expenses or Propagation first.';
        toast.error(clampError);
      }
    }

    setItems((prev) =>
      prev.map((i): EditableItem => {
        if (i._key !== key) return i;
        const updated: EditableItem = { ...i, [field]: effectiveValue };

        if (field === 'productId') {
          const product = products.find((p) => p.id === value);
          if (product) {
            updated.productName = productLabel(product);
            updated.unitPrice = defaultUnitPrice(product);
          }
          // A fresh product resets any manual surcharge override; the aggregate
          // effect below will re-apply the standard surcharge if warranted.
          setSurchargeOverridden((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
          if (!isCuttingProduct(product)) updated.surcharge = 0;
        }

        updated.total = updated.quantity * (updated.unitPrice + (updated.surcharge || 0));
        return updated;
      })
    );
    // Set the stock-cap error if we clamped; otherwise clear this line's error.
    setItemErrors((prev) => {
      if (clampError) return { ...prev, [key]: clampError };
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /** Validate every line item; returns true if all valid */
  const validateItems = (): boolean => {
    const errs: Record<string, string> = {};
    const seenProductIds = new Set<string>();
    items.forEach((i) => {
      if (!i.productId) {
        errs[i._key] = 'Select a product';
      } else if (seenProductIds.has(i.productId)) {
        errs[i._key] = 'Duplicate product — combine into a single line and adjust the quantity.';
      } else if (i.quantity <= 0) {
        errs[i._key] = 'Quantity must be greater than 0';
      } else if (i.unitPrice <= 0) {
        errs[i._key] = 'Unit price must be greater than 0';
      } else {
        // Inventory-tracked sales can't exceed the variety's on-hand stock
        // (ending qty). Skip this cap when EDITING an already-received sale, since
        // that sale's quantity is already deducted from stock (re-checking would
        // double-count).
        const product = products.find((p) => p.id === i.productId);
        const stock = availableStockOf(product);
        const alreadyAccounted = !!sale && !!sale.delivered;
        if (stock !== undefined && !alreadyAccounted && stock <= 0) {
          // No ending quantity — this product can't be sold at all.
          errs[i._key] = 'No stock for this product — add stock via Expenses or Propagation first.';
        } else if (stock !== undefined && !alreadyAccounted && i.quantity > stock) {
          errs[i._key] = `Only ${stock} in stock (you entered ${i.quantity}).`;
        }
      }
      if (i.productId) seenProductIds.add(i.productId);
    });
    setItemErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCustomerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setValue('customerId', val);
    // Sale type is intentionally NOT reset here — it describes this sale, not the
    // customer, so it persists as you switch who the sale is for.
    if (val === MANUAL_ENTRY || val === '') {
      setValue('customerName', '');
      setValue('customerPhone', '');
      setValue('customerFbMessenger', '');
      setValue('customerAddress', '');
      // Manual entry: default to local; the user can pick a country below.
      setValue('country', PHILIPPINES, { shouldValidate: true });
    } else {
      const customer = customers.find((c) => c.id === val);
      setValue('customerName', customer?.customerName ?? '');
      setValue('customerPhone', customer?.phone ?? '');
      setValue('customerFbMessenger', customer?.fbMessengerName ?? '');
      setValue('customerAddress', customer?.address ?? '');
      // The sale currency follows the customer's country.
      setValue('country', countryOf(customer?.location), { shouldValidate: true });
    }
  };

  const onSubmit = (data: FormValues) => {
    // Item-level validation
    if (items.length === 0) {
      toast.error('Add at least one item');
      return;
    }
    if (!validateItems()) {
      toast.error('Please fix the item errors before saving');
      return;
    }
    // Confirm before recording a sale dated in the future
    if (isFutureDate(data.date)) {
      setPendingFutureData(data);
      return;
    }
    doSave(data);
  };

  const doSave = (data: FormValues) => {
    // ── Delivery gate: packed stock must cover the order ────────────────────────
    // A cutting order can only be flagged "Received by Customer" once its
    // cuttings are PACKED (the inventory Available-for-Sale pool). The sale may
    // have gone through against on-hand stock that still includes bare, unpacked
    // cuttings — so block the delivered flag until the packed quantity covers the
    // sale quantity, telling the user exactly how many of each variety to pack.
    // (Non-cutting lines have no packing step and never block.)
    if (hasStockItems && isDelivered) {
      const { products: liveProductsForGate } = useProductStore.getState();
      const readiness = computeSaleDeliveryReadiness(
        { items: items.map(({ _key: _drop, ...i }) => i), delivered: sale?.delivered },
        (id) => liveProductsForGate.find((p) => p.id === id),
        useInventoryStore.getState().items,
      );
      if (!readiness.canDeliver) {
        const detail = readiness.shortfalls
          .map((s) => `${s.toPack} × ${s.variety}`)
          .join(', ');
        toast.error(
          `Can't mark as received yet — still needs packing: ${detail}. Pack these on the Inventory page first.`,
          { duration: 7000 },
        );
        return;
      }
    }

    // ── Price learning ────────────────────────────────────────────────────────
    // For any product with NO selling price set yet in this sale's currency,
    // save the entered unit price back so it auto-fills next time. USD sales learn
    // sellingPriceUSD; PHP sales learn sellingPricePHP. Products that already have
    // a price are left untouched (the entered price is a per-sale override).
    const learnedProducts: string[] = [];
    // Read the live store state (not the render-time snapshot) so the lookup and
    // write always target the current product record.
    const { products: liveProducts, updateProduct: liveUpdateProduct } = useProductStore.getState();
    items.forEach((item) => {
      if (!item.productId) return;
      const product = liveProducts.find((p) => p.id === item.productId);
      if (!product || item.unitPrice <= 0) return;
      const currentPrice = currency === 'USD' ? product.sellingPriceUSD : product.sellingPricePHP;
      if (currentPrice === 0) {
        liveUpdateProduct(
          product.id,
          currency === 'USD' ? { sellingPriceUSD: item.unitPrice } : { sellingPricePHP: item.unitPrice },
        );
        learnedProducts.push(categoryLabel(product.category, product.subcategory));
      }
    });

    // ── Customer resolution ─────────────────────────────────────────────────
    // Determine the customer ID to link the sale to.
    let resolvedCustomerId = data.customerId === MANUAL_ENTRY ? '' : data.customerId;
    let newCustomerCreated = false;

    if (data.customerId === MANUAL_ENTRY && data.customerName.trim()) {
      const nameKey = data.customerName.trim().toLowerCase();
      const existing = customers.find(
        (c) => c.customerName.trim().toLowerCase() === nameKey
      );
      if (existing) {
        // Name matches an existing customer — link to them (recommend, not enforce)
        resolvedCustomerId = existing.id;
      } else {
        // Genuinely new customer — save to the customer records (identity only)
        const created = addCustomer({
          customerName: data.customerName.trim(),
          contactPerson: '',
          phone: data.customerPhone,
          fbMessengerName: data.customerFbMessenger,
          email: '',
          address: data.customerAddress,
          // Capture the country so a new international customer is recorded as such.
          location: { country: data.country || PHILIPPINES, province: '', municipality: '' },
          notes: '',
        });
        resolvedCustomerId = created.id;
        newCustomerCreated = true;
      }
    }

    // ── Salesperson resolution ────────────────────────────────────────────────
    const salesperson = salespeople.find((s) => s.id === data.soldByEmployeeId);
    const soldByName = salesperson?.name ?? '';

    const computedSubtotal = items.reduce((sum, i) => sum + lineTotal(i), 0);

    const payload = {
      date: data.date,
      invoiceNumber: data.invoiceNumber,
      customerId: resolvedCustomerId,
      customerName: data.customerName,
      // Snapshot the contact info on the sale so it survives edits regardless of
      // whether the customer was persisted.
      customerPhone: data.customerPhone,
      customerFbMessenger: data.customerFbMessenger,
      customerAddress: data.customerAddress,
      saleType: data.saleType,
      // Local (PH) sales are PHP; international are USD. Never mixed/converted.
      currency,
      // An unpaid (Pending) sale carries no payment method/details — they're
      // captured only once it's marked paid.
      paymentMethod: isPaid ? data.paymentMethod : '',
      paymentDetails: isPaid ? data.paymentDetails : '',
      paid: isPaid,
      // Only inventory-tracked sales carry a received flag; other sales (Drink /
      // Other) never move inventory, so they are never "received".
      delivered: hasStockItems ? isDelivered : false,
      soldByEmployeeId: data.soldByEmployeeId,
      soldByName,
      notes: data.notes,
      items: items.map(({ _key: _drop, ...i }) => i),
    };

    // The sale id we'll link commissions to (existing edit, or new sale)
    let saleId = sale?.id ?? '';

    if (sale) {
      updateSale(sale.id, payload as Partial<Sale>);
      toast.success(toastSuccess(ENTITY.sale, 'updated'));
    } else {
      const created = addSale(payload as Parameters<typeof addSale>[0]);
      saleId = created.id;
      toast.success(toastSuccess(ENTITY.sale, 'created'));
    }

    // ── Cuttings Store cascade ────────────────────────────────────────────────
    // Every cutting line on this sale is pushed to the Cuttings Store as a
    // "Customer"-sourced record (variety, quantity, date bought, buyer). Keyed by
    // saleId + variety so editing the sale updates the same record.
    const cuttingLines = items.filter((i) =>
      isCuttingProduct(liveProducts.find((p) => p.id === i.productId)),
    );
    if (cuttingLines.length > 0 && saleId) {
      cuttingLines.forEach((line) => {
        const product = liveProducts.find((p) => p.id === line.productId);
        if (!product) return;
        recordCuttingPurchase({
          subcategory: product.subcategory,
          quantity: line.quantity,
          dateBought: data.date,
          customerId: resolvedCustomerId,
          customerName: data.customerName,
          saleId,
          // Cuttings sold to customers are grafted/rooted stock by default.
          cuttingType: CUTTING_TYPE_GRAFTED,
        });
      });
      toast('Logged to Propagation', { icon: '🌱', duration: 3000 });
    }

    // ── Commission bucket sync ────────────────────────────────────────────────
    // Keep the commission ledger in step with the sale's salesperson.
    if (salesperson && salesperson.commission > 0) {
      setForSale({
        date: data.date,
        employeeId: salesperson.id,
        employeeName: salesperson.name,
        saleId,
        saleAmount: computedSubtotal,
        commissionPct: salesperson.commission,
        notes: `Auto from sale ${data.invoiceNumber || saleId.slice(0, 8)}`,
      });
    } else {
      // No salesperson (or removed) — drop any existing commission for this sale
      removeForSale(saleId);
    }

    // Let the user know we saved a new customer
    if (newCustomerCreated) {
      toast.success(`Added "${data.customerName.trim()}" to your Customers`, { duration: 4000 });
    }

    // Let the user know we saved a new default price
    if (learnedProducts.length > 0) {
      toast.success(
        `Saved default price for: ${learnedProducts.join(', ')}`,
        { duration: 4000 }
      );
    }

    // ── Needs-packing notice ──────────────────────────────────────────────────
    // A cutting sale is allowed as long as the quantity is within on-hand stock
    // (endingQty), but on-hand stock includes bare cuttings that still need
    // packing. Whenever a line's quantity exceeds the ready (packed /
    // availableForSale) portion, that shortfall has to be packed before the order
    // can be handed over. The sale still goes through — we just flag what needs
    // packing so it isn't forgotten. Skipped when editing an already-received
    // sale (its stock already moved, so re-checking would mislead).
    const alreadyReceived = !!sale && !!sale.delivered;
    if (!alreadyReceived) {
      const packNotices: string[] = [];
      items.forEach((item) => {
        if (!item.productId || item.quantity <= 0) return;
        const product = liveProducts.find((p) => p.id === item.productId);
        const ready = readyStockOf(product);
        if (ready === undefined) return; // non-cutting or no inventory row
        const shortfall = item.quantity - ready;
        if (shortfall > 0 && product) {
          packNotices.push(`${shortfall} × ${categoryLabel(product.category, product.subcategory)}`);
        }
      });
      if (packNotices.length > 0) {
        toast(
          `Needs packing before delivery: ${packNotices.join(', ')}. Pack it on the Inventory page.`,
          { icon: '📦', duration: 6000 },
        );
      }
    }

    // Successful create → the in-progress draft is now saved; discard it.
    if (!sale) clearSaleDraft();
    onClose();
  };

  return (
    <>
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <InputField label={FIELD.date.label} type="date" required error={errors.date?.message} {...register('date')} />
        {/* Late-binding invoice number — assigned by the system, not typed:
            a temporary DRAFT while pending, and the official sequential number
            the moment the sale is marked paid. */}
        <div>
          <DisplayField
            label={FIELD.invoice.label}
            value={invoiceDisplay.value}
            highlight={invoiceDisplay.official}
          />
          <p className="mt-1 text-xs text-gray-400">{invoiceDisplay.hint}</p>
        </div>
      </div>

      {/* Customer */}
      <div>
        <label className="text-sm font-medium text-gray-700">
          Customer <span className="text-red-500">*</span>
        </label>
        <select
          className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          value={selectedCustomerId}
          onChange={handleCustomerChange}
        >
          <option value="">Select customer…</option>
          {[...customers]
            .sort((a, b) => a.customerName.localeCompare(b.customerName, undefined, { sensitivity: 'base' }))
            .map((c) => (
              <option key={c.id} value={c.id}>{c.customerName}</option>
            ))}
          <option value={MANUAL_ENTRY}>+ Add new customer…</option>
        </select>

        {/* Currency indicator for a linked international customer (manual entry
            shows its own country picker below). */}
        {isInternational && !isManualEntry && (
          <p className="mt-1 text-xs text-berry-700">
            International customer ({saleCountry}) — this sale is recorded in USD ($).
          </p>
        )}

        {/* New-customer entry: identity + optional contact, with a duplicate check
            and an explicit "Save to Customers" action. No type here — a customer
            has no type; the sale does (see the Sale Type field below). */}
        {isManualEntry && (
          <div className="mt-2 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <InputField
              label={FIELD.customerName.label}
              required
              autoFocus
              error={errors.customerName?.message}
              {...register('customerName')}
              placeholder={FIELD.customerName.placeholder}
            />

            {/* Country — Philippines (local, PHP) or another country (international, USD). */}
            <SelectField
              label="Country"
              options={COUNTRY_OPTIONS}
              value={saleCountry || PHILIPPINES}
              onChange={(e) => setValue('country', e.target.value, { shouldValidate: true, shouldDirty: true })}
              hint={isInternational ? 'International customer — this sale is recorded in USD ($).' : 'Local customer — this sale is recorded in PHP (₱).'}
            />

            {/* Notify when the typed name looks like an existing customer */}
            <EntityMatchSuggestions
              query={customerName}
              matches={nameMatches}
              exact={exactMatch}
              labelOf={(c) => c.customerName}
              keyOf={(c) => c.id}
              onUseExisting={linkExistingCustomer}
              noun="customer"
            />

            {/* Optional contact info. Hidden for online orders since those fields
                appear (required) in the block below. */}
            {!isOnlineOrder && (
              <div className="grid grid-cols-2 gap-2">
                <InputField label="Phone" type="tel" {...register('customerPhone')} placeholder="Optional" />
                <InputField label="FB Handler" {...register('customerFbMessenger')} placeholder="Optional" />
              </div>
            )}
            {!isOnlineOrder && (
              <InputField label="Address" {...register('customerAddress')} placeholder="Optional" />
            )}

            {/* Explicit save. Disabled when the name is empty or already matches an
                existing customer (use that one instead). */}
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-gray-500">
                {exactMatch
                  ? 'This customer already exists — pick them from the suggestion above.'
                  : 'Save this new customer to your Customers list.'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<UserPlus className="w-4 h-4" />}
                disabled={!customerName?.trim() || !!exactMatch}
                onClick={saveNewCustomer}
              >
                Save to Customers
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Sale Type — how THIS sale happened. A property of the sale, not the
          customer, so it's always shown regardless of who the sale is for. */}
      <CreatableSelect
        label="Sale Type"
        value={saleType}
        options={saleTypeOptions}
        onChange={(v) => setValue('saleType', v, { shouldValidate: true, shouldDirty: true })}
        onCreate={addSaleType}
        placeholder="Select sale type…"
        createLabel="+ Create new sale type…"
        newFieldLabel="New Sale Type"
        newFieldPlaceholder="e.g. Distributor"
      />

      {/* Online-order contact info — required when the sale type is Online Orders */}
      {isOnlineOrder && (
        <div className="p-3 bg-primary-50 border border-primary-100 rounded-lg space-y-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-primary-800">
            <AlertCircle className="w-4 h-4" />
            Online Order — contact number &amp; delivery address required
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InputField label="Contact Number" type="tel" required error={errors.customerPhone?.message} {...register('customerPhone')} placeholder="09xx xxx xxxx" />
            <InputField label="FB Handler" {...register('customerFbMessenger')} placeholder="Optional" />
          </div>
          <InputField label="Delivery Address" required error={errors.customerAddress?.message} {...register('customerAddress')} placeholder="Full delivery address" />
        </div>
      )}

      {/* ── Items ─────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            Items <span className="text-red-500">*</span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              icon={<PackagePlus className="w-3.5 h-3.5" />}
              onClick={() => setProductPickerOpen((o) => !o)}
            >
              Select products
            </Button>
          </div>
        </div>

        {/* Bulk product checklist — check several products to add them all as lines at once */}
        {productPickerOpen && (
          <div className="rounded-lg border border-gray-200 p-3 mb-2 space-y-3">
            {/* Filter dropdowns list only categories/varieties that have a real
                product in the store. Create-new routes to the New Product panel. */}
            <div className="flex items-end gap-2">
              <div className="grid flex-1 grid-cols-2 gap-3">
                <CreatableSelect
                  label="Category"
                  options={categoryOptions}
                  placeholder={categoryOptions.length ? 'All categories' : 'No categories yet'}
                  value={activeCategory}
                  onChange={(v) => { setActiveCategory(v); setActiveSubcategory(''); }}
                  onCreate={(v) => { setNewCategory(v.trim()); setNewSubcategory(''); setNewUnit(''); setCreateError(''); setShowCreateProduct(true); }}
                  createLabel="+ New product…"
                  newFieldLabel="New Category"
                  newFieldPlaceholder="e.g. Fruit"
                  hint="Optional — narrows the products below."
                />
                <CreatableSelect
                  label="Subcategory"
                  options={subcategoryOptions}
                  placeholder={
                    activeCategory
                      ? (subcategoryOptions.length ? 'All subcategories' : 'No products in this category')
                      : (subcategoryOptions.length ? 'All subcategories' : 'Pick a category first')
                  }
                  value={activeSubcategory}
                  onChange={(v) => setActiveSubcategory(v)}
                  onCreate={handleCreateSubcategory}
                  disabled={!activeCategory}
                  createLabel="+ New product…"
                  newFieldLabel="New Subcategory"
                  newFieldPlaceholder="e.g. Thai White"
                  hint={activeCategory ? 'Optional — scoped to the selected category.' : 'Select a category to enable.'}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<PackagePlus className="w-4 h-4" />}
                onClick={() => {
                  setNewCategory(activeCategory);
                  setNewSubcategory('');
                  setNewUnit('');
                  setCreateError('');
                  setShowCreateProduct((s) => !s);
                }}
              >
                New product
              </Button>
            </div>

            {/* Inline create-product panel — a new variety needs a default unit,
                captured here (mirrors the Expense Form's product picker). */}
            {showCreateProduct && (
              <div className="rounded-lg border border-primary-100 bg-primary-50 p-3 space-y-3">
                <p className="text-xs font-medium text-primary-700">
                  New product — identified by category + subcategory. Saved to Products (set the selling price on the line, or later in Products).
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <CreatableSelect
                    label="Category"
                    required
                    options={categoryOptions}
                    placeholder="Select category…"
                    value={newCategory}
                    onChange={(v) => { setNewCategory(v); setNewSubcategory(''); setCreateError(''); }}
                    onCreate={(v) => { const c = v.trim(); addEntry(c, ''); syncTaxonomy(c, ''); setNewCategory(c); setNewSubcategory(''); setCreateError(''); }}
                    createLabel="+ Add new category…"
                    newFieldLabel="New Category"
                    newFieldPlaceholder="e.g. Fruit"
                  />
                  <CreatableSelect
                    label="Subcategory"
                    required
                    options={newSubcategoryOptions}
                    placeholder={newCategory ? (newSubcategoryOptions.length ? 'Select or add…' : 'Add a subcategory…') : 'Pick a category first'}
                    value={newSubcategory}
                    onChange={(v) => { setNewSubcategory(v); setCreateError(''); }}
                    onCreate={(v) => { setNewSubcategory(v.trim()); setCreateError(''); }}
                    disabled={!newCategory}
                    createLabel="+ Add new subcategory…"
                    newFieldLabel="New Subcategory"
                    newFieldPlaceholder="e.g. Thai White"
                  />
                </div>
                <CreatableSelect
                  label="Unit"
                  options={unitOptions}
                  placeholder="Select or add…"
                  value={newUnit}
                  onChange={(v) => { setNewUnit(v); setCreateError(''); }}
                  onCreate={addUnit}
                  createLabel="+ Add new unit…"
                  newFieldLabel="New Unit"
                  newFieldPlaceholder="e.g. Piece"
                  hint={
                    newCategory && newSubcategory
                      ? `This will be saved as the default unit for ${categoryLabel(newCategory, newSubcategory)}.`
                      : 'This will be saved as the default unit for the new product.'
                  }
                />
                {createError && <p className="text-xs text-red-500">{createError}</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={resetCreateProduct}>Cancel</Button>
                  <Button type="button" size="sm" icon={<Plus className="w-4 h-4" />} onClick={handleCreateProduct}>
                    Add product
                  </Button>
                </div>
              </div>
            )}

            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {pickerEntries.length === 0 ? (
              <p className="text-xs text-gray-400">
                {products.length === 0
                  ? 'No products yet. Add products first.'
                  : (activeCategory || activeSubcategory || productSearch.trim())
                    ? 'No products match the current filters. Use "New product" to add one.'
                    : 'No products match your search.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto scrollbar-thin">
                {pickerEntries.map((entry) => {
                  // Out-of-stock products can't be sold — disable checking them
                  // (unless already on this sale, so an existing line stays
                  // uncheckable-to-removable).
                  const outOfStock = isOutOfStock(entry.product) && !isEntryChecked(entry);
                  return (
                  <label
                    key={entry.key}
                    className={[
                      'flex items-center gap-2 px-2 py-1.5 rounded-md text-sm',
                      outOfStock ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer',
                    ].join(' ')}
                    title={outOfStock ? 'No stock — add stock via Expenses or Propagation first.' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={isEntryChecked(entry)}
                      disabled={outOfStock}
                      onChange={() => toggleEntry(entry)}
                      className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 disabled:cursor-not-allowed"
                    />
                    <span className="flex-1 truncate text-gray-700">{entry.label}</span>
                    {outOfStock ? (
                      <span className="text-xs font-medium text-red-500">No stock</span>
                    ) : (
                      defaultUnitPrice(entry.product) > 0 && (
                        <span className="text-xs text-gray-400">{money(defaultUnitPrice(entry.product))}</span>
                      )
                    )}
                  </label>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-gray-400">
              Filter by category/subcategory or search, then check products to add them as lines (quantity defaults to 1 — adjust below). Uncheck to remove.
            </p>
          </div>
        )}

        {items.length === 0 && (
          <p className="text-xs text-gray-400 py-2">No items yet. Click "Select products" and check what's being sold — at least one is required.</p>
        )}
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item._key}>
              {(() => {
                const product = products.find((p) => p.id === item.productId);
                const isStock = isStockProduct(product);
                const isCutting = isCuttingProduct(product);
                return (
              <div className="grid grid-cols-12 gap-2 items-end p-2 bg-gray-50 rounded-lg">
                <div className="col-span-3 min-w-0">
                  <label className="text-xs text-gray-500 mb-0.5 block">Product</label>
                  <div className="px-2 py-1.5 text-sm text-gray-800 truncate" title={item.productName}>
                    {item.productName || '—'}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-0.5 block">
                    Qty *
                    {isStock && (() => {
                      const stock = availableStockOf(product);
                      return stock !== undefined ? (
                        <span className="text-gray-400 font-normal"> · {stock} in stock</span>
                      ) : null;
                    })()}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    max={isStock ? availableStockOf(product) : undefined}
                    value={item.quantity}
                    onChange={(e) => updateItem(item._key, 'quantity', parseFloat(e.target.value) || 0)}
                    className={[
                      'w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-primary-500',
                      itemErrors[item._key] && item.quantity <= 0 ? 'border-red-400 bg-red-50' : 'border-gray-300',
                    ].join(' ')}
                  />
                </div>
                <div className="col-span-1 min-w-0">
                  <label className="text-xs text-gray-500 mb-0.5 block">Unit</label>
                  <div
                    className="px-2 py-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded truncate"
                    title={product?.unit || 'No unit set'}
                  >
                    {product?.unit || '—'}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-0.5 block">{priceLabel} *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(item._key, 'unitPrice', parseFloat(e.target.value) || 0)}
                    className={[
                      'w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-primary-500',
                      itemErrors[item._key] && item.unitPrice <= 0 ? 'border-red-400 bg-red-50' : 'border-gray-300',
                    ].join(' ')}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-0.5 block" title="Per-unit surcharge (e.g. small-order cuttings fee)">
                    {currency === 'USD' ? 'Surcharge ($)' : 'Surcharge (₱)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.surcharge || 0}
                    onChange={(e) => updateItem(item._key, 'surcharge', parseFloat(e.target.value) || 0)}
                    disabled={!isCutting}
                    className={[
                      'w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-primary-500',
                      (item.surcharge || 0) > 0 ? 'border-gold-400 bg-gold-50' : 'border-gray-300',
                      !isCutting ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : '',
                    ].join(' ')}
                  />
                </div>
                <div className="col-span-1">
                  <label className="text-xs text-gray-500 mb-0.5 block">Total</label>
                  <div className="px-2 py-1.5 text-sm bg-white border border-gray-200 rounded font-medium text-leaf-700 truncate" title={money(lineTotal(item))}>
                    {money(lineTotal(item))}
                  </div>
                </div>
                <div className="col-span-1 flex justify-center">
                  <button
                    type="button"
                    onClick={() => removeItem(item._key)}
                    className="p-1 text-red-400 hover:text-red-600 rounded"
                    aria-label="Remove item"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
                );
              })()}
              {itemErrors[item._key] && (
                <p className="text-xs text-red-500 mt-1 ml-2">{itemErrors[item._key]}</p>
              )}
              {!itemErrors[item._key] && (() => {
                const product = products.find((p) => p.id === item.productId);
                if (!product) return null;
                // Compare against the default price in THIS sale's currency.
                const defaultPrice = currency === 'USD' ? product.sellingPriceUSD : product.sellingPricePHP;
                if (defaultPrice === 0 && item.unitPrice > 0) {
                  return (
                    <p className="text-xs text-primary-600 mt-1 ml-2">
                      This price will be saved as the default {currency === 'USD' ? '$' : '₱'} price for "{categoryLabel(product.category, product.subcategory)}".
                    </p>
                  );
                }
                if (defaultPrice > 0 && item.unitPrice !== defaultPrice) {
                  return (
                    <p className="text-xs text-gold-600 mt-1 ml-2">
                      Custom price for this sale (default is {money(defaultPrice)} — not changed).
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          ))}
        </div>
        {/* Small-order cuttings surcharge — a single page-level notice based on
            the COMBINED confirmed cutting quantity across all lines. */}
        {isSmallCuttingOrder && (() => {
          const cuttingLines = items.filter(
            (i) => isCuttingProduct(products.find((p) => p.id === i.productId)) && quantityEntered[i._key]
          );
          const anySurcharged = cuttingLines.some((i) => (i.surcharge || 0) > 0);
          return (
            <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-gold-200 bg-gold-50 p-2.5 text-xs text-gold-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {anySurcharged
                  ? `Small order — total cuttings (${totalCuttingQty}) under ${CUTTING_SMALL_ORDER_THRESHOLD}; +${formatPHP(CUTTING_SMALL_ORDER_SURCHARGE)}/unit surcharge applied. Edit a line's surcharge to discount, or add cuttings to reach ${CUTTING_SMALL_ORDER_THRESHOLD} to remove it.`
                  : `Small order — total cuttings (${totalCuttingQty}) under ${CUTTING_SMALL_ORDER_THRESHOLD}; surcharge waived on all cutting lines.`}
              </span>
            </div>
          );
        })()}
        {items.length > 0 && (
          <div className="flex justify-end mt-2 pr-10">
            <DisplayField label="Subtotal" value={money(subtotal)} highlight />
          </div>
        )}
      </div>

      {/* Payment — a paid sale captures method + details; an unpaid sale is
          "Pending payment" and flows to Outstanding until it's settled. */}
      <div>
        <CheckboxField
          label="Paid"
          checked={isPaid}
          onChange={handlePaidChange}
          hint={isPaid ? undefined : 'Leave unchecked to record as Pending payment (shows under Outstanding).'}
        />
        {isPaid ? (
          <div className="mt-3 grid grid-cols-2 gap-4">
            <SelectField label={FIELD.paymentMethod.label} required options={PAYMENT_OPTIONS} error={errors.paymentMethod?.message} {...register('paymentMethod')} />
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
            <span>Pending payment — this sale will show under Outstanding until it's marked paid.</span>
          </div>
        )}
      </div>

      {/* Sold By — salesperson for commission tracking (optional) */}
      {salespeople.length > 0 && (
        <div>
          <SelectField
            label="Sold By (salesperson)"
            options={[...salespeople]
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
              .map((s) => ({ value: s.id, label: `${s.name} — ${s.commission}% commission` }))}
            placeholder="None / not commissioned"
            {...register('soldByEmployeeId')}
          />
          {(() => {
            const sp = salespeople.find((s) => s.id === watch('soldByEmployeeId'));
            if (!sp) return null;
            const commission = subtotal * (sp.commission / 100);
            return (
              <p className="text-xs text-primary-600 mt-1">
                {sp.name} earns {money(commission)} ({sp.commission}% of {money(subtotal)}) — added to their commission bucket for {watch('date')}.
              </p>
            );
          })()}
        </div>
      )}

      {/* Fulfillment — shown for any sale with a resolvable product (all sold
          products are inventory-tracked). Marking received deducts the quantity
          from inventory (its `sold`, auto-creating the row if needed), and from
          Available Stock for Sale for cuttings. */}
      {hasStockItems && (
        <CheckboxField
          label="Received by Customer?"
          checked={isDelivered}
          onChange={setIsDelivered}
          hint="Marks the items as received by the customer and deducts them from inventory stock."
        />
      )}
      <TextareaField label={FIELD.notes.label} {...register('notes')} rows={2} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{sale ? 'Save Changes' : 'Record Sale'}</Button>
      </div>
    </form>

    <ConfirmDialog
      open={!!pendingFutureData}
      onClose={() => setPendingFutureData(null)}
      onConfirm={() => {
        if (pendingFutureData) doSave(pendingFutureData);
        setPendingFutureData(null);
      }}
      title="Future-dated sale"
      message={`This sale is dated ${pendingFutureData ? formatDate(pendingFutureData.date) : ''}, which is in the future. Record it as a future sale?`}
      confirmLabel="Yes, record it"
    />
    </>
  );
}
