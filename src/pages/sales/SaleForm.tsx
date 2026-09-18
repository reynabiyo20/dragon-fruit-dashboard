import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2, AlertCircle, UserPlus, PackagePlus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Sale, SaleItem, Customer } from '../../types';
import { useSaleStore } from '../../store/saleStore';
import { useCustomerStore } from '../../store/customerStore';
import { useProductStore } from '../../store/productStore';
import { useEmployeeStore } from '../../store/employeeStore';
import { useCommissionStore } from '../../store/commissionStore';
import { useCuttingStore } from '../../store/cuttingStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useEntityMatch } from '../../hooks/useEntityMatch';
import { EntityMatchSuggestions } from '../../components/forms/EntityMatchSuggestions';
import { InputField, SelectField, TextareaField, CheckboxField, DisplayField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useSaleTypeStore } from '../../store/optionStores';
import { formatPHP, formatDate, categoryLabel } from '../../utils/format';
import { isFutureDate, todayISO } from '../../utils/date';
import { generateId } from '../../utils/id';
import {
  PAYMENT_OPTIONS, METHODS_REQUIRING_DETAILS, MANUAL_ENTRY, ONLINE_ORDERS,
  CUTTINGS_PRODUCT_TYPE, CUTTING_SMALL_ORDER_THRESHOLD, CUTTING_SMALL_ORDER_SURCHARGE,
  CUTTING_TYPE_GRAFTED,
} from '../../constants';
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
    date: z.string().min(1, 'Date is required'),
    invoiceNumber: z.string(),
    customerId: z.string(),
    customerName: z.string().min(1, 'Customer is required'),
    // How this sale happened (walk-in, online, …)
    saleType: z.string(),
    // Online-order contact fields (validated conditionally below)
    customerPhone: z.string(),
    customerFbMessenger: z.string(),
    customerAddress: z.string(),
    paymentMethod: z.string().min(1, 'Payment method is required'),
    paymentDetails: z.string(),
    paid: z.boolean(),
    soldByEmployeeId: z.string(),
    notes: z.string(),
  })
  // Payment details required for certain methods
  .refine(
    (d) => !METHODS_REQUIRING_DETAILS.includes(d.paymentMethod) || d.paymentDetails.trim().length > 0,
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
  const { addSale, updateSale } = useSaleStore();
  const { customers, addCustomer } = useCustomerStore();
  // Editable sale-type list (walk-in, online, …), shared with Settings
  const saleTypeValues = useSaleTypeStore((s) => s.values);
  const addSaleType = useSaleTypeStore((s) => s.add);
  const saleTypeOptions = saleTypeValues.map((v) => ({ value: v, label: v }));
  const { products } = useProductStore();
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

  // Salespeople = employees with a commission % > 0
  const salespeople = employees.filter((e) => e.commission > 0);

  // Build initial line items once, assigning a stable _key to each. We also
  // capture which lines carry a custom (overridden) surcharge so a saved
  // discount isn't reset by the aggregate rule on edit.
  const [initialItems, initialOverrides] = (() => {
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
    const seeded: Record<string, boolean> = {};
    initialItems.forEach((r) => { seeded[r._key] = true; });
    return seeded;
  });
  const [isPaid, setIsPaid] = useState(sale?.paid ?? false);
  const [isDelivered, setIsDelivered] = useState(sale?.delivered ?? false);
  // Per-item validation errors keyed by _key
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  // Bulk product-picker (checklist) open state + search filter
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  // Holds validated form data pending a future-date confirmation (null = none)
  const [pendingFutureData, setPendingFutureData] = useState<FormValues | null>(null);

  const productLabel = (p: Product) => categoryLabel(p.category, p.subcategory);
  // Products for the bulk checklist, sorted by label and filtered by the search box.
  const pickerProducts = products
    .map((p) => ({ product: p, label: productLabel(p) }))
    .filter(({ label }) => label.toLowerCase().includes(productSearch.trim().toLowerCase()))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

  // Resolve the original customer (for prefilling online-order contact fields)
  const existingCustomer = sale ? customers.find((c) => c.id === sale.customerId) : undefined;

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: sale?.date ?? todayISO(),
      invoiceNumber: sale?.invoiceNumber ?? '',
      customerId: sale?.customerId ?? '',
      customerName: sale?.customerName ?? '',
      customerPhone: existingCustomer?.phone ?? '',
      customerFbMessenger: existingCustomer?.fbMessengerName ?? '',
      customerAddress: existingCustomer?.address ?? '',
      saleType: sale?.saleType ?? '',
      paymentMethod: sale?.paymentMethod ?? 'Cash',
      paymentDetails: sale?.paymentDetails ?? '',
      paid: sale?.paid ?? false,
      soldByEmployeeId: sale?.soldByEmployeeId ?? '',
      notes: sale?.notes ?? '',
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
  const paymentDetailsRequired = METHODS_REQUIRING_DETAILS.includes(paymentMethod);
  const isManualEntry = selectedCustomerId === MANUAL_ENTRY;

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
  /** Add a product as a new line pre-filled from the catalog (qty 1, default price). */
  const addProductLine = (product: Product) => {
    const key = generateId();
    setItems((prev) => {
      const quantity = 1;
      const unitPrice = product.sellingPricePHP;
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
            : 'None in stock — add stock via Expenses or the Cuttings Store first.';
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
            updated.unitPrice = product.sellingPricePHP;
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
        if (stock !== undefined && !alreadyAccounted && i.quantity > stock) {
          errs[i._key] = stock > 0
            ? `Only ${stock} in stock (you entered ${i.quantity}).`
            : 'None in stock — add stock via Expenses or the Cuttings Store first.';
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
    } else {
      const customer = customers.find((c) => c.id === val);
      setValue('customerName', customer?.customerName ?? '');
      setValue('customerPhone', customer?.phone ?? '');
      setValue('customerFbMessenger', customer?.fbMessengerName ?? '');
      setValue('customerAddress', customer?.address ?? '');
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
    // ── Price learning ────────────────────────────────────────────────────────
    // For any product that has NO selling price set yet (₱0), save the unit price
    // entered here back to the product record so it auto-fills next time.
    // Products that already have a price are left untouched — the entered price is
    // treated as a per-sale override (e.g. a discount for a specific customer).
    const learnedProducts: string[] = [];
    // Read the live store state (not the render-time snapshot) so the lookup and
    // write always target the current product record.
    const { products: liveProducts, updateProduct: liveUpdateProduct } = useProductStore.getState();
    items.forEach((item) => {
      if (!item.productId) return;
      const product = liveProducts.find((p) => p.id === item.productId);
      if (product && product.sellingPricePHP === 0 && item.unitPrice > 0) {
        liveUpdateProduct(product.id, { sellingPricePHP: item.unitPrice });
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
      saleType: data.saleType,
      paymentMethod: data.paymentMethod,
      paymentDetails: data.paymentDetails,
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
      toast.success('Sale updated');
    } else {
      const created = addSale(payload as Parameters<typeof addSale>[0]);
      saleId = created.id;
      toast.success('Sale recorded');
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
      toast('Logged to Cuttings Store', { icon: '🌱', duration: 3000 });
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

    onClose();
  };

  return (
    <>
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Date" type="date" required error={errors.date?.message} {...register('date')} />
        <InputField label="Invoice #" {...register('invoiceNumber')} placeholder="Auto or manual" />
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

        {/* New-customer entry: identity + optional contact, with a duplicate check
            and an explicit "Save to Customers" action. No type here — a customer
            has no type; the sale does (see the Sale Type field below). */}
        {isManualEntry && (
          <div className="mt-2 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <InputField
              label="Customer Name"
              required
              autoFocus
              error={errors.customerName?.message}
              {...register('customerName')}
              placeholder="Type customer name…"
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
          <div className="rounded-lg border border-gray-200 p-3 mb-2 space-y-2">
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {pickerProducts.length === 0 ? (
              <p className="text-xs text-gray-400">
                {products.length === 0 ? 'No products yet. Add products first.' : 'No products match your search.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto scrollbar-thin">
                {pickerProducts.map(({ product, label }) => (
                  <label
                    key={product.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedProductIds.has(product.id)}
                      onChange={() => toggleProduct(product)}
                      className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    <span className="flex-1 truncate text-gray-700">{label}</span>
                    {product.sellingPricePHP > 0 && (
                      <span className="text-xs text-gray-400">{formatPHP(product.sellingPricePHP)}</span>
                    )}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400">
              Check products to add them as lines (quantity defaults to 1 — adjust below). Uncheck to remove.
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
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-0.5 block">Unit Price (₱) *</label>
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
                    Surcharge (₱)
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
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 mb-0.5 block">Total</label>
                  <div className="px-2 py-1.5 text-sm bg-white border border-gray-200 rounded font-medium text-leaf-700">
                    {formatPHP(lineTotal(item))}
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
                if (product.sellingPricePHP === 0 && item.unitPrice > 0) {
                  return (
                    <p className="text-xs text-primary-600 mt-1 ml-2">
                      This price will be saved as the default for "{categoryLabel(product.category, product.subcategory)}".
                    </p>
                  );
                }
                if (product.sellingPricePHP > 0 && item.unitPrice !== product.sellingPricePHP) {
                  return (
                    <p className="text-xs text-gold-600 mt-1 ml-2">
                      Custom price for this sale (default is {formatPHP(product.sellingPricePHP)} — not changed).
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
            <DisplayField label="Subtotal" value={formatPHP(subtotal)} highlight />
          </div>
        )}
      </div>

      {/* Payment */}
      <div className="grid grid-cols-2 gap-4">
        <SelectField label="Payment Method" required options={PAYMENT_OPTIONS} error={errors.paymentMethod?.message} {...register('paymentMethod')} />
        <InputField
          label="Payment Details"
          required={paymentDetailsRequired}
          error={errors.paymentDetails?.message}
          {...register('paymentDetails')}
          placeholder={paymentDetailsRequired ? 'e.g. BPI account / ref #' : 'Optional'}
          hint={paymentDetailsRequired ? 'Required for this payment method' : undefined}
        />
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
                {sp.name} earns {formatPHP(commission)} ({sp.commission}% of {formatPHP(subtotal)}) — added to their commission bucket for {watch('date')}.
              </p>
            );
          })()}
        </div>
      )}

      <CheckboxField label="Paid" checked={isPaid} onChange={setIsPaid} />

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
      <TextareaField label="Notes" {...register('notes')} rows={2} />

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
