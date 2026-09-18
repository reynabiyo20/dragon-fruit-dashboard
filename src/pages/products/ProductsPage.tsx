import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Package, Tag, Percent, ListChecks } from 'lucide-react';
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
  const { products, deleteProduct, updateProduct, pricedCount, averageMarginPct, countByCategory } = useProductStore();
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const crud = useListCrud<Product>();

  // ── Bulk edit price/cost + undo ─────────────────────────────────────────────
  // Selecting rows and choosing "Set Cost" or "Set Price" opens a small modal to
  // enter one value applied to every selected product. We snapshot each row's
  // previous value so the whole change can be reverted in one click; the Undo bar
  // shows only while a snapshot exists.
  type BulkField = 'costPHP' | 'sellingPricePHP';
  const [bulkRows, setBulkRows] = useState<Product[] | null>(null);
  const [bulkField, setBulkField] = useState<BulkField>('costPHP');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [undoSnapshot, setUndoSnapshot] = useState<{ message: string; field: BulkField; prev: { id: string; value: number }[] } | null>(null);

  const fieldLabel = (f: BulkField) => (f === 'costPHP' ? 'cost' : 'price');

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
    const value = Number(bulkValue);
    if (!Number.isFinite(value) || value < 0) {
      setBulkError(`Enter a valid ${fieldLabel(bulkField)} (0 or more).`);
      return;
    }
    const prev = bulkRows.map((p) => ({ id: p.id, value: p[bulkField] }));
    bulkRows.forEach((p) => updateProduct(p.id, { [bulkField]: value }));
    const count = bulkRows.length;
    setUndoSnapshot({
      message: `Set ${fieldLabel(bulkField)} to ${formatPHP(value)} for ${count} product${count !== 1 ? 's' : ''}.`,
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

  const priced = useMemo(() => pricedCount(), [products]);
  const avgMargin = useMemo(() => averageMarginPct(), [products]);
  const allPriced = products.length > 0 && priced === products.length;

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
    { key: 'costUSD', header: 'Cost ($)', accessor: (p) => p.costUSD > 0 ? `$${formatNumber(p.costUSD)}` : '—', sortValue: (p) => p.costUSD },
    { key: 'sellingPriceUSD', header: 'Price ($)', accessor: (p) => p.sellingPriceUSD > 0 ? `$${formatNumber(p.sellingPriceUSD)}` : '—', sortValue: (p) => p.sellingPriceUSD },
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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard title="Total Products" value={products.length} icon={Package} iconColor="text-berry-600" iconBg="bg-berry-50" />
        <StatCard
          title="Priced Products"
          value={`${priced} of ${products.length}`}
          subtitle={allPriced ? 'All products are priced' : `${products.length - priced} without a price`}
          icon={Tag}
          iconColor={allPriced ? 'text-leaf-600' : 'text-red-500'}
          iconBg={allPriced ? 'bg-leaf-50' : 'bg-red-50'}
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
          data={products}
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
              { label: 'Set Cost', icon: <ListChecks className="w-4 h-4" />, onClick: (rows) => openBulk('costPHP', rows) },
              { label: 'Set Price', icon: <ListChecks className="w-4 h-4" />, onClick: (rows) => openBulk('sellingPricePHP', rows) },
            ],
            onDelete: (rows) => rows.forEach((p) => deleteProduct(p.id)),
          }}
          onCellEdit={(p, key, value) => updateProduct(p.id, { [key]: value })}
          defaultSort={{ key: 'subcategory', dir: 'asc' }}
          getRecency={(p) => p.createdAt}
        />
        </>
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Product' : 'Add Product'} size="lg">
        <ProductForm product={crud.editing} onClose={crud.closeModal} />
      </Modal>

      {/* Bulk-set cost or price across the selected products (undoable) */}
      <Modal open={!!bulkRows} onClose={closeBulk} title={bulkField === 'costPHP' ? 'Set Cost' : 'Set Price'} size="sm">
        {bulkRows && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Set the {fieldLabel(bulkField)} (₱) for{' '}
              <span className="font-medium text-gray-900">{bulkRows.length}</span> selected
              product{bulkRows.length !== 1 ? 's' : ''}. You can undo this right after.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {bulkField === 'costPHP' ? 'Cost (₱)' : 'Selling price (₱)'}
              </label>
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
