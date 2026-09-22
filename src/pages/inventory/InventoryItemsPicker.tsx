import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useProductStore } from '../../store/productStore';
import { useVendorStore } from '../../store/vendorStore';
import {
  useUnitStore,
  useAccountingClassificationStore, useExpenseTypeStore,
} from '../../store/optionStores';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { InputField, SelectField, CheckboxField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import { Button } from '../../components/ui/Button';
import { INVENTORY_LINKED_TYPES, PAYMENT_OPTIONS, MANUAL_ENTRY, CUTTINGS_PRODUCT_TYPE } from '../../constants';
import type { CuttingPurchaseState } from '../../types';
import { todayISO } from '../../utils/date';
import { formatQty } from '../../utils/format';

/** Categories that are always sellable — they cascade into Products regardless. */
const ALWAYS_SELL_CATEGORIES = INVENTORY_LINKED_TYPES as readonly string[];

/** True when a category tracks packed/bare condition (Cuttings). */
const isCuttingCategory = (category: string): boolean =>
  category.trim().toLowerCase() === CUTTINGS_PRODUCT_TYPE.toLowerCase();

/** One draft inventory row being built in the multi-add flow. */
export interface InventoryDraft {
  /** Stable key for React lists (not persisted). */
  key: string;
  category: string;
  subcategory: string;
  unit: string;
  unitCost: number;
  beginningQty: number;
  /** Whether to mirror this item into the sellable Products list. */
  sell: boolean;
  /**
   * Cuttings only (BOUGHT path): whether the purchase arrives packed (Ready for
   * Sale) or bare (Needs Packing). Drives the expense→inventory pool. Ignored for
   * other categories. Defaults to 'packed'.
   */
  cuttingState: CuttingPurchaseState;
  /**
   * Cuttings only (OPENING-STOCK path): how many of `beginningQty` are already
   * packed & Ready for Sale. The remainder (beginningQty − packedQty) is treated
   * as Needs Packing. Clamped to [0, beginningQty]. Ignored for other categories
   * and for the bought path (which uses `cuttingState`).
   */
  packedQty: number;
  notes: string;
  /**
   * Whether this item was bought (a purchase) rather than existing opening
   * stock. When true, the row is recorded as an Expense on save — cascading into
   * expense tracking, price history, vendor supplies, and inventory `purchased`
   * — and the accounting fields below apply. When false, the `beginningQty`
   * seeds the row as opening stock with no expense.
   */
  bought: boolean;
  /** Purchase-only fields (used when `bought` is true). */
  vendorName: string;
  vendorId: string;
  purchaseDate: string;        // ISO date the purchase happened
  paymentMethod: string;
  paid: boolean;
  accountingClassification: string;
  expenseType: string;
}

/** Create a fresh, empty draft row. */
export function emptyDraft(): InventoryDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: '',
    subcategory: '',
    unit: 'piece',
    unitCost: 0,
    beginningQty: 0,
    sell: false,
    cuttingState: 'packed',
    packedQty: 0,
    notes: '',
    bought: false,
    vendorName: '',
    vendorId: '',
    purchaseDate: todayISO(),
    paymentMethod: 'Cash',
    paid: false,
    accountingClassification: '',
    expenseType: '',
  };
}

interface InventoryItemsPickerProps {
  drafts: InventoryDraft[];
  onChange: (drafts: InventoryDraft[]) => void;
}

/**
 * Multi-row inventory builder. Each row mirrors the single Inventory form's
 * Type + Variety/Item dropdowns — CreatableSelect (create-new) scoped to the
 * product taxonomy, with predictive SimilarEntryHint suggestions — plus unit,
 * cost, beginning qty, and a "sell this" flag. The parent owns the draft list
 * and commits every row on submit.
 */
