import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Package, Tag, Percent, ListChecks, X } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useProductStore } from '../../store/productStore';
import { useUnitStore } from '../../store/optionStores';
import type { Product } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { RowActions } from '../../components/ui/RowActions';
import { UndoBar } from '../../components/ui/UndoBar';
import { formatPHP, formatNumber } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { PIE_COLORS } from '../../constants/chartColors';
import {
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../constants/chartTheme';
import { ProductForm } from './ProductForm';

export function ProductsPage() {
  const { products, deleteProduct, updateProduct, noPriceCount, noCostCount, averageMarginPct, countByCategory } = useProductStore();
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const crud = useListCrud<Product>();

  // ── Bulk edit price/cost/unit + undo ────────────────────────────────────────
  // Selecting rows and choosing "Set Cost", "Set Price" or "Set Unit" opens a
  // small modal to enter one value applied to every selected product. We snapshot
  // each row's previous value so the whole change can be reverted in one click;
  // the Undo bar shows only while a snapshot exists.
  type BulkField = 'costPHP' | 'sellingPricePHP' | 'costUSD' | 'sellingPriceUSD' | 'unit';
  const [bulkRows, setBulkRows] = useState<Product[] | null>(null);
  const [bulkField, setBulkField] = useState<BulkField>('costPHP');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [undoSnapshot, setUndoSnapshot] = useState<{ message: string; field: BulkField; prev: { id: string; value: string | number }[] } | null>(null);

  const isNumericField = (f: BulkField) => f !== 'unit';
  const isUsdField = (f: BulkField) => f === 'costUSD' || f === 'sellingPriceUSD';
  const fieldLabel = (f: BulkField) =>
    f === 'costPHP' ? 'cost (₱)'
    : f === 'sellingPricePHP' ? 'price (₱)'
    : f === 'costUSD' ? 'cost ($)'
    : f === 'sellingPriceUSD' ? 'price ($)'
    : 'unit';
  const bulkTitle = (f: BulkField) =>
    f === 'costPHP' ? 'Set Cost (₱)'
    : f === 'sellingPricePHP' ? 'Set Price (₱)'
    : f === 'costUSD' ? 'Set Cost ($)'
    : f === 'sellingPriceUSD' ? 'Set Price ($)'
    : 'Set Unit';
  const bulkInputLabel = (f: BulkField) =>
    f === 'costPHP' ? 'Cost (₱)'
    : f === 'sellingPricePHP' ? 'Selling price (₱)'
    : f === 'costUSD' ? 'Cost ($)'
    : f === 'sellingPriceUSD' ? 'Selling price ($)'
    : 'Unit';

  const openBulk = (field: BulkField, rows: Product[]) => {
    if (rows.length === 0) return;
    setBulkField(field);
    setBulkRows(rows);
    setBulkValue('');
    setBulkError('');
  };
  const closeBulk = () => {
    setBulkRows(null);
    setBulkValue('');
    setBulkError('');
  };
  const confirmBulk = () => {
    if (!bulkRows) return;
    let value: string | number;
    let display: string;
    if (isNumericField(bulkField)) {
      const num = Number(bulkValue);
      if (!Number.isFinite(num) || num < 0) {
        setBulkError(`Enter a valid ${fieldLabel(bulkField)} value (0 or more).`);
        return;
      }
      value = num;
      display = isUsdField(bulkField) ? `$${formatNumber(num)}` : formatPHP(num);
    } else {
      const trimmed = bulkValue.trim();
      if (trimmed === '') {
        setBulkError('Select a unit.');
        return;
      }
      value = trimmed;
      display = trimmed;
    }
    const prev = bulkRows.map((p) => ({ id: p.id, value: p[bulkField] }));
    bulkRows.forEach((p) => updateProduct(p.id, { [bulkField]: value }));
    const count = bulkRows.length;
    setUndoSnapshot({
      message: `Set ${fieldLabel(bulkField)} to ${display} for ${count} product${count !== 1 ? 's' : ''}.`,
      field: bulkField,
      prev,
    });
    toast.success(`Updated ${fieldLabel(bulkField)} for ${count} product${count !== 1 ? 's' : ''}`);
    closeBulk();
  };

  const undoBulk = () => {
    if (!undoSnapshot) return;
    const { field, prev } = undoSnapshot;
    prev.forEach(({ id, value }) => updateProduct(id, { [field]: value }));
    setUndoSnapshot(null);
  };

  const withoutPrice = useMemo(() => noPriceCount(), [products]);
  const withoutCost = useMemo(() => noCostCount(), [products]);
  const avgMargin = useMemo(() => averageMarginPct(), [products]);

  // Drilldown filter driven by the "Without Price" / "Without Cost" KPI cards.
  // `?filter=no-price` or `?filter=no-cost` scopes the table to products missing
  // that field (₱); a dismissible banner lets the user clear it.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFilter = searchParams.get('filter'); // 'no-price' | 'no-cost' | null

  const applyFilter = (filter: 'no-price' | 'no-cost') => {
    const next = new URLSearchParams(searchParams);
    next.set('filter', filter);
    setSearchParams(next, { replace: true });
  };
  const clearFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('filter');
    setSearchParams(next, { replace: true });
  };

  const visibleProducts = useMemo(() => {
    if (activeFilter === 'no-price') return products.filter((p) => p.sellingPricePHP <= 0);
    if (activeFilter === 'no-cost') return products.filter((p) => p.costPHP <= 0);
    return products;
  }, [products, activeFilter]);

  /** Product count grouped by category, for the donut. */
  const productsByCategory = useMemo(() =>
    Object.entries(countByCategory())
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value),
    [products]
  );

  /** Margin % for a single product row */
  const marginPct = (p: Product) =>
    p.sellingPricePHP > 0 ? ((p.sellingPricePHP - p.costPHP) / p.sellingPricePHP) * 100 : 0;

  const columns: Column<Product>[] = [
    {
      key: 'category',
      header: 'Type',
      accessor: (p) => (
        <span className="text-xs font-medium text-berry-700 bg-berry-50 px-2 py-0.5 rounded-full">
          {p.category}
        </span>
      ),
      sortValue: (p) => p.category,
    },
    { key: 'subcategory', header: 'Variety / Item', accessor: (p) => p.subcategory || '—', sortValue: (p) => p.subcategory },
    { key: 'costPHP', header: 'Cost (₱)', accessor: (p) => formatPHP(p.costPHP), sortValue: (p) => p.costPHP, editable: { type: 'number', step: '0.01', min: 0, getValue: (p) => p.costPHP } },
    { key: 'sellingPricePHP', header: 'Price (₱)', accessor: (p) => formatPHP(p.sellingPricePHP), sortValue: (p) => p.sellingPricePHP, editable: { type: 'number', step: '0.01', min: 0, getValue: (p) => p.sellingPricePHP } },
    {
      key: 'margin',
      header: 'Margin %',
      accessor: (p) => {
        if (p.sellingPricePHP <= 0) return '—';
        const m = marginPct(p);
        const color = m >= 30 ? 'text-leaf-700' : m >= 10 ? 'text-gold-600' : 'text-red-600';
        return <span className={`font-medium ${color}`}>{m.toFixed(1)}%</span>;
      },
      sortValue: (p) => marginPct(p),
    },
    { key: 'costUSD', header: 'Cost ($)', accessor: (p) => p.costUSD > 0 ? `$${formatNumber(p.costUSD)}` : '—', sortValue: (p) => p.costUSD, editable: { type: 'number', step: '0.01', min: 0, getValue: (p) => p.costUSD } },
    { key: 'sellingPriceUSD', header: 'Price ($)', accessor: (p) => p.sellingPriceUSD > 0 ? `$${formatNumber(p.sellingPriceUSD)}` : '—', sortValue: (p) => p.sellingPriceUSD, editable: { type: 'number', step: '0.01', min: 0, getValue: (p) => p.sellingPriceUSD } },
    { key: 'unit', header: 'Unit', accessor: (p) => p.unit, sortValue: (p) => p.unit, editable: { type: 'select', options: unitOptions, getValue: (p) => p.unit } },
    { key: 'notes', header: 'Notes', accessor: (p) => <span className="text-gray-500 text-xs">{p.notes || '—'}</span>, sortValue: (p) => p.notes, editable: { type: 'text', getValue: (p) => p.notes } },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        subtitle={`${products.length} product${products.length !== 1 ? 's' : ''}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Add Product</Button>}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard title="Total Products" value={products.length} icon={Package} iconColor="text-berry-600" iconBg="bg-berry-50" />
        <StatCard
          title="Products without Price"
          value={`${withoutPrice} of ${products.length}`}
          subtitle={withoutPrice > 0 ? 'Missing a selling price (₱) — click to view' : 'All products have a price (₱)'}
          icon={Tag}
          iconColor={withoutPrice > 0 ? 'text-red-500' : 'text-leaf-600'}
          iconBg={withoutPrice > 0 ? 'bg-red-50' : 'bg-leaf-50'}
          titleColor={withoutPrice > 0 ? 'text-red-600' : undefined}
          valueColor={withoutPrice > 0 ? 'text-red-600' : undefined}
          onClick={withoutPrice > 0 ? () => applyFilter('no-price') : undefined}
        />
        <StatCard
          title="Products without Cost"
          value={`${withoutCost} of ${products.length}`}
          subtitle={withoutCost > 0 ? 'Missing a cost (₱) — click to view' : 'All products have a cost (₱)'}
          icon={Tag}
          iconColor={withoutCost > 0 ? 'text-red-500' : 'text-leaf-600'}
          iconBg={withoutCost > 0 ? 'bg-red-50' : 'bg-leaf-50'}
          titleColor={withoutCost > 0 ? 'text-red-600' : undefined}
          valueColor={withoutCost > 0 ? 'text-red-600' : undefined}
          onClick={withoutCost > 0 ? () => applyFilter('no-cost') : undefined}
        />
        <StatCard title="Avg Margin" value={`${avgMargin.toFixed(1)}%`} subtitle="Across priced products" icon={Percent} iconColor="text-primary-600" iconBg="bg-primary-50" />
      </div>

      {/* Products by category chart */}
      {products.length > 0 && productsByCategory.length > 0 && (
        <CollapsibleSection title="Analytics" subtitle="Charts" storageKey="products.analytics.collapsed">
        <SectionCard title="Products by Category" subtitle="How many products in each category">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={productsByCategory}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy={PIE_CENTER_Y}
                innerRadius={PIE_INNER_RADIUS}
                outerRadius={PIE_OUTER_RADIUS}
                paddingAngle={1}
                label={renderPieValueLabel}
                labelLine={false}
              >
                {productsByCategory.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => `${Number(v)} products`}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
        </CollapsibleSection>
      )}

      {/* Active drilldown banner from the "Without Price / Without Cost" cards */}
      {activeFilter && products.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          <span>
            Showing{' '}
            <span className="font-semibold">
              {activeFilter === 'no-price' ? withoutPrice : withoutCost}
            </span>{' '}
            product{(activeFilter === 'no-price' ? withoutPrice : withoutCost) !== 1 ? 's' : ''}{' '}
            without {activeFilter === 'no-price' ? 'a selling price' : 'a cost'} (₱).
          </span>
          <button
            type="button"
            onClick={clearFilter}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <X className="w-3.5 h-3.5" /> Clear filter
          </button>
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState icon={Package} title="No products yet" description="Add your first product to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Product</Button>} />
      ) : (
        <>
        {undoSnapshot && (
          <UndoBar
            message={undoSnapshot.message}
            onUndo={undoBulk}
            onDismiss={() => setUndoSnapshot(null)}
          />
        )}
        <Table
          data={visibleProducts}
          columns={columns}
          keyExtractor={(p) => p.id}
          searchFilter={(p, q) =>
            p.category.toLowerCase().includes(q) ||
            p.subcategory.toLowerCase().includes(q) ||
            p.unit.toLowerCase().includes(q) ||
            p.notes.toLowerCase().includes(q)
          }
          searchPlaceholder="Search products…"
          actions={(p) => <RowActions onEdit={() => crud.openEdit(p)} onDelete={() => crud.requestDelete(p)} />}
          bulkActions={{
            noun: 'product',
            actions: [
              { label: 'Set Cost (₱)', icon: <ListChecks className="w-4 h-4" />, onClick: (rows) => openBulk('costPHP', rows) },
              { label: 'Set Price (₱)', icon: <ListChecks className="w-4 h-4" />, onClick: (rows) => openBulk('sellingPricePHP', rows) },
              { label: 'Set Cost ($)', icon: <ListChecks className="w-4 h-4" />, onClick: (rows) => openBulk('costUSD', rows) },
              { label: 'Set Price ($)', icon: <ListChecks className="w-4 h-4" />, onClick: (rows) => openBulk('sellingPriceUSD', rows) },
              { label: 'Set Unit', icon: <ListChecks className="w-4 h-4" />, onClick: (rows) => openBulk('unit', rows) },
            ],
            onDelete: (rows) => rows.forEach((p) => deleteProduct(p.id)),
          }}
          onCellEdit={(p, key, value) => updateProduct(p.id, { [key]: value })}
          persistKey="products"
          defaultSort={{ key: 'subcategory', dir: 'asc' }}
          getRecency={(p) => p.createdAt}
        />
        </>
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Product' : 'Add Product'} size="lg">
        <ProductForm product={crud.editing} onClose={crud.closeModal} />
      </Modal>

      {/* Bulk-set cost, price or unit across the selected products (undoable) */}
      <Modal
        open={!!bulkRows}
        onClose={closeBulk}
        title={bulkTitle(bulkField)}
        size="sm"
      >
        {bulkRows && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Set the {fieldLabel(bulkField)} for{' '}
              <span className="font-medium text-gray-900">{bulkRows.length}</span> selected
              product{bulkRows.length !== 1 ? 's' : ''}. You can undo this right after.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {bulkInputLabel(bulkField)}
              </label>
              {bulkField === 'unit' ? (
                <select
                  autoFocus
                  value={bulkValue}
                  onChange={(e) => { setBulkValue(e.target.value); setBulkError(''); }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select…</option>
                  {unitOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  autoFocus
                  value={bulkValue}
                  onChange={(e) => { setBulkValue(e.target.value); setBulkError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmBulk(); } }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              )}
              {bulkError && <p className="text-xs text-red-500 mt-1">{bulkError}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeBulk}>Cancel</Button>
              <Button icon={<ListChecks className="w-4 h-4" />} onClick={confirmBulk}>Apply to {bulkRows.length}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((p) => deleteProduct(p.id))}
        message={`Delete "${crud.deleteTarget?.category ?? ''}${crud.deleteTarget?.subcategory ? ` – ${crud.deleteTarget.subcategory}` : ''}"? This cannot be undone.`}
      />
    </div>
  );
}
