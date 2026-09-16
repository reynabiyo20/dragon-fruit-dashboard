import { useMemo } from 'react';
import { Plus, Receipt } from 'lucide-react';
import { useExpenseStore } from '../../store/expenseStore';
import type { Expense } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { RowActions } from '../../components/ui/RowActions';
import { formatPHP, formatDate } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { ExpenseForm } from './ExpenseForm';

export function ExpensesPage() {
  const { expenses, deleteExpense, updateExpense, totalExpenses, totalByCategory } = useExpenseStore();
  const crud = useListCrud<Expense>();

  const categoryTotals = useMemo(() => totalByCategory(), [expenses]);
  const topCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = useMemo(() => totalExpenses(), [expenses]);

  const columns: Column<Expense>[] = [
    { key: 'date', header: 'Date', accessor: (e) => formatDate(e.date), sortValue: (e) => e.date },
    { key: 'vendorName', header: 'Vendor', accessor: (e) => e.vendorName || '—', sortValue: (e) => e.vendorName },
    { key: 'category', header: 'Category', accessor: (e) => <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{e.category}</span>, sortValue: (e) => e.category },
    {
      key: 'description',
      header: 'Description',
      accessor: (e) => {
        // Itemized expenses render as a vertical list (one line per item),
        // mirroring the Sales table's Items column. Single-line expenses fall
        // back to their free-text description.
        const items = e.items ?? [];
        if (items.length > 0) {
          const MAX_SHOWN = 3;
          const shown = items.slice(0, MAX_SHOWN);
          const remaining = items.length - shown.length;
          return (
            <div className="flex flex-col gap-0.5">
              {shown.map((item, idx) => (
                <span key={idx} className="text-xs text-gray-700 whitespace-nowrap">
                  {item.name || 'Item'}
                  <span className="text-gray-400"> ×{item.quantity}</span>
                </span>
              ))}
              {remaining > 0 && (
                <span className="text-xs text-gray-400">+{remaining} more</span>
              )}
            </div>
          );
        }
        return <span>{e.description || '—'}</span>;
      },
      sortValue: (e) => (e.items && e.items.length > 0 ? e.items.length : e.description),
    },
    { key: 'amount', header: 'Amount', accessor: (e) => <span className="font-semibold text-gray-900">{formatPHP(e.amount)}</span>, sortValue: (e) => e.amount },
    { key: 'paymentMethod', header: 'Payment', accessor: (e) => e.paymentMethod || '—', sortValue: (e) => e.paymentMethod },
    {
      key: 'paid',
      header: 'Status',
      accessor: (e) => (
        <button
          type="button"
          onClick={() => updateExpense(e.id, { paid: !e.paid })}
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-green-500 ${
            e.paid
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
          }`}
          title={e.paid ? 'Mark as pending' : 'Mark as paid'}
          aria-label={`Payment status: ${e.paid ? 'Paid' : 'Pending'}. Click to mark as ${e.paid ? 'pending' : 'paid'}.`}
        >
          {e.paid ? 'Paid' : 'Pending'}
        </button>
      ),
      sortValue: (e) => (e.paid ? 1 : 0),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle={`${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Add Expense</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard title="Total Expenses" value={formatPHP(total)} icon={Receipt} iconColor="text-red-500" iconBg="bg-red-50" />
        <StatCard title="Expense Categories" value={Object.keys(categoryTotals).length} icon={Receipt} iconColor="text-purple-600" iconBg="bg-purple-50" />
      </div>

      {topCategories.length > 0 && (
        <SectionCard title="Top Expense Categories">
          <div className="space-y-2">
            {topCategories.map(([cat, amt]) => {
              const pct = total > 0 ? (amt / total) * 100 : 0;
              return (
                <div key={cat}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-700 font-medium">{cat}</span>
                    <span className="text-gray-500">{formatPHP(amt)} ({pct.toFixed(1)}%)</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="bg-red-400 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {expenses.length === 0 ? (
        <EmptyState icon={Receipt} title="No expenses yet" description="Track your first expense to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Expense</Button>} />
      ) : (
        <Table
          data={expenses}
          columns={columns}
          keyExtractor={(e) => e.id}
          searchFilter={(e, q) =>
            e.vendorName.toLowerCase().includes(q) ||
            e.category.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.paymentMethod.toLowerCase().includes(q) ||
            (e.items ?? []).some((it) => (it.name ?? '').toLowerCase().includes(q))
          }
          searchPlaceholder="Search expenses…"
          actions={(e) => <RowActions onEdit={() => crud.openEdit(e)} onDelete={() => crud.requestDelete(e)} />}
          bulkActions={{ noun: 'expense', onDelete: (rows) => rows.forEach((e) => deleteExpense(e.id)) }}
        />
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Expense' : 'Add Expense'} size="lg">
        <ExpenseForm key={crud.editing?.id ?? 'new'} expense={crud.editing} onClose={crud.closeModal} />
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((e) => deleteExpense(e.id))}
        message={`Delete this expense of ${formatPHP(crud.deleteTarget?.amount ?? 0)}? This cannot be undone.`}
      />
    </div>
  );
}
