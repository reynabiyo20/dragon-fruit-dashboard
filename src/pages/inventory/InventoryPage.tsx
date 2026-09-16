import { useState, useMemo } from 'react';
import { Plus, Sprout, AlertTriangle, DollarSign } from 'lucide-react';
import { useInventoryStore } from '../../store/inventoryStore';
import { useUnitStore } from '../../store/optionStores';
import type { InventoryItem } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { Badge } from '../../components/ui/Badge';
import { RowActions } from '../../components/ui/RowActions';
import { formatNumber, formatPHP } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { LOW_STOCK_THRESHOLD } from '../../constants';
import { InventoryForm } from './InventoryForm';

export function InventoryPage() {
  const { items, deleteItem, updateItem, totalValue, lowStockItems } = useInventoryStore();
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const crud = useListCrud<InventoryItem>();
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  const alerts = useMemo(() => lowStockItems(LOW_STOCK_THRESHOLD), [items]);
  const invValue = useMemo(() => totalValue(), [items]);
  const displayItems = showLowStockOnly ? alerts : items;

  const endingClass = (qty: number) =>
    qty < 0 ? 'text-red-600 font-bold' : qty === 0 ? 'text-gray-400' : 'text-green-700 font-semibold';

  const itemValue = (i: InventoryItem) => i.endingQty * i.unitCost;

  const columns: Column<InventoryItem>[] = [
    {
      key: 'category',
      header: 'Type',
      accessor: (i) => (
        <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
          {i.category}
        </span>
      ),
      sortValue: (i) => i.category,
    },
    {
      key: 'subcategory',
      header: 'Variety / Item',
      accessor: (i) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-gray-900">{i.subcategory}</span>
          {alerts.some((a) => a.id === i.id) && (
            <AlertTriangle className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" aria-label="Low stock" />
          )}
        </div>
      ),
      sortValue: (i) => i.subcategory,
    },
    { key: 'unit',         header: 'Unit',       accessor: (i) => i.unit,                          sortValue: (i) => i.unit,         editable: { type: 'select', options: unitOptions, getValue: (i) => i.unit } },
    { key: 'beginningQty', header: 'Beginning',  accessor: (i) => formatNumber(i.beginningQty, 2), sortValue: (i) => i.beginningQty, editable: { type: 'number', step: '0.01', min: 0, getValue: (i) => i.beginningQty } },
    { key: 'purchased',    header: 'Purchased',  accessor: (i) => formatNumber(i.purchased, 2),    sortValue: (i) => i.purchased,    editable: { type: 'number', step: '0.01', min: 0, getValue: (i) => i.purchased } },
    { key: 'used',         header: 'Used',       accessor: (i) => formatNumber(i.used, 2),         sortValue: (i) => i.used,         editable: { type: 'number', step: '0.01', min: 0, getValue: (i) => i.used } },
    { key: 'sold',         header: 'Sold',       accessor: (i) => formatNumber(i.sold, 2),         sortValue: (i) => i.sold,         editable: { type: 'number', step: '0.01', min: 0, getValue: (i) => i.sold } },
    {
      key: 'endingQty',
      header: 'Ending Qty',
      accessor: (i) => <span className={endingClass(i.endingQty)}>{formatNumber(i.endingQty, 2)}</span>,
      sortValue: (i) => i.endingQty,
    },
    {
      key: 'unitCost',
      header: 'Unit Cost (₱)',
      accessor: (i) => i.unitCost > 0 ? formatPHP(i.unitCost) : '—',
      sortValue: (i) => i.unitCost,
    },
    {
      key: 'value',
      header: 'Value (₱)',
      accessor: (i) => (
        <span className="font-medium text-gray-700">
          {i.unitCost > 0 ? formatPHP(itemValue(i)) : '—'}
        </span>
      ),
      sortValue: (i) => itemValue(i),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        subtitle={`${items.length} item${items.length !== 1 ? 's' : ''} · Ending qty auto-calculated`}
        actions={
          <div className="flex items-center gap-2">
            {alerts.length > 0 && (
              <Button
                variant={showLowStockOnly ? 'primary' : 'outline'}
                size="sm"
                icon={<AlertTriangle className="w-4 h-4" />}
                onClick={() => setShowLowStockOnly((v) => !v)}
              >
                {showLowStockOnly ? 'Show All' : `Low Stock (${alerts.length})`}
              </Button>
            )}
            <Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Add Item</Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Items" value={items.length} icon={Sprout} iconColor="text-green-600" iconBg="bg-green-50" />
        <StatCard title="Total Inventory Value" value={formatPHP(invValue)} subtitle="Sum of ending qty × unit cost" icon={DollarSign} iconColor="text-blue-600" iconBg="bg-blue-50" />
        <StatCard
          title="Low Stock Alerts"
          value={alerts.length}
          subtitle={alerts.length > 0 ? `Items at or below ${LOW_STOCK_THRESHOLD} units` : 'All items well stocked'}
          icon={AlertTriangle}
          iconColor={alerts.length > 0 ? 'text-red-500' : 'text-green-600'}
          iconBg={alerts.length > 0 ? 'bg-red-50' : 'bg-green-50'}
        />
      </div>

      {/* Low stock alert banner */}
      {alerts.length > 0 && !showLowStockOnly && (
        <SectionCard title="⚠️ Low Stock Items" subtitle="These items are running low and may need restocking">
          <div className="flex flex-wrap gap-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg">
                <span className="text-sm font-medium text-orange-800">{a.subcategory}</span>
                <Badge label={`${formatNumber(a.endingQty, 2)} ${a.unit}`} variant="yellow" />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title="No inventory items yet"
          description="Add items to track beginning qty, purchases, usage, and sales."
          action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Item</Button>}
        />
      ) : (
        <Table
          data={displayItems}
          columns={columns}
          keyExtractor={(i) => i.id}
          searchFilter={(i, q) =>
            i.subcategory.toLowerCase().includes(q) ||
            i.category.toLowerCase().includes(q) ||
            i.unit.toLowerCase().includes(q) ||
            i.notes.toLowerCase().includes(q)
          }
          searchPlaceholder={showLowStockOnly ? 'Search low-stock items…' : 'Search inventory…'}
          emptyMessage={showLowStockOnly ? 'No low-stock items found.' : 'No inventory items found.'}
          actions={(i) => <RowActions onEdit={() => crud.openEdit(i)} onDelete={() => crud.requestDelete(i)} />}
          bulkActions={{ noun: 'item', onDelete: (rows) => rows.forEach((i) => deleteItem(i.id)) }}
          onCellEdit={(i, key, value) => updateItem(i.id, { [key]: value })}
        />
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Inventory Item' : 'Add Inventory Item'} size="lg">
        <InventoryForm item={crud.editing} onClose={crud.closeModal} />
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((i) => deleteItem(i.id))}
        message={`Delete inventory item "${crud.deleteTarget?.subcategory}"? This cannot be undone.`}
      />
    </div>
  );
}
