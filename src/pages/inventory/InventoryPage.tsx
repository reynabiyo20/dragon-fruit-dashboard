import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { LOW_STOCK_THRESHOLD, CUTTINGS_PRODUCT_TYPE } from '../../constants';
import { InventoryForm } from './InventoryForm';

export function InventoryPage() {
  const { items, deleteItem, updateItem, totalValue, lowStockItems } = useInventoryStore();
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const crud = useListCrud<InventoryItem>();
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  // Deep-link support: /inventory?highlight=<variety> (e.g. from the Cuttings
  // Store "view inventory" link). Highlights the matching Cuttings row so the
  // packed stock is easy to spot; clears when the highlight is dismissed.
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightVariety = (searchParams.get('highlight') ?? '').trim().toLowerCase();
  const highlightRow = (i: InventoryItem) =>
    !!highlightVariety &&
    i.category === CUTTINGS_PRODUCT_TYPE &&
    i.subcategory.trim().toLowerCase() === highlightVariety;
  const highlightedItem = highlightVariety ? items.find(highlightRow) : undefined;
  const clearHighlight = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('highlight');
    setSearchParams(next, { replace: true });
  };

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
      key: 'packed',
      header: 'Packed',
      // Cuttings become on-hand sellable stock when "Marked as Packed" — this
      // adds into Ending Qty. 0 for non-cuttings rows.
      accessor: (i) => {
        const qty = i.packed ?? 0;
        return <span className={qty > 0 ? 'font-medium text-blue-700' : 'text-gray-400'}>{formatNumber(qty, 0)}</span>;
      },
      sortValue: (i) => i.packed ?? 0,
    },
    {
      key: 'endingQty',
      header: 'Ending Qty',
      // beginning + purchased − used − sold + packed
      accessor: (i) => <span className={endingClass(i.endingQty)}>{formatNumber(i.endingQty, 2)}</span>,
      sortValue: (i) => i.endingQty,
      headerClassName: 'whitespace-nowrap',
    },
    {
      key: 'availableForSale',
      header: 'Available for Sale',
      // The still-unsold packed cuttings (packed − delivered). A subset of Ending
      // Qty, not an addition to it. Delivering a cutting sale reduces this.
      accessor: (i) => {
        const qty = i.availableForSale ?? 0;
        return (
          <span className={qty > 0 ? 'font-semibold text-blue-700' : 'text-gray-400'}>
            {formatNumber(qty, 0)}
          </span>
        );
      },
      sortValue: (i) => i.availableForSale ?? 0,
    },
    {
      key: 'breedingStock',
      header: 'Our Farm Breeding Stock',
      // Units reserved for our own plots — credited when a batch is flagged
      // "For Replant in Farm", cleared when it is "Marked as Planted".
      accessor: (i) => {
        const qty = i.breedingStock ?? 0;
        return (
          <span className={qty > 0 ? 'font-semibold text-purple-700' : 'text-gray-400'}>
            {formatNumber(qty, 0)}
          </span>
        );
      },
      sortValue: (i) => i.breedingStock ?? 0,
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
        subtitle={`${items.length} item${items.length !== 1 ? 's' : ''} · Ending Qty = beginning + purchased − used − sold + packed`}
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

      {/* Deep-link highlight banner (from the Cuttings "view inventory" link) */}
      {highlightVariety && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5">
          <p className="text-sm text-blue-800">
            {highlightedItem
              ? <>Showing <span className="font-semibold">{highlightedItem.subcategory}</span> cuttings — <span className="font-semibold">{formatNumber(highlightedItem.availableForSale ?? 0, 0)}</span> in Available Stock for Sale.</>
              : <>No cuttings inventory row found for "{searchParams.get('highlight')}".</>}
          </p>
          <button
            type="button"
            onClick={clearHighlight}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline flex-shrink-0"
          >
            Clear
          </button>
        </div>
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
          // Highlight the deep-linked Cuttings row (from the packed-cutting link).
          rowClassName={(i) => (highlightRow(i) ? 'bg-blue-50 hover:bg-blue-100' : '')}
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
