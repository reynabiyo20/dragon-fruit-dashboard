import { Plus, ShoppingCart, TrendingUp, Clock } from 'lucide-react';
import { useSaleStore } from '../../store/saleStore';
import { useCommissionStore } from '../../store/commissionStore';
import type { Sale } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { RowActions } from '../../components/ui/RowActions';
import { formatPHP, formatDate } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { SaleForm } from './SaleForm';

export function SalesPage() {
  const { sales, deleteSale, updateSale, totalRevenue, totalPaid, totalUnpaid } = useSaleStore();
  const { removeForSale } = useCommissionStore();
  const crud = useListCrud<Sale>();

  const columns: Column<Sale>[] = [
    { key: 'date', header: 'Date', accessor: (s) => formatDate(s.date), sortValue: (s) => s.date },
    { key: 'invoiceNumber', header: 'Invoice #', accessor: (s) => s.invoiceNumber || '—', sortValue: (s) => s.invoiceNumber ?? '' },
    { key: 'customerName', header: 'Customer', accessor: (s) => <span className="font-medium">{s.customerName}</span>, sortValue: (s) => s.customerName },
    { key: 'soldByName', header: 'Sold By', accessor: (s) => s.soldByName ? <span className="text-blue-700">{s.soldByName}</span> : '—', sortValue: (s) => s.soldByName ?? '' },
    {
      key: 'items',
      header: 'Items',
      accessor: (s) => {
        if (s.items.length === 0) return <span className="text-gray-400">—</span>;
        const MAX_SHOWN = 3;
        const shown = s.items.slice(0, MAX_SHOWN);
        const remaining = s.items.length - shown.length;
        return (
          <div className="flex flex-col gap-0.5">
            {shown.map((item, idx) => (
              <span key={idx} className="text-xs text-gray-700 whitespace-nowrap">
                {item.productName || 'Unknown'}
                <span className="text-gray-400"> ×{item.quantity}</span>
              </span>
            ))}
            {remaining > 0 && (
              <span className="text-xs text-gray-400">+{remaining} more</span>
            )}
          </div>
        );
      },
      sortValue: (s) => s.items.length,
    },
    { key: 'subtotal', header: 'Total', accessor: (s) => <span className="font-semibold text-gray-900">{formatPHP(s.subtotal)}</span>, sortValue: (s) => s.subtotal },
    { key: 'paymentMethod', header: 'Payment', accessor: (s) => s.paymentMethod || '—', sortValue: (s) => s.paymentMethod ?? '' },
    {
      key: 'paid',
      header: 'Status',
      accessor: (s) => (
        <button
          type="button"
          onClick={() => updateSale(s.id, { paid: !s.paid })}
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-green-500 ${
            s.paid
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
          }`}
          title={s.paid ? 'Mark as unpaid' : 'Mark as paid'}
          aria-label={`Payment status: ${s.paid ? 'Paid' : 'Unpaid'}. Click to mark as ${s.paid ? 'unpaid' : 'paid'}.`}
        >
          {s.paid ? 'Paid' : 'Unpaid'}
        </button>
      ),
      sortValue: (s) => (s.paid ? 1 : 0),
    },
    {
      key: 'delivered',
      header: 'Delivery',
      accessor: (s) => {
        const hasCuttings = s.items.some((i) => (i.productName ?? '').toLowerCase().includes('cutting'));
        // Only cutting orders track delivery; others show a neutral dash.
        if (!hasCuttings && !s.delivered) return <span className="text-gray-300">—</span>;
        return (
          <button
            type="button"
            onClick={() => updateSale(s.id, { delivered: !s.delivered })}
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-green-500 ${
              s.delivered
                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title={s.delivered ? 'Mark as not delivered' : 'Mark as delivered'}
            aria-label={`Delivery status: ${s.delivered ? 'Delivered' : 'Pending'}. Click to toggle.`}
          >
            {s.delivered ? 'Delivered' : 'Pending'}
          </button>
        );
      },
      sortValue: (s) => (s.delivered ? 1 : 0),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        subtitle={`${sales.length} transaction${sales.length !== 1 ? 's' : ''}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>New Sale</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Revenue" value={formatPHP(totalRevenue())} icon={TrendingUp} iconColor="text-green-600" iconBg="bg-green-50" />
        <StatCard title="Collected" value={formatPHP(totalPaid())} icon={ShoppingCart} iconColor="text-blue-600" iconBg="bg-blue-50" />
        <StatCard title="Outstanding" value={formatPHP(totalUnpaid())} icon={Clock} iconColor="text-orange-500" iconBg="bg-orange-50" />
      </div>

      {sales.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No sales yet" description="Record your first sale to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>New Sale</Button>} />
      ) : (
        <Table
          data={sales}
          columns={columns}
          keyExtractor={(s) => s.id}
          searchFilter={(s, q) =>
            s.customerName.toLowerCase().includes(q) ||
            (s.invoiceNumber ?? '').toLowerCase().includes(q) ||
            s.paymentMethod.toLowerCase().includes(q) ||
            (s.soldByName ?? '').toLowerCase().includes(q) ||
            s.items.some((i) => (i.productName ?? '').toLowerCase().includes(q))
          }
          searchPlaceholder="Search sales…"
          actions={(s) => <RowActions onEdit={() => crud.openEdit(s)} onDelete={() => crud.requestDelete(s)} />}
          bulkActions={{
            noun: 'sale',
            onDelete: (rows) => rows.forEach((s) => { removeForSale(s.id); deleteSale(s.id); }),
          }}
        />
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Sale' : 'New Sale'} size="2xl">
        <SaleForm sale={crud.editing} onClose={crud.closeModal} />
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((s) => { removeForSale(s.id); deleteSale(s.id); })}
        message={`Delete sale "${crud.deleteTarget?.invoiceNumber || crud.deleteTarget?.id.slice(0, 8)}"? This cannot be undone.`}
      />
    </div>
  );
}
