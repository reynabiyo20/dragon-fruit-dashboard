import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Receipt, CheckCircle2, CircleDashed } from 'lucide-react';
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
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { RowActions } from '../../components/ui/RowActions';
import { UndoBar } from '../../components/ui/UndoBar';
import { PeriodFilter } from '../../components/ui/PeriodFilter';
import {
  type PeriodFilter as Period, ALL_PERIODS, availableYears, dateMatchesPeriod,
} from '../../utils/period';
import { formatPHP, formatDate, formatNumber, categoryLabel } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { PIE_COLORS } from '../../constants/chartColors';
import { ExpenseForm } from './ExpenseForm';

export function ExpensesPage() {
  const { expenses, deleteExpense, updateExpense, totalExpenses, totalByCategory } = useExpenseStore();
  const crud = useListCrud<Expense>();
  const navigate = useNavigate();

  // ── Bulk status edit + undo ─────────────────────────────────────────────────
  // Snapshot each affected expense's previous `paid` value so a bulk change can
  // be reverted in one click. The Undo bar shows only while a snapshot exists.
  const [undoSnapshot, setUndoSnapshot] = useState<{ message: string; prev: { id: string; paid: boolean }[] } | null>(null);

  const bulkSetPaid = (rows: Expense[], paid: boolean) => {
    if (rows.length === 0) return;
    const prev = rows.map((e) => ({ id: e.id, paid: e.paid }));
    rows.forEach((e) => updateExpense(e.id, { paid }));
    setUndoSnapshot({
      message: `Marked ${rows.length} expense${rows.length !== 1 ? 's' : ''} as ${paid ? 'paid' : 'pending'}.`,
      prev,
    });
  };

  const undoBulk = () => {
    if (!undoSnapshot) return;
    undoSnapshot.prev.forEach(({ id, paid }) => updateExpense(id, { paid }));
    setUndoSnapshot(null);
  };

  // ── Period filter (drives the Top Expense Categories list; KPIs stay all-time) ─
  const [period, setPeriod] = useState<Period>(ALL_PERIODS);
  const years = useMemo(() => availableYears(expenses.map((e) => e.date)), [expenses]);
  const filteredExpenses = useMemo(
    () => expenses.filter((e) => dateMatchesPeriod(e.date, period)),
    [expenses, period],
  );

  // KPI cards stay all-time (store selectors); the category breakdown reflects
  // the selected period, grouped by the combined "Category – Subcategory" label.
  const categoryTotals = useMemo(() => totalByCategory(), [expenses]);
  const filteredCategoryTotals = useMemo(() => {
    const byLabel: Record<string, number> = {};
    for (const e of filteredExpenses) {
      const label = categoryLabel(e.category, e.subcategory);
      byLabel[label] = (byLabel[label] ?? 0) + e.amount;
    }
    return byLabel;
  }, [filteredExpenses]);
  const topCategories = Object.entries(filteredCategoryTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const filteredTotal = useMemo(
    () => filteredExpenses.reduce((sum, e) => sum + e.amount, 0),
    [filteredExpenses],
  );
  const total = useMemo(() => totalExpenses(), [expenses]);

  const columns: Column<Expense>[] = [
    { key: 'date', header: 'Date', accessor: (e) => formatDate(e.date), sortValue: (e) => e.date },
    {
      key: 'vendorName',
      header: 'Vendor',
      accessor: (e) => {
        if (!e.vendorName) return '—';
        // Link to the vendor's row in the Vendors table when we have its id;
        // otherwise show the plain (unlinked) name.
        if (!e.vendorId) return <span className="text-gray-700">{e.vendorName}</span>;
        return (
          <button
            type="button"
            onClick={() => navigate(`/vendors?focus=${encodeURIComponent(e.vendorId)}`)}
            className="text-primary-700 hover:text-primary-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
            title={`View ${e.vendorName} in Vendors`}
          >
            {e.vendorName}
          </button>
        );
      },
      sortValue: (e) => e.vendorName,
    },
    { key: 'category', header: 'Category', accessor: (e) => <span className="text-xs font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">{e.category}</span>, sortValue: (e) => e.category },
    { key: 'accountingClassification', header: 'Accounting', accessor: (e) => e.accountingClassification ? <span className="text-xs font-medium text-berry-700 bg-berry-50 px-2 py-0.5 rounded-full">{e.accountingClassification}</span> : <span className="text-gray-300">—</span>, sortValue: (e) => e.accountingClassification ?? '' },
    { key: 'expenseType', header: 'Type', accessor: (e) => e.expenseType ? <span className="text-xs font-medium text-gold-700 bg-gold-50 px-2 py-0.5 rounded-full">{e.expenseType}</span> : <span className="text-gray-300">—</span>, sortValue: (e) => e.expenseType ?? '' },
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
        // Single-line expense: when it carries a quantity, show it as
        // "item ×quantity" (matching the itemized rows). The item name is the
        // specific subcategory when present, otherwise the free-text description.
        const qty = Number(e.quantity) || 0;
        if (qty > 0) {
          const itemName = e.subcategory?.trim() || e.description?.trim() || e.category || 'Item';
          return (
            <span className="text-xs text-gray-700 whitespace-nowrap">
              {itemName}
              <span className="text-gray-400"> ×{formatNumber(qty, Number.isInteger(qty) ? 0 : 2)}{e.unit ? ` ${e.unit}` : ''}</span>
            </span>
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
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 ${
            e.paid
              ? 'bg-leaf-100 text-leaf-700 hover:bg-leaf-200'
              : 'bg-gold-100 text-gold-700 hover:bg-gold-200'
          }`}
          title={e.paid ? 'Mark as pending' : 'Mark as paid'}
          aria-label={`Payment status: ${e.paid ? 'Paid' : 'Pending'}. Click to mark as ${e.paid ? 'pending' : 'paid'}.`}
        >
          {e.paid ? 'Paid' : 'Pending'}
        </button>
      ),
      sortValue: (e) => (e.paid ? 1 : 0),
    },
    {
      key: 'notes',
      header: 'Notes',
      accessor: (e) => e.notes?.trim()
        ? <span className="text-gray-600">{e.notes}</span>
        : <span className="text-gray-300">—</span>,
      sortValue: (e) => e.notes ?? '',
      editable: { type: 'text', getValue: (e) => e.notes ?? '' },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle={`${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Add Expense</Button>}
      />

      {expenses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter value={period} onChange={setPeriod} years={years} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard title="Total Expenses" value={formatPHP(total)} icon={Receipt} iconColor="text-red-500" iconBg="bg-red-50" />
        <StatCard title="Expense Categories" value={Object.keys(categoryTotals).length} icon={Receipt} iconColor="text-primary-600" iconBg="bg-primary-50" />
      </div>

      {topCategories.length > 0 && (
        <CollapsibleSection title="Analytics" subtitle="Top expense categories" storageKey="expenses.analytics.collapsed">
        <SectionCard title="Top Expense Categories">
          <div className="space-y-2">
            {topCategories.map(([cat, amt], i) => {
              const pct = filteredTotal > 0 ? (amt / filteredTotal) * 100 : 0;
              // Each category-subcategory gets a distinct brand color so the bars
              // are visually distinguishable and on-palette.
              const color = PIE_COLORS[i % PIE_COLORS.length];
              return (
                <div key={cat}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="flex items-center gap-1.5 text-gray-700 font-medium">
                      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      {cat}
                    </span>
                    <span className="text-gray-500">{formatPHP(amt)} ({pct.toFixed(1)}%)</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
        </CollapsibleSection>
      )}

      {expenses.length === 0 ? (
        <EmptyState icon={Receipt} title="No expenses yet" description="Track your first expense to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Expense</Button>} />
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
          data={expenses}
          columns={columns}
          keyExtractor={(e) => e.id}
          searchFilter={(e, q) =>
            e.vendorName.toLowerCase().includes(q) ||
            e.category.toLowerCase().includes(q) ||
            (e.accountingClassification ?? '').toLowerCase().includes(q) ||
            (e.expenseType ?? '').toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.paymentMethod.toLowerCase().includes(q) ||
            (e.items ?? []).some((it) => (it.name ?? '').toLowerCase().includes(q))
          }
          searchPlaceholder="Search expenses…"
          actions={(e) => <RowActions onEdit={() => crud.openEdit(e)} onDelete={() => crud.requestDelete(e)} />}
          bulkActions={{
            noun: 'expense',
            actions: [
              { label: 'Mark Paid', icon: <CheckCircle2 className="w-4 h-4" />, onClick: (rows) => bulkSetPaid(rows, true) },
              { label: 'Mark Pending', icon: <CircleDashed className="w-4 h-4" />, onClick: (rows) => bulkSetPaid(rows, false) },
            ],
            onDelete: (rows) => rows.forEach((e) => deleteExpense(e.id)),
          }}
          // Notes edit inline; a notes-only patch leaves the purchase signature
          // unchanged, so updateExpense skips inventory reconciliation.
          onCellEdit={(e, key, value) => updateExpense(e.id, { [key]: value })}
          defaultSort={{ key: 'date', dir: 'asc' }}
          getRecency={(e) => e.createdAt}
        />
        </>
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Expense' : 'Add Expense'} size="2xl">
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
