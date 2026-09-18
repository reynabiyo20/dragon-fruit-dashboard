import { useMemo, useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { InventoryItem } from '../../types';
import { useInventoryStore } from '../../store/inventoryStore';
import { useProductStore } from '../../store/productStore';
import { useExpenseStore } from '../../store/expenseStore';
import { useVendorStore } from '../../store/vendorStore';
import { MANUAL_ENTRY } from '../../constants';
import { todayISO } from '../../utils/date';
import { InputField, TextareaField, DisplayField, CheckboxField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { Button } from '../../components/ui/Button';
import { DuplicateWarning } from '../../components/forms/DuplicateWarning';
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck';
import { formatNumber, categoryLabel } from '../../utils/format';
import { useInventoryCategoryStore, useUnitStore } from '../../store/optionStores';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { unlinkResellProduct } from '../../store/productLink';
import { INVENTORY_LINKED_TYPES } from '../../constants';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import { InventoryItemsPicker, emptyDraft, type InventoryDraft } from './InventoryItemsPicker';
import { ExistingProductsPicker, type ExistingSelection } from './ExistingProductsPicker';

/** Categories that are always sellable — they cascade into Products regardless. */
const ALWAYS_SELL_CATEGORIES = INVENTORY_LINKED_TYPES as readonly string[];

/**
 * Commit one inventory item + run its shared cascades (taxonomy registration and
 * the sellable-Products mirror). Used by both the single edit form and the
 * multi-add picker so their save behavior stays identical.
 */
function commitInventoryItem(
  data: { category: string; subcategory: string; unit: string; unitCost: number; beginningQty: number; sell: boolean; notes: string },
  deps: {
    addItem: ReturnType<typeof useInventoryStore.getState>['addItem'];
    findProduct: ReturnType<typeof useProductStore.getState>['findByCategorySub'];
    upsertSellableProduct: ReturnType<typeof useProductStore.getState>['upsertFromPurchase'];
  },
): void {
  const category = data.category.trim();
  const subcategory = data.subcategory.trim();

  if (category) syncTaxonomy(category, subcategory);

  deps.addItem({
    category, subcategory,
    unit: data.unit,
    beginningQty: data.beginningQty,
    purchased: 0, used: 0, sold: 0,
    unitCost: data.unitCost,
    notes: data.notes,
  });

  const shouldSell = (data.sell || ALWAYS_SELL_CATEGORIES.includes(category)) && !!subcategory;
  if (shouldSell) {
    deps.upsertSellableProduct({ category, subcategory, unit: data.unit, costPHP: data.unitCost });
  } else if (!data.sell && subcategory && !ALWAYS_SELL_CATEGORIES.includes(category)) {
    unlinkResellProduct(category, subcategory);
  }
}

/**
 * Commit one BOUGHT inventory draft by recording it as an Expense. The expense
 * store's inventory cascade (recordExpenseInventory) creates/updates the item's
 * inventory row `purchased` pool, feeds price history and vendor supplies — so
 * we do NOT also set a beginning qty (that would double-count the stock). The
 * sellable-Products mirror is applied here since the expense path doesn't do it
 * for non-always-sell categories. A manually-typed vendor is created/reused.
 */
function commitBoughtItem(
  draft: InventoryDraft,
  deps: {
    addExpense: ReturnType<typeof useExpenseStore.getState>['addExpense'];
    vendors: ReturnType<typeof useVendorStore.getState>['vendors'];
    addVendor: ReturnType<typeof useVendorStore.getState>['addVendor'];
    addSupply: ReturnType<typeof useVendorStore.getState>['addSupply'];
    upsertSellableProduct: ReturnType<typeof useProductStore.getState>['upsertFromPurchase'];
  },
): void {
  const category = draft.category.trim();
  const subcategory = draft.subcategory.trim();
  const quantity = Number(draft.beginningQty) || 0;
  const unitPrice = Number(draft.unitCost) || 0;

  if (category) syncTaxonomy(category, subcategory);

  // ── Resolve the vendor (select existing, reuse by name, or create) ──────────
  let vendorId = draft.vendorId === MANUAL_ENTRY ? '' : draft.vendorId;
  let vendorName = draft.vendorName.trim();
  if (draft.vendorId === MANUAL_ENTRY && vendorName) {
    const existing = deps.vendors.find((v) => v.vendor.trim().toLowerCase() === vendorName.toLowerCase());
    if (existing) {
      vendorId = existing.id;
      vendorName = existing.vendor;
    } else {
      const created = deps.addVendor({
        vendor: vendorName,
        contact: '',
        phone: '',
        supplies: subcategory ? [{ category, subcategory }] : [],
        notes: '',
      });
      vendorId = created.id;
    }
  } else if (vendorId) {
    vendorName = deps.vendors.find((v) => v.id === vendorId)?.vendor ?? vendorName;
  }

  // Record the purchase as an expense. This cascades into inventory `purchased`
  // (auto-creating the row with this unit + cost), price history and totals.
  deps.addExpense({
    date: draft.purchaseDate || todayISO(),
    vendorId,
    vendorName,
    category,
    subcategory,
    description: '',
    quantity,
    unit: draft.unit,
    unitPrice,
    amount: quantity * unitPrice,
    paymentMethod: draft.paymentMethod || 'Cash',
    paid: draft.paid,
    accountingClassification: draft.accountingClassification,
    expenseType: draft.expenseType,
    notes: draft.notes,
  });

  // Keep the vendor's supply catalog accurate (silent no-op if already present).
  if (vendorId && category && subcategory) deps.addSupply(vendorId, category, subcategory);

  // Mirror into sellable Products when flagged (or always-sell category).
  const shouldSell = (draft.sell || ALWAYS_SELL_CATEGORIES.includes(category)) && !!subcategory;
  if (shouldSell) {
    deps.upsertSellableProduct({ category, subcategory, unit: draft.unit, costPHP: unitPrice });
  } else if (!draft.sell && subcategory && !ALWAYS_SELL_CATEGORIES.includes(category)) {
    unlinkResellProduct(category, subcategory);
  }
}

const schema = z.object({
  subcategory: z.string().min(1, 'Variety / item is required'),
  category: z.string().min(1, 'Type is required'),
  unit: z.string().min(1, 'Unit is required'),
  beginningQty: z.coerce.number().min(0),
  purchased: z.coerce.number().min(0),
  used: z.coerce.number().min(0),
  sold: z.coerce.number().min(0),
  unitCost: z.coerce.number().min(0),
  notes: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface InventoryFormProps { item: InventoryItem | null; onClose: () => void; }

/**
 * Entry point: adding shows the multi-item picker (add several at once), editing
 * shows the single-item form. This keeps bulk entry fast while leaving the
 * detailed per-item edit (with duplicate hints + ending-qty guard) intact.
 */
export function InventoryForm({ item, onClose }: InventoryFormProps) {
  if (item) return <InventoryEditForm item={item} onClose={onClose} />;
  return <InventoryAddForm onClose={onClose} />;
}

type AddTab = 'existing' | 'new';

/**
 * Add flow with two tabs:
 *  - Existing Products: multi-select from the Products catalog; each pick gets a
 *    beginning qty (+ Add-to/Set-to for products already stocked) and unit cost.
 *  - New Product: the multi-row builder for items that don't exist yet.
 * Both tabs commit on save and cascade to inventory + taxonomy + sellable products.
 */
function InventoryAddForm({ onClose }: { onClose: () => void }) {
  const addItem = useInventoryStore((s) => s.addItem);
  const updateItem = useInventoryStore((s) => s.updateItem);
  const findInventory = useInventoryStore((s) => s.findByCategorySub);
  const findProduct = useProductStore((s) => s.findByCategorySub);
  const upsertSellableProduct = useProductStore((s) => s.upsertFromPurchase);
  const addExpense = useExpenseStore((s) => s.addExpense);
  const vendors = useVendorStore((s) => s.vendors);
  const addVendor = useVendorStore((s) => s.addVendor);
  const addSupply = useVendorStore((s) => s.addSupply);

  const [tab, setTab] = useState<AddTab>('existing');
  const [selections, setSelections] = useState<Record<string, ExistingSelection>>({});
  const [drafts, setDrafts] = useState<InventoryDraft[]>([emptyDraft()]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedExisting = Object.values(selections);
  const filledDrafts = drafts.filter((d) => d.category.trim() && d.subcategory.trim());

  /** Apply one selected existing product to its inventory row (add or set). */
  const commitExisting = (sel: ExistingSelection) => {
    // Products are always sellable stock; ensure the taxonomy is registered.
    syncTaxonomy(sel.category, sel.subcategory);
    const existing = findInventory(sel.category, sel.subcategory);
    if (existing && sel.mode === 'set') {
      // Replace beginning qty directly (bypasses addItem's additive merge).
      updateItem(existing.id, {
        beginningQty: sel.beginningQty,
        unit: existing.unit || sel.unit,
        unitCost: sel.unitCost > 0 ? sel.unitCost : existing.unitCost,
      });
    } else {
      // No row yet, or "Add to" → addItem merges additively into any existing row.
      addItem({
        category: sel.category,
        subcategory: sel.subcategory,
        unit: sel.unit,
        beginningQty: sel.beginningQty,
        purchased: 0, used: 0, sold: 0,
        unitCost: sel.unitCost,
        notes: '',
      });
    }
  };

  const handleSubmit = () => {
    const bothEmpty = selectedExisting.length === 0 && filledDrafts.length === 0;
    if (bothEmpty) {
      setError('Select at least one existing product, or add a new item.');
      return;
    }
    const badExisting = selectedExisting.find((s) => s.beginningQty < 0);
    if (badExisting) {
      setError(`Beginning Qty can't be negative (check "${badExisting.subcategory}").`);
      return;
    }
    const badDraft = filledDrafts.find((d) => d.beginningQty < 0);
    if (badDraft) {
      setError(`Beginning Qty can't be negative (check "${badDraft.subcategory}").`);
      return;
    }
    // A bought item needs a positive quantity so the recorded expense is real.
    const badBought = filledDrafts.find((d) => d.bought && (Number(d.beginningQty) || 0) <= 0);
    if (badBought) {
      setError(`Enter the quantity bought for "${badBought.subcategory}" (greater than 0).`);
      return;
    }

    setSubmitting(true);
    selectedExisting.forEach(commitExisting);
    // Split by purchase intent: bought items become Expenses (which cascade into
    // inventory `purchased`), the rest seed opening stock via beginning qty.
    filledDrafts.forEach((d) => {
      if (d.bought) {
        commitBoughtItem(d, { addExpense, vendors, addVendor, addSupply, upsertSellableProduct });
      } else {
        commitInventoryItem(d, { addItem, findProduct, upsertSellableProduct });
      }
    });
    const boughtCount = filledDrafts.filter((d) => d.bought).length;
    const total = selectedExisting.length + filledDrafts.length;
    toast.success(`Added ${total} item${total !== 1 ? 's' : ''} to inventory`);
    if (boughtCount > 0) {
      toast.success(`Recorded ${boughtCount} purchase${boughtCount !== 1 ? 's' : ''} as expense${boughtCount !== 1 ? 's' : ''}`, { icon: '🧾', duration: 4000 });
    }
    onClose();
  };

  const totalToAdd = selectedExisting.length + filledDrafts.length;

  const tabClass = (active: boolean) => [
    'flex-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
    active
      ? 'border-primary-600 text-primary-700'
      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
  ].join(' ');

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button type="button" className={tabClass(tab === 'existing')} onClick={() => setTab('existing')}>
          Existing Products{selectedExisting.length > 0 ? ` (${selectedExisting.length})` : ''}
        </button>
        <button type="button" className={tabClass(tab === 'new')} onClick={() => setTab('new')}>
          New Product{filledDrafts.length > 0 ? ` (${filledDrafts.length})` : ''}
        </button>
      </div>

      {tab === 'existing' ? (
        <ExistingProductsPicker selections={selections} onChange={(s) => { setSelections(s); setError(''); }} />
      ) : (
        <>
          <InventoryItemsPicker drafts={drafts} onChange={(d) => { setDrafts(d); setError(''); }} />
          <p className="text-xs text-gray-400">
            Adding an item that already exists (same Type + Variety) merges its quantity into the existing row.
          </p>
        </>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="button" loading={submitting} onClick={handleSubmit} disabled={totalToAdd === 0}>
          Add {totalToAdd || ''} Item{totalToAdd === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}

/** Single-item edit form (the original detailed form with duplicate hints). */
function InventoryEditForm({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { items, updateItem } = useInventoryStore();
  // Product store is the source of truth for a variety's unit + cost, and the
  // target when this item is flagged sellable.
  const findProduct = useProductStore((s) => s.findByCategorySub);
  const upsertSellableProduct = useProductStore((s) => s.upsertFromPurchase);
  const categoryValues = useInventoryCategoryStore((s) => s.values);
  const addCategory = useInventoryCategoryStore((s) => s.add);
  const unitValues = useUnitStore((s) => s.values);
  const addUnit = useUnitStore((s) => s.add);
  const unitOptions = unitValues.map((v) => ({ value: v, label: v }));
  const isEditing = !!item;

  // "Do you sell this?" — when on, the item is mirrored into Products for sale.
  // Defaults on when editing an item that already has a matching product (or
  // whose category is always sellable), so the checkbox reflects reality.
  const [sell, setSell] = useState(
    !!item &&
      (!!findProduct(item.category, item.subcategory) ||
        ALWAYS_SELL_CATEGORIES.includes(item.category.trim())),
  );

  // Category dropdown = the inventory categories unioned with product types, so
  // Cuttings/Fruit/Fertilizer line up with products while inventory-only
  // categories (Packing Material, Tools…) remain available.
  const categoryEntries = useProductCategoryStore((s) => s.entries);
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>(categoryValues);
    categoryEntries.forEach((e) => seen.add(e.category));
    return Array.from(seen).sort().map((v) => ({ value: v, label: v }));
  }, [categoryValues, categoryEntries]);

  const { register, handleSubmit, control, setValue, watch, setError, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      subcategory: item?.subcategory ?? '',
      category: item?.category ?? '',
      unit: item?.unit ?? 'piece',
      beginningQty: item?.beginningQty ?? 0,
      purchased: item?.purchased ?? 0,
      used: item?.used ?? 0,
      sold: item?.sold ?? 0,
      unitCost: item?.unitCost ?? 0,
      notes: item?.notes ?? '',
    },
  });

  const beginningQty = Number(useWatch({ control, name: 'beginningQty' })) || 0;
  // Purchased / Used / Sold are cascade-driven and no longer edited in this form,
  // but still carried through on submit. Packed / Needs Packing come from the
  // existing item. All feed the ending-qty preview so it matches the table.
  const purchased = Number(useWatch({ control, name: 'purchased' })) || 0;
  const used = Number(useWatch({ control, name: 'used' })) || 0;
  const sold = Number(useWatch({ control, name: 'sold' })) || 0;
  const packedPools = (item?.packed ?? 0) + (item?.needsPacking ?? 0);
  const endingQty = beginningQty + purchased - used - sold + packedPools;

  // Variety options for the selected category, sourced from the product
  // taxonomy. Inventory-only categories simply have none, so Item stays free text.
  const selectedCategory = watch('category');
  const itemOptions = useMemo(() => {
    if (!selectedCategory) return [];
    const subs = categoryEntries
      .filter((e) => e.category === selectedCategory && e.subcategory !== '')
      .map((e) => e.subcategory);
    return [...new Set(subs)].sort().map((v) => ({ value: v, label: v }));
  }, [categoryEntries, selectedCategory]);

  // Duplicate detection on item + category identity
  const [itemName, category] = useWatch({ control, name: ['subcategory', 'category'] });

  // Default unit + unit cost from the Product store (source of truth, in sync
  // with Settings) once a (category, variety) is selected — only when adding, so
  // it never overwrites a saved item's values. Editable afterwards.
  useEffect(() => {
    if (item) return;                       // don't prefill when editing
    if (!selectedCategory || !itemName?.trim()) return;
    const product = findProduct(selectedCategory, itemName);
    if (!product) return;
    if (product.unit) setValue('unit', product.unit, { shouldValidate: true, shouldDirty: true });
    if (product.costPHP > 0) setValue('unitCost', product.costPHP, { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, itemName]);
  // A "duplicate" only matters at the full identity (category + variety) level,
  // and only within the SAME category — the category alone (e.g. "Construction
  // Material") must never trigger a warning. So we scope candidates to rows in
  // the selected category and compare the VARIETY only. An exact variety match
  // is a valid selection that `addItem` merges, so it's excluded too — the
  // warning surfaces only for a near-duplicate variety typed within the category.
  const norm = (s: string) => s.trim().toLowerCase();
  const varietyKey = norm(itemName ?? '');
  const sameCategoryCandidates = (item ? items.filter((i) => i.id !== item.id) : items).filter(
    (i) => !!category?.trim() && norm(i.category) === norm(category) && norm(i.subcategory) !== varietyKey,
  );
  const rawDuplicates = useDuplicateCheck(
    sameCategoryCandidates,
    [{ label: 'variety / item', value: itemName ?? '', of: (i) => i.subcategory }],
    !isEditing,
    3
  );
  // Require a real variety before warning — selecting only a Type is not a dup.
  const duplicates = varietyKey.length >= 2 ? rawDuplicates : [];

  const onSubmit = (data: FormValues) => {
    const category = data.category.trim();
    const subcategory = data.subcategory.trim();

    // ── Ending qty must stay ≥ 0 ──────────────────────────────────────────────
    // Purchased / Used / Sold are cascade-driven and carried through unchanged;
    // only Beginning Qty is set here. Guard against lowering Beginning so far that
    // ending qty goes negative (given the existing purchased/used/sold and the
    // cutting pools). The error surfaces on Beginning Qty, the field being edited.
    const packedPools = (item?.packed ?? 0) + (item?.needsPacking ?? 0);
    const endingIfSaved =
      data.beginningQty + data.purchased - data.used - data.sold + packedPools;
    if (endingIfSaved < 0) {
      const minBeginning = data.beginningQty - endingIfSaved; // beginning that yields ending 0
      setError('beginningQty', {
        type: 'manual',
        message: `Too low — Beginning Qty must be at least ${minBeginning} so ending qty isn't negative.`,
      });
      return;
    }

    // Register the (category, subcategory) in the shared taxonomies so an item
    // added here is selectable in Products, Sales and Expenses too.
    if (category) syncTaxonomy(data.category, data.subcategory);

    updateItem(item.id, data); toast.success('Item updated');

    // Product cascade: if we sell this (or it's an always-sell category), mirror
    // it into Products for sale — seeding cost from this item's unit cost and
    // leaving the selling price for the user. Uncheck on edit removes the
    // auto-created product if it's safe (no price set, never sold); inventory is
    // never touched.
    const shouldSell = (sell || ALWAYS_SELL_CATEGORIES.includes(category)) && !!subcategory;
    if (shouldSell) {
      const existed = !!findProduct(category, subcategory);
      upsertSellableProduct({
        category,
        subcategory,
        unit: data.unit,
        costPHP: data.unitCost,
      });
      if (!existed) {
        toast.success(`Added "${categoryLabel(category, subcategory)}" to Products for sale`, { duration: 4000 });
      }
    } else if (!sell && subcategory && !ALWAYS_SELL_CATEGORIES.includes(category)) {
      const result = unlinkResellProduct(category, subcategory);
      if (result === 'removed') {
        toast(`Removed "${categoryLabel(category, subcategory)}" from Products for sale (kept in Inventory)`, { icon: '↩️', duration: 4000 });
      } else if (result === 'kept-sold') {
        toast(`"${categoryLabel(category, subcategory)}" stays in Products — it has sales on record`, { icon: 'ℹ️', duration: 4000 });
      }
    }

    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {!isEditing && (
        <DuplicateWarning
          matches={duplicates}
          atLimit={duplicates.length >= 5}
          labelOf={(i) => `${i.subcategory} · ${i.category}`}
          keyOf={(i) => i.id}
          noun="item"
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <CreatableSelect
            label="Type"
            required
            value={watch('category')}
            options={categoryOptions}
            onChange={(v) => {
              setValue('category', v, { shouldValidate: true, shouldDirty: true });
              // Reset the variety/item when the type changes so a Cuttings
              // variety doesn't linger after switching to, say, Packing Material.
              setValue('subcategory', '', { shouldDirty: true });
            }}
            onCreate={(v) => { addCategory(v); syncTaxonomy(v, ''); }}
            placeholder="Select…"
            error={errors.category?.message}
            createLabel="+ Create new type…"
            newFieldLabel="New Type"
            newFieldPlaceholder="e.g. Irrigation"
          />
          <SimilarEntryHint
            value={category ?? ''}
            options={categoryOptions.map((o) => o.value)}
            noun="type"
            onPick={(v) => setValue('category', v, { shouldValidate: true, shouldDirty: true })}
          />
        </div>
        <div>
          <CreatableSelect
            label="Variety / Item"
            required
            value={watch('subcategory')}
            options={itemOptions}
            onChange={(v) => setValue('subcategory', v, { shouldValidate: true, shouldDirty: true })}
            onCreate={(v) => {
              setValue('subcategory', v, { shouldValidate: true, shouldDirty: true });
              if (selectedCategory) syncTaxonomy(selectedCategory, v);
            }}
            disabled={!selectedCategory}
            placeholder={
              selectedCategory
                ? itemOptions.length > 0
                  ? 'Select variety…'
                  : 'Type item name…'
                : 'Pick a type first'
            }
            error={errors.subcategory?.message}
            createLabel="+ Enter variety / item…"
            newFieldLabel="Variety / Item"
            newFieldPlaceholder="e.g. Scotch Tape"
          />
          {selectedCategory && (
            <SimilarEntryHint
              value={itemName ?? ''}
              options={itemOptions.map((o) => o.value)}
              noun="variety / item"
              onPick={(v) => setValue('subcategory', v, { shouldValidate: true, shouldDirty: true })}
            />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <CreatableSelect
          label="Unit"
          required
          value={watch('unit')}
          options={unitOptions}
          onChange={(v) => setValue('unit', v, { shouldValidate: true, shouldDirty: true })}
          onCreate={addUnit}
          error={errors.unit?.message}
          createLabel="+ Create new unit…"
          newFieldLabel="New Unit"
          newFieldPlaceholder="e.g. crate"
        />
        <InputField label="Unit Cost (₱)" type="number" step="0.01" error={errors.unitCost?.message} {...register('unitCost')} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Beginning Qty" type="number" step="0.01" error={errors.beginningQty?.message} {...register('beginningQty')} />
      </div>

      {/* Purchased, Sold and Used are driven by their cascades — Expenses add to
          Purchased, received Sales add to Sold, and the "Record Usage" action on
          the Inventory table logs Used with a date + note. They're not editable
          here; only Beginning Qty is set directly. */}
      {isEditing && (
        <p className="text-xs text-gray-400">
          Purchased {formatNumber(item?.purchased ?? 0, 2)} · Sold {formatNumber(item?.sold ?? 0, 2)} · Used {formatNumber(item?.used ?? 0, 2)}
          {' '}— updated automatically from Expenses, Sales and Record Usage.
        </p>
      )}

      {/* Auto-calculated ending qty */}
      <div className="p-3 bg-primary-50 rounded-lg border border-primary-100">
        <DisplayField
          label="Ending Qty (auto = Beginning + Purchased − Used − Sold + Packed)"
          value={formatNumber(endingQty, 2)}
          highlight
        />
      </div>

      <CheckboxField
        label="Do you sell this?"
        checked={sell}
        onChange={setSell}
        hint="Adds it to Products for sale so it can be sold in Sales, seeding the cost from this item. Set the selling price in Products."
      />

      <TextareaField label="Notes" {...register('notes')} rows={2} error={errors.notes?.message} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{item ? 'Save Changes' : 'Add Item'}</Button>
      </div>
    </form>
  );
}