export function InventoryItemsPicker({ drafts, onChange }: InventoryItemsPickerProps) {
  const findProduct = useProductStore((s) => s.findByCategorySub);

  const unitValues = useUnitStore((s) => s.values);
  const addUnit = useUnitStore((s) => s.add);
  const unitOptions = unitValues.map((v) => ({ value: v, label: v }));
  const categoryEntries = useProductCategoryStore((s) => s.entries);

  // Purchase-flow option sources (only used when a row is flagged "bought").
  const vendors = useVendorStore((s) => s.vendors);
  const acOptions = useAccountingClassificationStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addAccountingClassification = useAccountingClassificationStore((s) => s.add);
  const expenseTypeOptions = useExpenseTypeStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addExpenseType = useExpenseTypeStore((s) => s.add);
  const vendorOptions = useMemo(
    () =>
      [...vendors]
        .sort((a, b) => a.vendor.localeCompare(b.vendor, undefined, { sensitivity: 'base' }))
        .map((v) => ({ value: v.id, label: v.vendor })),
    [vendors],
  );

  // Type dropdown = the unified product-category taxonomy (shared with Products).
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    categoryEntries.forEach((e) => seen.add(e.category));
    return Array.from(seen).sort().map((v) => ({ value: v, label: v }));
  }, [categoryEntries]);
  const categoryNames = categoryOptions.map((o) => o.value);

  /** Variety options for a given category, from the product taxonomy. */
  const itemOptionsFor = (category: string): string[] => {
    if (!category) return [];
    const subs = categoryEntries
      .filter((e) => e.category === category && e.subcategory !== '')
      .map((e) => e.subcategory);
    return [...new Set(subs)].sort();
  };

  const patchRow = (index: number, patch: Partial<InventoryDraft>) => {
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  /** Change a row's category: reset its variety and re-prefill unit/cost. */
  const changeCategory = (index: number, category: string) => {
    patchRow(index, { category, subcategory: '' });
  };

  /** Pick/enter a variety: adopt it and prefill unit + cost from the product. */
  const changeVariety = (index: number, subcategory: string) => {
    const row = drafts[index];
    const patch: Partial<InventoryDraft> = { subcategory };
    const product = row.category ? findProduct(row.category, subcategory) : undefined;
    if (product) {
      if (product.unit) patch.unit = product.unit;
      if (product.costPHP > 0) patch.unitCost = product.costPHP;
    }
    patchRow(index, patch);
  };

  const addRow = () => onChange([...drafts, emptyDraft()]);
  const removeRow = (index: number) => onChange(drafts.filter((_, i) => i !== index));

  /** Select a vendor from the dropdown (or clear / choose manual entry). */
  const changeVendor = (index: number, value: string) => {
    if (value === MANUAL_ENTRY) {
      patchRow(index, { vendorId: MANUAL_ENTRY, vendorName: '' });
      return;
    }
    if (value === '') {
      patchRow(index, { vendorId: '', vendorName: '' });
      return;
    }
    const vendor = vendors.find((v) => v.id === value);
    patchRow(index, { vendorId: value, vendorName: vendor?.vendor ?? '' });
  };

  return (
    <div className="space-y-3">
      {drafts.map((row, i) => {
        const itemOptions = itemOptionsFor(row.category).map((v) => ({ value: v, label: v }));
        const alwaysSell = ALWAYS_SELL_CATEGORIES.includes(row.category.trim());
        // Hint for the Unit field: the unit is how this variety is counted and
        // priced (e.g. per bottle, per kg). Flag a brand-new type so the user
        // knows they're defining the unit for a category that doesn't exist yet.
        const typeName = row.category.trim();
        const varietyName = row.subcategory.trim();
        const isNewType =
          !!typeName &&
          !categoryNames.some((c) => c.trim().toLowerCase() === typeName.toLowerCase());
        const unitHint = varietyName
          ? isNewType
            ? `This will be saved as the default unit for ${varietyName} in the new "${typeName}" category.`
            : `This will be saved as the default unit for ${varietyName}.`
          : 'This will be saved as the default unit for this item.';
        return (
          <div key={row.key} className="rounded-lg border border-gray-200 p-3 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium text-primary-700">Item {i + 1}</span>
              {drafts.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label={`Remove item ${i + 1}`}
                  className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Type + Variety/Item */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <CreatableSelect
                  label="Type"
                  required
                  value={row.category}
                  options={categoryOptions}
                  onChange={(v) => changeCategory(i, v)}
                  onCreate={(v) => { syncTaxonomy(v, ''); changeCategory(i, v); }}
                  placeholder="Select…"
                  createLabel="+ Create new type…"
                  newFieldLabel="New Type"
                  newFieldPlaceholder="e.g. Irrigation"
                />
                <SimilarEntryHint
                  value={row.category}
                  options={categoryNames}
                  noun="type"
                  onPick={(v) => changeCategory(i, v)}
                />
              </div>
              <div>
                <CreatableSelect
                  label="Variety / Item"
                  required
                  value={row.subcategory}
                  options={itemOptions}
                  onChange={(v) => changeVariety(i, v)}
                  onCreate={(v) => {
                    if (row.category) syncTaxonomy(row.category, v);
                    changeVariety(i, v);
                  }}
                  disabled={!row.category}
                  placeholder={
                    row.category
                      ? itemOptions.length > 0 ? 'Select variety…' : 'Type item name…'
                      : 'Pick a type first'
                  }
                  createLabel="+ Enter variety / item…"
                  newFieldLabel="Variety / Item"
                  newFieldPlaceholder="e.g. Scotch Tape"
                />
                {row.category && (
                  <SimilarEntryHint
                    value={row.subcategory}
                    options={itemOptions.map((o) => o.value)}
                    noun="variety / item"
                    onPick={(v) => changeVariety(i, v)}
                  />
                )}
              </div>
            </div>

            {/* Unit + cost + beginning qty */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <CreatableSelect
                  label="Unit"
                  required
                  value={row.unit}
                  options={unitOptions}
                  onChange={(v) => patchRow(i, { unit: v })}
                  onCreate={(v) => { addUnit(v); patchRow(i, { unit: v }); }}
                  createLabel="+ Create new unit…"
                  newFieldLabel="New Unit"
                  newFieldPlaceholder="e.g. crate"
                />
                {unitHint && <p className="mt-1 text-xs text-gold-600">{unitHint}</p>}
              </div>
              <InputField
                label="Unit Cost (₱)"
                type="number"
                step="0.01"
                value={row.unitCost}
                onChange={(e) => patchRow(i, { unitCost: Number(e.target.value) || 0 })}
              />
              <InputField
                label={row.bought ? 'Quantity Bought' : 'Beginning Qty'}
                type="number"
                step="0.01"
                value={row.beginningQty}
                onChange={(e) => {
                  const next = Number(e.target.value) || 0;
                  // Keep the cuttings "already packed" split within the new total.
                  patchRow(i, { beginningQty: next, packedQty: Math.min(row.packedQty, Math.max(0, next)) });
                }}
              />
            </div>

            {/* Effect summary — clarifies what saving this row does. A new row that
                collides with an existing (Type + Variety) merges additively, so we
                phrase opening stock as "adding to beginning quantity". */}
            {row.subcategory.trim() && (Number(row.beginningQty) || 0) > 0 && (
              <p className="text-xs text-primary-700">
                {row.bought
                  ? <>You're buying <span className="font-semibold">{formatQty(Number(row.beginningQty) || 0)}</span> {row.unit || 'unit'} of <span className="font-semibold">{row.subcategory.trim()}</span> (recorded as an expense).</>
                  : <>You're adding <span className="font-semibold">{formatQty(Number(row.beginningQty) || 0)}</span> {row.unit || 'unit'} to the beginning quantity of <span className="font-semibold">{row.subcategory.trim()}</span>.</>}
              </p>
            )}

            {/* Cuttings packing split.
                - Bought path: a binary packed/bare toggle (the expense→inventory
                  cascade routes the whole purchase to one pool).
                - Opening-stock path: an "already packed" quantity so the user can
                  say how many of the beginning qty are Ready for Sale vs still
                  Need Packing. */}
            {isCuttingCategory(row.category) && row.bought && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Condition</label>
                <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                  {([
                    { value: 'packed', label: 'Already packed' },
                    { value: 'bare', label: 'Bare / needs packing' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={row.cuttingState === opt.value}
                      onClick={() => patchRow(i, { cuttingState: opt.value })}
                      className={[
                        'px-2.5 py-1 text-xs rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                        row.cuttingState === opt.value
                          ? 'bg-white text-primary-700 shadow-sm font-medium'
                          : 'text-gray-500 hover:text-gray-700',
                      ].join(' ')}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {row.cuttingState === 'packed'
                    ? 'Adds to Available to Sell — sellable right away.'
                    : 'Adds to Needs Packing — pack it in Inventory before it can be sold.'}
                </p>
              </div>
            )}

            {isCuttingCategory(row.category) && !row.bought && (() => {
              const total = Number(row.beginningQty) || 0;
              const packed = Math.min(Math.max(0, Number(row.packedQty) || 0), total);
              const needing = Math.max(0, total - packed);
              return (
                <div>
                  <InputField
                    label="Already packed (of the beginning qty)"
                    type="number"
                    step="1"
                    min={0}
                    max={total}
                    value={row.packedQty}
                    onChange={(e) =>
                      patchRow(i, {
                        packedQty: Math.min(Math.max(0, Number(e.target.value) || 0), total),
                      })
                    }
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    {total > 0 ? (
                      <>
                        <span className="font-medium text-leaf-700">{formatQty(packed)}</span> ready for sale ·{' '}
                        <span className="font-medium text-gold-700">{formatQty(needing)}</span> need packing.
                      </>
                    ) : (
                      'Enter a beginning quantity first, then how many are already packed.'
                    )}
                  </p>
                </div>
              );
            })()}

            {/* Sell flag — locked-on note for always-sell categories */}
            {alwaysSell ? (
              <p className="text-xs text-primary-600">Sold in Products (always for {row.category}).</p>
            ) : (
              <CheckboxField
                label="Do you sell this?"
                checked={row.sell}
                onChange={(v) => patchRow(i, { sell: v })}
                hint="Adds it to Products for sale, seeding the cost from this item. Set the selling price in Products."
              />
            )}

            {/* Purchase flag — when on, this item is recorded as an Expense so it
                counts in expense tracking, price history and vendor supplies. The
                quantity above becomes the purchased amount (not opening stock). */}
            <div className="pt-2 border-t border-gray-100">
              <CheckboxField
                label="Did you buy this?"
                checked={row.bought}
                onChange={(v) => patchRow(i, { bought: v })}
                hint="Records it as an Expense (with the details below) so it's accounted for. Leave off for opening stock you already have on hand."
              />
            </div>

            {row.bought && (
              <div className="space-y-3 rounded-lg bg-primary-50/40 border border-primary-100 p-3">
                <p className="text-xs text-gray-500">
                  Recorded as an expense of{' '}
                  <span className="font-medium text-gray-700">
                    ₱{((Number(row.beginningQty) || 0) * (Number(row.unitCost) || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>{' '}
                  ({formatQty(Number(row.beginningQty) || 0)} {row.unit || 'unit'} × ₱{(Number(row.unitCost) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).
                  The quantity is treated as purchased stock.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <SelectField
                      label="Vendor"
                      value={row.vendorId}
                      onChange={(e) => changeVendor(i, e.target.value)}
                      options={[
                        { value: '', label: 'Select vendor…' },
                        ...vendorOptions,
                        { value: MANUAL_ENTRY, label: '+ Enter vendor name…' },
                      ]}
                    />
                    {row.vendorId === MANUAL_ENTRY && (
                      <InputField
                        label="New vendor name"
                        value={row.vendorName}
                        onChange={(e) => patchRow(i, { vendorName: e.target.value })}
                        placeholder="e.g. Bulacan Ag Supply"
                      />
                    )}
                  </div>
                  <InputField
                    label="Purchase date"
                    type="date"
                    value={row.purchaseDate}
                    onChange={(e) => patchRow(i, { purchaseDate: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <CreatableSelect
                    label="Accounting Classification"
                    value={row.accountingClassification}
                    options={acOptions}
                    onChange={(v) => patchRow(i, { accountingClassification: v })}
                    onCreate={(v) => { addAccountingClassification(v); patchRow(i, { accountingClassification: v }); }}
                    placeholder="Optional — e.g. Operating Expense (OpEx)"
                    createLabel="Add new classification…"
                    newFieldLabel="New accounting classification"
                  />
                  <CreatableSelect
                    label="Expense Type"
                    value={row.expenseType}
                    options={expenseTypeOptions}
                    onChange={(v) => patchRow(i, { expenseType: v })}
                    onCreate={(v) => { addExpenseType(v); patchRow(i, { expenseType: v }); }}
                    placeholder="Optional — e.g. Fixed"
                    createLabel="Add new expense type…"
                    newFieldLabel="New expense type"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <SelectField
                    label="Payment Method"
                    value={row.paymentMethod}
                    onChange={(e) => patchRow(i, { paymentMethod: e.target.value })}
                    options={PAYMENT_OPTIONS}
                  />
                  <div className="flex items-end pb-1">
                    <CheckboxField
                      label="Paid"
                      checked={row.paid}
                      onChange={(v) => patchRow(i, { paid: v })}
                    />
                  </div>
                </div>

                {/* Blank accounting fields are allowed, but the expense that gets
                    created will be missing them — warn the user to fill them in
                    later from the Expenses page. */}
                {(!row.accountingClassification.trim() || !row.expenseType.trim()) && (() => {
                  const missing = [
                    !row.accountingClassification.trim() && 'accounting classification',
                    !row.expenseType.trim() && 'expense type',
                  ].filter(Boolean);
                  return (
                    <p className="mt-1 text-xs text-gold-600">
                      This purchase will be recorded with no {missing.join(' and ')} — update{' '}
                      {missing.length > 1 ? 'them' : 'it'} on the expense in the Expenses page.
                    </p>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" icon={<Plus className="w-4 h-4" />} onClick={addRow}>
        Add another item
      </Button>
    </div>
  );
}
