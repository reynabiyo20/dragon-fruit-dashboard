import { useMemo } from 'react';
import { Plus, Package, Tag, Percent } from 'lucide-react';
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
import { RowActions } from '../../components/ui/RowActions';
import { formatPHP, formatNumber } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { ProductForm } from './ProductForm';

export function ProductsPage() {
  const { products, deleteProduct, updateProduct, pricedCount, averageMarginPct } = useProductStore();
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const crud = useListCrud<Product>();

  const priced = useMemo(() => pricedCount(), [products]);
  const avgMargin = useMemo(() => averageMarginPct(), [products]);
  const allPriced = products.length > 0 && priced === products.length;

  /** Margin % for a single product row */
  const marginPct = (p: Product) =>
    p.sellingPricePHP > 0 ? ((p.sellingPricePHP - p.costPHP) / p.sellingPricePHP) * 100 : 0;

  const columns: Column<Product>[] = [
    {
      key: 'category',
      header: 'Type',
      accessor: (p) => (
        <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
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
        const color = m >= 30 ? 'text-green-700' : m >= 10 ? 'text-yellow-600' : 'text-red-600';
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
        <StatCard title="Total Products" value={products.length} icon={Package} iconColor="text-purple-600" iconBg="bg-purple-50" />
        <StatCard
          title="Priced Products"
          value={`${priced} of ${products.length}`}
          subtitle={allPriced ? 'All products are priced' : `${products.length - priced} without a price`}
          icon={Tag}
          iconColor={allPriced ? 'text-green-600' : 'text-red-500'}
          iconBg={allPriced ? 'bg-green-50' : 'bg-red-50'}
        />
        <StatCard title="Avg Margin" value={`${avgMargin.toFixed(1)}%`} subtitle="Across priced products" icon={Percent} iconColor="text-green-600" iconBg="bg-green-50" />
      </div>

      {products.length === 0 ? (
        <EmptyState icon={Package} title="No products yet" description="Add your first product to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Product</Button>} />
      ) : (
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
          bulkActions={{ noun: 'product', onDelete: (rows) => rows.forEach((p) => deleteProduct(p.id)) }}
          onCellEdit={(p, key, value) => updateProduct(p.id, { [key]: value })}
        />
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Product' : 'Add Product'} size="lg">
        <ProductForm product={crud.editing} onClose={crud.closeModal} />
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
