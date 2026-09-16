import { useMemo, useState } from 'react';
import { Plus, Pencil, X, Store } from 'lucide-react';
import { SectionCard } from '../../components/ui/SectionCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { InputField, SelectField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { Badge } from '../../components/ui/Badge';
import { useListCrud } from '../../hooks/useListCrud';
import {
  useVendorProductStore,
  type VendorProduct,
} from '../../store/vendorProductStore';
import { useVendorStore } from '../../store/vendorStore';
import { useProductStore } from '../../store/productStore';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import { useUnitStore } from '../../store/optionStores';

/**
 * Manage the shared vendor-product catalog: products (name, category, unit) and
 * which vendors offer each one at what price. Products are shared across
 * vendors; price is per-vendor (see vendorProductStore).
 */

interface ProductFormState {
  name: string;
  category: string;
  subcategory: string;
  unit: string;
}

const EMPTY_FORM: ProductFormState = { name: '', category: '', subcategory: '', unit: '' };

export function ProductCatalogManager() {
  const {
    products,
    prices,
    addProduct,
    updateProduct,
    updateProductCategory,
    deleteProduct,
    linkVendorPrice,
    unlinkVendorPrice,
  } = useVendorProductStore();
  const vendors = useVendorStore((s) => s.vendors);
  const { categories, subcategoriesFor, addEntry } = useExpenseCategoryStore();
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addUnit = useUnitStore((s) => s.add);

  const crud = useListCrud<VendorProduct>();
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');

  // Per-product "link a vendor" working state (vendorId + price), keyed by product id
  const [linkVendorId, setLinkVendorId] = useState('');
  const [linkPrice, setLinkPrice] = useState('');
  const [linkForProduct, setLinkForProduct] = useState<string | null>(null);

  const categoryOptions = categories().map((c) => ({ value: c, label: c }));
  const subOptions = subcategoriesFor(form.category).map((s) => ({ value: s, label: s }));

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.vendor ?? 'Unknown vendor';

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );

  // Set of (category||subcategory) keys that also exist as sellable Products, so
  // we can flag catalog products the business resells.
  const sellableProducts = useProductStore((s) => s.products);
  const resoldKeys = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase();
    return new Set(sellableProducts.map((p) => `${norm(p.category)}||${norm(p.subcategory)}`));
  }, [sellableProducts]);
  const isResold = (p: VendorProduct) =>
    resoldKeys.has(`${p.category.trim().toLowerCase()}||${p.subcategory.trim().toLowerCase()}`);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    crud.openAdd();
  };

  const openEdit = (p: VendorProduct) => {
    setForm({ name: p.name, category: p.category, subcategory: p.subcategory, unit: p.unit });
    setFormError('');
    crud.openEdit(p);
  };

  const handleSave = () => {
    const name = form.name.trim();
    const category = form.category.trim();
    if (!name) { setFormError('Product name is required'); return; }
    if (!category) { setFormError('Category is required'); return; }

    if (crud.editing) {
      updateProduct(crud.editing.id, { name, unit: form.unit.trim() });
      // Category/subcategory move only when changed
      if (crud.editing.category !== category || crud.editing.subcategory !== form.subcategory.trim()) {
        updateProductCategory(crud.editing.id, category, form.subcategory.trim());
      }
    } else {
      addProduct({ name, category, subcategory: form.subcategory.trim(), unit: form.unit.trim() });
    }
    crud.closeModal();
  };

  const startLink = (productId: string) => {
    setLinkForProduct(productId);
    setLinkVendorId('');
    setLinkPrice('');
  };

  const commitLink = (productId: string) => {
    if (!linkVendorId) return;
    linkVendorPrice(linkVendorId, productId, Number(linkPrice) || 0);
    setLinkForProduct(null);
    setLinkVendorId('');
    setLinkPrice('');
  };

  return (
    <SectionCard
      title="Product Catalog"
      subtitle={`${products.length} product${products.length !== 1 ? 's' : ''} · shared across vendors, priced per vendor`}
      actions={
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={openAdd}>
          Add product
        </Button>
      }
    >
      {sortedProducts.length === 0 ? (
        <p className="text-xs text-gray-400">
          No products yet. Products are also created automatically when you record an itemized purchase.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sortedProducts.map((p) => {
            const links = prices.filter((pr) => pr.productId === p.id);
            const linking = linkForProduct === p.id;
            // Vendors not yet linked to this product (candidates for the add-vendor select)
            const availableVendors = vendors
              .filter((v) => !links.some((l) => l.vendorId === v.id))
              .sort((a, b) => a.vendor.localeCompare(b.vendor, undefined, { sensitivity: 'base' }));
            return (
              <div key={p.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                      {isResold(p) && <span className="flex-shrink-0"><Badge label="Resold" variant="green" /></span>}
                    </div>
                    <p className="text-xs text-gray-400">
                      {p.category}{p.subcategory ? ` · ${p.subcategory}` : ''}{p.unit ? ` · per ${p.unit}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      aria-label={`Edit ${p.name}`}
                      className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-green-400"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => crud.requestDelete(p)}
                      aria-label={`Delete ${p.name}`}
                      className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Vendor price links */}
                <div className="space-y-1.5">
                  {links.length === 0 ? (
                    <p className="text-xs text-gray-400">No vendors offer this yet.</p>
                  ) : (
                    links.map((l) => (
                      <div key={l.vendorId} className="flex items-center gap-2 text-sm">
                        <Store className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <span className="flex-1 truncate text-gray-700">{vendorName(l.vendorId)}</span>
                        <input
                          type="number"
                          step="0.01"
                          aria-label={`Price for ${p.name} from ${vendorName(l.vendorId)}`}
                          value={l.defaultPrice}
                          onChange={(e) => linkVendorPrice(l.vendorId, p.id, Number(e.target.value) || 0)}
                          className="w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                        <button
                          type="button"
                          onClick={() => unlinkVendorPrice(l.vendorId, p.id)}
                          aria-label={`Remove ${vendorName(l.vendorId)} from ${p.name}`}
                          className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Add-vendor row */}
                {linking ? (
                  <div className="flex items-end gap-2 mt-2">
                    <div className="flex-1">
                      <SelectField
                        label="Vendor"
                        options={availableVendors.map((v) => ({ value: v.id, label: v.vendor }))}
                        placeholder={availableVendors.length ? 'Select vendor…' : 'All vendors already linked'}
                        value={linkVendorId}
                        onChange={(e) => setLinkVendorId(e.target.value)}
                      />
                    </div>
                    <div className="w-24">
                      <InputField
                        label="Price"
                        type="number"
                        step="0.01"
                        value={linkPrice}
                        onChange={(e) => setLinkPrice(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <Button type="button" size="sm" onClick={() => commitLink(p.id)}>Add</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setLinkForProduct(null)}>Cancel</Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startLink(p.id)}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-green-700 hover:text-green-800 focus:outline-none focus:ring-2 focus:ring-green-400 rounded"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add vendor price
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / edit product modal */}
      <Modal
        open={crud.modalOpen}
        onClose={crud.closeModal}
        title={crud.editing ? 'Edit Product' : 'Add Product'}
        size="md"
      >
        <div className="space-y-4">
          <InputField
            label="Product name"
            required
            value={form.name}
            onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setFormError(''); }}
            placeholder="e.g. Ammonium Sulfate 21-0-0"
            error={formError && !form.name.trim() ? formError : undefined}
          />
          <div className="grid grid-cols-2 gap-4">
            <CreatableSelect
              label="Category"
              required
              options={categoryOptions}
              placeholder="Select category…"
              value={form.category}
              onChange={(v) => { setForm((f) => ({ ...f, category: v, subcategory: '' })); setFormError(''); }}
              onCreate={(v) => { addEntry(v, ''); setForm((f) => ({ ...f, subcategory: '' })); setFormError(''); }}
              error={formError && form.name.trim() && !form.category.trim() ? formError : undefined}
              createLabel="+ Add new category…"
              newFieldLabel="New Category"
              newFieldPlaceholder="e.g. Fertilizer"
            />
            <CreatableSelect
              label="Subcategory"
              options={subOptions}
              placeholder={form.category ? (subOptions.length ? 'Select or add…' : 'Add a subcategory…') : 'Pick a category first'}
              value={form.subcategory}
              onChange={(v) => setForm((f) => ({ ...f, subcategory: v }))}
              onCreate={(v) => { if (form.category.trim()) addEntry(form.category, v); }}
              disabled={!form.category}
              createLabel="+ Add new subcategory…"
              newFieldLabel="New Subcategory"
              newFieldPlaceholder="e.g. Magnesium"
            />
          </div>
          <CreatableSelect
            label="Unit"
            options={unitOptions}
            placeholder="—"
            value={form.unit}
            onChange={(v) => setForm((f) => ({ ...f, unit: v }))}
            onCreate={addUnit}
            createLabel="+ Add new unit…"
            newFieldLabel="New Unit"
            newFieldPlaceholder="e.g. crate"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={crud.closeModal}>Cancel</Button>
            <Button type="button" onClick={handleSave}>
              {crud.editing ? 'Save Changes' : 'Add Product'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((p) => deleteProduct(p.id))}
        title="Delete product"
        message={`Delete "${crud.deleteTarget?.name}" from the catalog? Its vendor prices are removed too. Past expenses that used it keep their recorded line items.`}
        confirmLabel="Delete"
      />
    </SectionCard>
  );
}
