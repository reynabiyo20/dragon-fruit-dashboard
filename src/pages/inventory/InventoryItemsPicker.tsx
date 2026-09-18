import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useProductStore } from '../../store/productStore';
import { useVendorStore } from '../../store/vendorStore';
import {
  useInventoryCategoryStore, useUnitStore,
  useAccountingClassificationStore, useExpenseTypeStore,
} from '../../store/optionStores';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { InputField, SelectField, CheckboxField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import { Button } from '../../components/ui/Button';
import { INVENTORY_LINKED_TYPES, PAYMENT_OPTIONS, MANUAL_ENTRY } from '../../constants';
import { todayISO } from '../../utils/date';
import { formatNumber } from '../../utils/format';

/** Categories that are always sellable — they cascade into Products regardless. */
const ALWAYS_SELL_CATEGORIES = INVENTORY_LINKED_TYPES as readonly string[];

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
  const categoryValues = useInventoryCategoryStore((s) => s.values);
  const addCategory = useInventoryCategoryStore((s) => s.add);
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

  // Type dropdown = inventory categories unioned with product taxonomy categories.
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>(categoryValues);
    categoryEntries.forEach((e) => seen.add(e.category));
    return Array.from(seen).sort().map((v) => ({ value: v, label: v }));
  }, [categoryValues, categoryEntries]);
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
                  onCreate={(v) => { addCategory(v); syncTaxonomy(v, ''); changeCategory(i, v); }}
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
                onChange={(e) => patchRow(i, { beginningQty: Number(e.target.value) || 0 })}
              />
            </div>

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
                  ({formatNumber(Number(row.beginningQty) || 0)} {row.unit || 'unit'} × ₱{(Number(row.unitCost) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).
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
