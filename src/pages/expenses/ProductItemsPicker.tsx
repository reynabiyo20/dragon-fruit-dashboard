import { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, PackagePlus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ExpenseItem } from '../../types';
import { useVendorProductStore, type VendorProduct } from '../../store/vendorProductStore';
import { useVendorStore } from '../../store/vendorStore';
import { useProductStore } from '../../store/productStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import { useUnitStore } from '../../store/optionStores';
import { InputField, SelectField, CheckboxField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import { Button } from '../../components/ui/Button';
import { formatPHP } from '../../utils/format';
import { INVENTORY_LINKED_TYPES, CUTTING_TYPE_OPTIONS, CUTTING_TYPE_GRAFTED } from '../../constants';

/** Categories that always cascade into the sellable Products list. */
const ALWAYS_RESELL_CATEGORIES = INVENTORY_LINKED_TYPES as readonly string[];

/** The Cuttings category — its purchases route by packed/bare condition. */
const CUTTINGS_CATEGORY = INVENTORY_LINKED_TYPES[0]; // 'Cuttings'
const isCuttingCat = (category: string): boolean =>
  category.trim().toLowerCase() === CUTTINGS_CATEGORY.toLowerCase();

/**
 * Multi-item product picker for an itemized purchase from a single vendor.
 *
 * Flow: pick a category the vendor supplies → multiselect that category's
 * products (checkboxes) → each checked product becomes an editable line (qty /
 * unit / price prefilled from the vendor's saved default). New products can be
 * created inline and are persisted to the shared catalog + linked to the vendor.
 *
 * The parent owns the vendor selection and the resulting `items`; this component
 * only reads `vendorId` and reports the working line list via `onChange`.
 */

interface ProductItemsPickerProps {
  vendorId: string;
  vendorName: string;
  items: ExpenseItem[];
  onChange: (items: ExpenseItem[]) => void;
}

/** Build an ExpenseItem line from a catalog product + the vendor's default price. */
function lineFromProduct(p: VendorProduct, defaultPrice: number): ExpenseItem {
  const quantity = 1;
  const unitPrice = defaultPrice;
  return {
    productId: p.id,
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
    quantity,
    unit: p.unit,
    unitPrice,
    total: quantity * unitPrice,
  };
}

export function ProductItemsPicker({ vendorId, vendorName, items, onChange }: ProductItemsPickerProps) {
  const { productsFor, priceFor, addProduct, linkVendorPrice } = useVendorProductStore();
  // Product store = source of truth for a variety's unit + cost.
  const findSellableProduct = useProductStore((s) => s.findByCategorySub);
  const getVendor = useVendorStore((s) => s.getVendor);
  const addSupply = useVendorStore((s) => s.addSupply);
  const vendorsState = useVendorStore((s) => s.vendors);
  const { categories, subcategoriesFor, addEntry } = useExpenseCategoryStore();
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addUnit = useUnitStore((s) => s.add);

  // Working category filter for the product checklist
  const [activeCategory, setActiveCategory] = useState('');

  // Inline "create product" form state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newPrice, setNewPrice] = useState('');
  // Whether this purchased product is also resold by the business. When on, it's
  // cascaded into the sellable Products list (default off — most vendor supplies
  // like construction materials are consumed, not resold).
  const [newResell, setNewResell] = useState(false);
  const [createError, setCreateError] = useState('');

  // Re-derive when the catalog or vendor links change (products added/linked elsewhere)
  const products = useVendorProductStore((s) => s.products);
  const prices = useVendorProductStore((s) => s.prices);

  // The selected vendor's declared supplies (category + subcategory) from the Vendor record.
  // These are the "products/supplies" shown on the Vendors page and are a source of
  // selectable entries even when no catalog product has been linked yet.
  const vendorSupplies = useMemo(
    () => getVendor(vendorId)?.supplies ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vendorId, vendorsState]
  );

  /**
   * A row the user can check. It's backed either by an existing catalog product
   * (`product`) or, when the vendor only declared a supply, by a supply stub that
   * gets promoted to a real product the moment it's selected.
   */
  type SelectableEntry =
    | { kind: 'product'; key: string; category: string; subcategory: string; name: string; product: VendorProduct }
    | { kind: 'supply'; key: string; category: string; subcategory: string; name: string };

  // Merge the vendor's linked catalog products with their declared supplies.
  const allEntries = useMemo<SelectableEntry[]>(() => {
    const entries: SelectableEntry[] = productsFor(vendorId).map((p) => ({
      kind: 'product',
      key: `p:${p.id}`,
      category: p.category,
      subcategory: p.subcategory,
      name: p.name,
      product: p,
    }));

    // Add supply-only entries the catalog products don't already cover
    const covered = new Set(
      entries.map((e) => `${e.category}||${e.subcategory}`.toLowerCase())
    );
    vendorSupplies.forEach((s) => {
      const label = s.subcategory || s.category;
      const dupKey = `${s.category}||${s.subcategory}`.toLowerCase();
      if (covered.has(dupKey)) return;
      covered.add(dupKey);
      entries.push({
        kind: 'supply',
        key: `s:${s.category}|${s.subcategory}`,
        category: s.category,
        subcategory: s.subcategory,
        name: label,
      });
    });
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, products, prices, vendorSupplies]);

  // Categories the vendor supplies (from products + declared supplies), distinct + sorted
  const vendorCategories = useMemo(
    () => [...new Set(allEntries.map((e) => e.category).filter(Boolean))].sort(),
    [allEntries]
  );

  const allCategories = categories();
  const categoryOptions = allCategories.map((c) => ({ value: c, label: c }));
  const existingNewSubs = subcategoriesFor(newCategory);
  const newSubOptions = existingNewSubs.map((s) => ({ value: s, label: s }));

  // Prefill the New-product Unit + Default price from the Product store (source of
  // truth) once a category + subcategory resolve to an existing product. Only
  // fills empty fields, so it never clobbers what the user is typing.
  useEffect(() => {
    const cat = newCategory.trim();
    const sub = newSubcategory.trim();
    if (!cat || !sub) return;
    const product = findSellableProduct(cat, sub);
    if (!product) return;
    if (product.unit) setNewUnit((u) => (u.trim() ? u : product.unit));
    if (product.costPHP > 0) setNewPrice((p) => (p.trim() ? p : String(product.costPHP)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCategory, newSubcategory]);

  // Entries to show in the checklist, filtered to the active category when one is chosen
  const visibleEntries = useMemo(
    () => (activeCategory ? allEntries.filter((e) => e.category === activeCategory) : allEntries),
    [allEntries, activeCategory]
  );

  const checkedIds = new Set(items.map((it) => it.productId).filter(Boolean));

  /** Is a selectable entry currently reflected in the working line items? */
  const isEntryChecked = (e: SelectableEntry) => {
    if (e.kind === 'product') return checkedIds.has(e.product.id);
    return items.some(
      (it) => it.category === e.category && it.subcategory === e.subcategory && !it.productId
    );
  };

  /**
   * Resolve the unit + default price for a catalog product, with the sellable
   * Product store as the source of truth: prefer the vendor's saved price, then
   * the product's cost; prefer the vendor product's unit, then the sellable
   * product's unit. Keeps itemized lines defaulted consistently with the rest of
   * the app.
   */
  const resolveDefaults = (p: VendorProduct): { unit: string; price: number } => {
    const vendorPrice = priceFor(vendorId, p.id);
    const sellable = findSellableProduct(p.category, p.subcategory);
    const unit = p.unit || sellable?.unit || '';
    const price =
      vendorPrice !== undefined && vendorPrice > 0
        ? vendorPrice
        : sellable && sellable.costPHP > 0
          ? sellable.costPHP
          : (vendorPrice ?? 0);
    return { unit, price };
  };

  const addProductEntry = (p: VendorProduct) => {
    const existingPrice = priceFor(vendorId, p.id);
    // Link the product to this vendor if it isn't already, so the association persists
    if (existingPrice === undefined) {
      linkVendorPrice(vendorId, p.id, 0);
    }
    // Cascade the product's category/subcategory into the vendor's supplies list
    // so it shows up on the Vendors page (no-op if already present).
    addSupply(vendorId, p.category, p.subcategory);
    const { unit, price } = resolveDefaults(p);
    onChange([...items, { ...lineFromProduct(p, price), unit }]);
  };

  const toggleEntry = (e: SelectableEntry) => {
    if (e.kind === 'product') {
      if (checkedIds.has(e.product.id)) {
        onChange(items.filter((it) => it.productId !== e.product.id));
      } else {
        addProductEntry(e.product);
      }
      return;
    }
    // Supply-only entry: promote to a real catalog product on first select
    if (isEntryChecked(e)) {
      onChange(
        items.filter(
          (it) => !(it.category === e.category && it.subcategory === e.subcategory && !it.productId)
        )
      );
      return;
    }
    const product = addProduct({
      name: e.name,
      category: e.category,
      subcategory: e.subcategory,
      unit: '',
    });
    linkVendorPrice(vendorId, product.id, 0);
    addProductEntry(product);
  };

  const updateLine = (index: number, patch: Partial<ExpenseItem>) => {
    onChange(
      items.map((it, i) => {
        if (i !== index) return it;
        const merged = { ...it, ...patch };
        merged.total = (Number(merged.quantity) || 0) * (Number(merged.unitPrice) || 0);
        return merged;
      })
    );
  };

  const removeLine = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const resetCreate = () => {
    setNewName('');
    setNewCategory('');
    setNewSubcategory('');
    setNewUnit('');
    setNewPrice('');
    setNewResell(false);
    setCreateError('');
    setShowCreate(false);
  };

  const handleCreateProduct = () => {
    const category = newCategory.trim();
    const subcategory = newSubcategory.trim();
    const unit = newUnit.trim();
    const price = Number(newPrice) || 0;
    if (!category) { setCreateError('Category is required'); return; }
    if (!subcategory) { setCreateError('Subcategory is required'); return; }
    if (!unit) { setCreateError('Unit is required'); return; }
    if (price <= 0) { setCreateError('Price must be greater than 0'); return; }

    // The product is identified by its category + subcategory; a separate name is
    // optional. Default it to the subcategory (or category) when left blank.
    const name = newName.trim() || subcategory || category;

    // Create (or find) the shared product, then link this vendor's default price
    const product = addProduct({ name, category, subcategory, unit });
    linkVendorPrice(vendorId, product.id, price);
    // Cascade into the vendor's supplies list (Vendors page reflects it)
    addSupply(vendorId, product.category, product.subcategory);
    // Persist the category + subcategory to BOTH managed taxonomies (idempotent)
    // so the subcategory shows up, sorted, in the Expense, Product & Sales
    // dropdowns next time.
    addEntry(product.category, product.subcategory);
    syncTaxonomy(product.category, product.subcategory);

    // Add it straight to the working lines so the user sees it selected. The
    // resell flag rides on the line and is applied at save — and is editable via
    // the per-line "Resell" toggle below, so a mis-flag can be corrected.
    if (!checkedIds.has(product.id)) {
      onChange([...items, { ...lineFromProduct(product, price), resell: newResell }]);
    }
    resetCreate();
  };

  const itemsTotal = items.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
  const hasVendor = !!vendorId;

  return (
    <div className="space-y-4">
      {!hasVendor ? (
        <p className="text-xs text-gray-500 rounded-lg border border-dashed border-gray-300 p-3">
          Select a vendor above to see their products.
        </p>
      ) : (
        <>
          {/* Category filter + product checklist */}
          <div className="rounded-lg border border-gray-200 p-3 space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <SelectField
                  label="Filter by category"
                  options={vendorCategories.map((c) => ({ value: c, label: c }))}
                  placeholder={vendorCategories.length ? 'All categories' : 'No products or supplies yet'}
                  value={activeCategory}
                  onChange={(e) => setActiveCategory(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<PackagePlus className="w-4 h-4" />}
                onClick={() => setShowCreate((s) => !s)}
              >
                New product
              </Button>
            </div>

            {visibleEntries.length === 0 ? (
              <p className="text-xs text-gray-400">
                {vendorName || 'This vendor'} has no products or supplies
                {activeCategory ? ` in "${activeCategory}"` : ''}. Add one with "New product".
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto scrollbar-thin">
                {visibleEntries.map((e) => {
                  const price = e.kind === 'product' ? priceFor(vendorId, e.product.id) : undefined;
                  return (
                    <label
                      key={e.key}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={isEntryChecked(e)}
                        onChange={() => toggleEntry(e)}
                        className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                      />
                      <span className="flex-1 truncate text-gray-700">
                        {e.name}
                        {e.kind === 'product' && e.subcategory ? (
                          <span className="text-gray-400"> · {e.subcategory}</span>
                        ) : e.kind === 'supply' && e.subcategory && e.subcategory !== e.name ? (
                          <span className="text-gray-400"> · {e.category}</span>
                        ) : null}
                      </span>
                      {price !== undefined && price > 0 && (
                        <span className="text-xs text-gray-400">{formatPHP(price)}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            {/* Inline create-product form */}
            {showCreate && (
              <div className="rounded-lg border border-primary-100 bg-primary-50 p-3 space-y-3">
                <p className="text-xs font-medium text-primary-700">
                  New product — identified by category + subcategory, saved to the catalog and linked to {vendorName || 'this vendor'} at the price you set.
                </p>
                {/* Classification (identity): Category + Subcategory */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <CreatableSelect
                      label="Category"
                      required
                      options={categoryOptions}
                      placeholder="Select category…"
                      value={newCategory}
                      onChange={(v) => { setNewCategory(v); setNewSubcategory(''); setCreateError(''); }}
                      onCreate={(v) => { addEntry(v, ''); setNewSubcategory(''); setCreateError(''); }}
                      createLabel="+ Add new category…"
                      newFieldLabel="New Category"
                      newFieldPlaceholder="e.g. Fertilizer"
                    />
                    <SimilarEntryHint
                      value={newCategory}
                      options={allCategories}
                      noun="category"
                      onPick={(v) => { setNewCategory(v); setNewSubcategory(''); setCreateError(''); }}
                    />
                  </div>
                  <div>
                    <CreatableSelect
                      label="Subcategory"
                      required
                      options={newSubOptions}
                      placeholder={newCategory ? (newSubOptions.length ? 'Select or add…' : 'Add a subcategory…') : 'Pick a category first'}
                      value={newSubcategory}
                      onChange={(v) => { setNewSubcategory(v); setCreateError(''); }}
                      onCreate={(v) => {
                        if (!newCategory.trim()) { setCreateError('Pick a category first'); return; }
                        addEntry(newCategory, v);
                        toast.success(`Added subcategory "${v}" to ${newCategory}`);
                      }}
                      disabled={!newCategory}
                      createLabel="+ Add new subcategory…"
                      newFieldLabel="New Subcategory"
                      newFieldPlaceholder="e.g. Magnesium"
                    />
                    {newCategory && (
                      <SimilarEntryHint
                        value={newSubcategory}
                        options={existingNewSubs}
                        noun="subcategory"
                        onPick={(v) => { setNewSubcategory(v); setCreateError(''); }}
                      />
                    )}
                  </div>
                </div>
                {/* Unit + default price (both required) */}
                <div className="grid grid-cols-2 gap-3">
                  <CreatableSelect
                    label="Unit"
                    required
                    options={unitOptions}
                    placeholder="Select or add…"
                    value={newUnit}
                    onChange={(v) => { setNewUnit(v); setCreateError(''); }}
                    onCreate={addUnit}
                    createLabel="+ Add new unit…"
                    newFieldLabel="New Unit"
                    newFieldPlaceholder="e.g. crate"
                  />
                  <InputField
                    label="Default price (₱)"
                    required
                    type="number"
                    step="0.01"
                    value={newPrice}
                    onChange={(e) => { setNewPrice(e.target.value); setCreateError(''); }}
                    placeholder="e.g. 250"
                  />
                </div>
                {/* Optional product name — defaults to the subcategory when blank */}
                <InputField
                  label="Product name (optional)"
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setCreateError(''); }}
                  placeholder={newSubcategory ? `Defaults to "${newSubcategory}"` : 'Defaults to the subcategory'}
                  hint="Leave blank to use the subcategory as the product name"
                />

                {/* Resell flag — when on, also add this to the sellable Products list */}
                <CheckboxField
                  label="We resell this"
                  checked={newResell}
                  onChange={setNewResell}
                  hint="Adds it to Products for sale, seeding the cost from this purchase (set the selling price later). Leave off for supplies you only consume."
                />

                {createError && <p className="text-xs text-red-500">{createError}</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={resetCreate}>Cancel</Button>
                  <Button type="button" size="sm" icon={<Plus className="w-4 h-4" />} onClick={handleCreateProduct}>
                    Add product
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Selected line items — editable */}
          {items.length === 0 ? (
            <p className="text-xs text-gray-400">No items selected yet. Check products above to add them.</p>
          ) : (
            <div className="space-y-2">
              <div className="hidden sm:grid grid-cols-12 gap-2 px-1 text-xs font-medium text-gray-400">
                <span className="col-span-4">Item</span>
                <span className="col-span-2">Qty <span className="text-red-500">*</span></span>
                <span className="col-span-2">Unit <span className="text-red-500">*</span></span>
                <span className="col-span-2">Price <span className="text-red-500">*</span></span>
                <span className="col-span-1 text-right">Total</span>
                <span className="col-span-1" />
              </div>
              <p className="sm:hidden text-xs text-gray-400 px-1">
                Quantity, unit &amp; price are required <span className="text-red-500">*</span> for every item.
              </p>
              {items.map((it, i) => (
                <div key={`${it.productId}-${i}`} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-12 sm:col-span-4 min-w-0">
                    <span className="text-sm text-gray-700 truncate block">
                      {it.name}
                      {it.subcategory ? <span className="text-gray-400"> · {it.subcategory}</span> : ''}
                    </span>
                    <span className="text-xs text-gray-400">{it.category}</span>
                    {/* Per-line resell toggle — editable so a mis-flag is fixable.
                        Cuttings/Fruit/Fertilizer always resell, so the toggle is
                        shown as a locked-on note for those. */}
                    {ALWAYS_RESELL_CATEGORIES.includes(it.category) ? (
                      <span className="mt-0.5 block text-xs text-primary-600">Resold (always)</span>
                    ) : (
                      <label className="mt-0.5 flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!it.resell}
                          onChange={(e) => updateLine(i, { resell: e.target.checked })}
                          className="w-3.5 h-3.5 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                        />
                        We resell this
                      </label>
                    )}
                    {/* Cuttings only: what this line is for — packed (Ready for
                        Sale), bare (Needs Packing), or replant (creates a
                        Propagation batch). Rendered as an obvious labeled
                        segmented toggle (mirroring the single-expense form) so the
                        purpose isn't buried in a tiny dropdown. */}
                    {isCuttingCat(it.category) && (() => {
                      const condition = it.cuttingState ?? 'packed';
                      return (
                        <div className="mt-1.5">
                          <span className="block text-xs font-medium text-gray-600 mb-1">Purpose</span>
                          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                            {([
                              { value: 'packed', label: 'Already packed' },
                              { value: 'bare', label: 'Bare / needs packing' },
                              { value: 'replant', label: 'For replant (farm)' },
                            ] as const).map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                aria-pressed={condition === opt.value}
                                onClick={() => updateLine(i, { cuttingState: opt.value })}
                                className={[
                                  'px-2.5 py-1 text-xs rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                                  condition === opt.value
                                    ? 'bg-white text-gray-900 shadow-sm font-medium'
                                    : 'text-gray-500 hover:text-gray-700',
                                ].join(' ')}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-gray-400 mt-1">
                            {condition === 'packed'
                              ? 'Adds to Ready for Sale — sellable right away.'
                              : condition === 'bare'
                                ? 'Adds to Needs Packing — pack it in Inventory before it can be sold.'
                                : 'Creates a Propagation batch reserved for the farm — not added to sellable stock.'}
                          </p>
                          {/* Replant: capture the cutting type so the Propagation
                              batch tracks the right rooting/ready timeline. */}
                          {condition === 'replant' && (
                            <div className="mt-1.5">
                              <span className="block text-xs font-medium text-gray-600 mb-1">Cutting Type</span>
                              <select
                                aria-label={`Cutting type for ${it.name}`}
                                value={it.cuttingType ?? CUTTING_TYPE_GRAFTED}
                                onChange={(e) => updateLine(i, { cuttingType: e.target.value })}
                                className="w-full sm:w-56 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                      );
                    })()}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    required
                    aria-label={`Quantity for ${it.name}`}
                    value={it.quantity}
                    onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                    className={[
                      'col-span-4 sm:col-span-2 px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500',
                      (Number(it.quantity) || 0) <= 0 ? 'border-red-300 bg-red-50' : 'border-gray-300',
                    ].join(' ')}
                  />
                  {(() => {
                    // A line's unit is resolved from the product catalog and can
                    // differ in casing from the shared unit list (e.g. a legacy
                    // "Piece" vs the list's "piece"). A <select> only selects an
                    // <option> whose value matches EXACTLY, so a casing drift would
                    // silently render the blank "—" even though the line has a unit.
                    // Reuse the option's canonical casing when one matches
                    // case-insensitively; otherwise surface the raw value as its
                    // own option so it stays visible and selected.
                    const trimmed = it.unit.trim();
                    const canonical = unitOptions.find(
                      (o) => o.value.trim().toLowerCase() === trimmed.toLowerCase(),
                    );
                    const selectValue = canonical ? canonical.value : it.unit;
                    return (
                      <select
                        aria-label={`Unit for ${it.name}`}
                        required
                        value={selectValue}
                        onChange={(e) => updateLine(i, { unit: e.target.value })}
                        className={[
                          'col-span-4 sm:col-span-2 px-2 py-1.5 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500',
                          !trimmed ? 'border-red-300 bg-red-50' : 'border-gray-300',
                        ].join(' ')}
                      >
                        <option value="">—</option>
                        {trimmed && !canonical && <option value={it.unit}>{it.unit}</option>}
                        {unitOptions.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    );
                  })()}
                  <input
                    type="number"
                    step="0.01"
                    required
                    aria-label={`Price for ${it.name}`}
                    value={it.unitPrice}
                    onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
                    className={[
                      'col-span-3 sm:col-span-2 px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500',
                      (Number(it.unitPrice) || 0) <= 0 ? 'border-red-300 bg-red-50' : 'border-gray-300',
                    ].join(' ')}
                  />
                  <span className="col-span-8 sm:col-span-1 text-sm text-right font-medium text-gray-800">
                    {formatPHP(it.total)}
                  </span>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      aria-label={`Remove ${it.name}`}
                      className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex justify-end pt-2 border-t border-gray-200">
                <span className="text-sm font-semibold text-gray-900">
                  Total: {formatPHP(itemsTotal)}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
