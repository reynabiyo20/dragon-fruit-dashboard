import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format, parseISO, startOfMonth } from 'date-fns';
import {
  AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Plus, Receipt, Wallet, Clock, CheckCircle2, CircleDashed, X } from 'lucide-react';
import { useExpenseStore } from '../../store/expenseStore';
import { useVendorStore } from '../../store/vendorStore';
import { useExpenseDraftStore, useExpenseDraftHasContent } from '../../store/expenseDraftStore';
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
import { formatPHP, formatUSD, formatDate, formatNumber } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { locationLabel } from '../../constants/geography';
import { CHART_EXPENSE, PIE_COLORS } from '../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../constants/chartTheme';
import { ExpenseForm } from './ExpenseForm';

export function ExpensesPage() {
  const { expenses, deleteExpense, updateExpense, totalExpenses } = useExpenseStore();
  const vendors = useVendorStore((s) => s.vendors);
  const crud = useListCrud<Expense>();
  const navigate = useNavigate();

  // Map vendorId → its (live) location label, so the table's Vendor Location
  // column reflects the current vendor record rather than a stale snapshot.
  const vendorLocationById = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vendors) map.set(v.id, locationLabel(v.location));
    return map;
  }, [vendors]);
  const expenseLocation = (e: Expense): string =>
    e.vendorId ? vendorLocationById.get(e.vendorId) ?? '' : '';
  // Whether the in-progress "Add Expense" draft has real user-entered content.
  // Derived from the draft (not a sticky flag), so the banner shows only once
  // fields are filled and hides again when they're cleared.
  const hasDraft = useExpenseDraftHasContent();
  const clearDraft = useExpenseDraftStore((s) => s.clear);
  // Bumped when the user discards a draft, to force the Add-Expense form to
  // remount with cleared state (its values are seeded once at mount).
  const [formGen, setFormGen] = useState(0);
  const discardDraft = () => {
    clearDraft();
    setFormGen((g) => g + 1);
  };

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

  // A paid expense is locked from editing so its recorded amount/vendor can't
  // drift after money changed hands. To edit, the user must mark it Pending
  // first (the Status toggle in the table, or the bulk "Mark Pending" action).
  const requestEdit = (e: Expense) => {
    if (e.paid) {
      toast.error('This expense is marked Paid. Set it to Pending first to edit it.', { duration: 4000 });
      return;
    }
    crud.openEdit(e);
  };

  // ── Period filter (drives the analytics charts; KPI cards stay all-time) ─────
  const [period, setPeriod] = useState<Period>(ALL_PERIODS);
  // "Expenses by Category" drill: 'all' shows top-level categories; picking one
  // drills into its subcategories.
  const [expenseCategory, setExpenseCategory] = useState<string>('all');
  // Pending drill filter, toggled by clicking a Pending KPI and cleared via the
  // banner: 'off' shows all; 'php'/'usd' scope the table to unpaid expenses of
  // that currency.
  const [pendingFilter, setPendingFilter] = useState<'off' | 'php' | 'usd'>('off');
  const years = useMemo(() => availableYears(expenses.map((e) => e.date)), [expenses]);
  const filteredExpenses = useMemo(
    () => expenses.filter((e) => dateMatchesPeriod(e.date, period)),
    [expenses, period],
  );

  // Every expense flattened into per-(category, subcategory) cost lines. Multi-
  // item expenses contribute one line per item (by the item's category); single-
  // line expenses contribute one line from their flat category. This is what the
  // "Expenses by Category" chart aggregates, so multi-item spend is attributed
  // to the right category rather than only the expense's primary one.
  const categoryCostLines = useMemo(() => {
    const lines: { category: string; subcategory: string; amount: number }[] = [];
    for (const e of filteredExpenses) {
      const items = e.items ?? [];
      if (items.length > 0) {
        for (const it of items) {
          lines.push({
            category: it.category?.trim() || 'Uncategorized',
            subcategory: it.subcategory?.trim() || '(none)',
            amount: Number(it.total) || 0,
          });
        }
      } else {
        lines.push({
          category: e.category?.trim() || 'Uncategorized',
          subcategory: e.subcategory?.trim() || '(none)',
          amount: e.amount,
        });
      }
    }
    return lines;
  }, [filteredExpenses]);
  const total = useMemo(() => totalExpenses('PHP'), [expenses]);
  const totalUSD = useMemo(() => totalExpenses('USD'), [expenses]);
  const hasUsdExpenses = totalUSD > 0;
  // Paid vs still-owed split (all-time), for the KPI cards.
  const paidTotal = useMemo(
    () => expenses.filter((e) => (e.currency ?? 'PHP') === 'PHP').reduce((sum, e) => sum + (e.paid ? e.amount : 0), 0),
    [expenses],
  );
  const paidTotalUSD = useMemo(
    () => expenses.filter((e) => (e.currency ?? 'PHP') === 'USD').reduce((sum, e) => sum + (e.paid ? e.amount : 0), 0),
    [expenses],
  );
  const pendingTotal = total - paidTotal;
  const pendingTotalUSD = totalUSD - paidTotalUSD;
  // Unpaid counts per currency — drive the red Pending KPIs + the drill filters.
  const pendingCountPHP = useMemo(
    () => expenses.filter((e) => !e.paid && (e.currency ?? 'PHP') === 'PHP').length,
    [expenses],
  );
  const pendingCountUSD = useMemo(
    () => expenses.filter((e) => !e.paid && (e.currency ?? 'PHP') === 'USD').length,
    [expenses],
  );
  const hasPendingPHP = pendingCountPHP > 0;
  const hasPendingUSD = pendingCountUSD > 0;
  // The filter is only "active" while that currency still has pending items —
  // derived during render so it self-clears when the last one is settled.
  const activePendingFilter =
    pendingFilter === 'php' && hasPendingPHP ? 'php'
      : pendingFilter === 'usd' && hasPendingUSD ? 'usd'
        : 'off';
  const filteredPendingCount = activePendingFilter === 'usd' ? pendingCountUSD : pendingCountPHP;
  // Table rows: all expenses, or only the unpaid ones of the filtered currency.
  const tableData = useMemo(() => {
    if (activePendingFilter === 'off') return expenses;
    const cur = activePendingFilter === 'usd' ? 'USD' : 'PHP';
    return expenses.filter((e) => !e.paid && (e.currency ?? 'PHP') === cur);
  }, [expenses, activePendingFilter]);

  // ── Chart data (driven by the period filter, mirroring the Sales page) ───────
  /** Total expenses per calendar month, last 12 months, ascending by date. */
  const expenseTrend = useMemo(() => {
    const byMonth = new Map<string, { key: string; amount: number }>();
    for (const e of filteredExpenses) {
      if (!e.date) continue;
      let label: string;
      let key: string;
      try {
        const start = startOfMonth(parseISO(e.date));
        key = format(start, 'yyyy-MM');
        label = format(start, 'MMM yyyy');
      } catch {
        continue;
      }
      const existing = byMonth.get(label);
      if (existing) existing.amount += e.amount;
      else byMonth.set(label, { key, amount: e.amount });
    }
    return Array.from(byMonth.entries())
      .map(([label, v]) => ({ label, key: v.key, amount: Number(v.amount.toFixed(2)) }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12);
  }, [filteredExpenses]);

  /** Distinct top-level categories present (for the drill dropdown). */
  const expenseCategories = useMemo(
    () => Array.from(new Set(categoryCostLines.map((l) => l.category))).sort(),
    [categoryCostLines],
  );

  /**
   * "Expenses by Category" chart, responding to the drill filter:
   *  - 'all' → grouped BY top-level category (Fruit, Cuttings, Fertilizer …).
   *  - a category picked → grouped BY subcategory within that category.
   */
  const expensesByCategory = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const l of categoryCostLines) {
      if (expenseCategory !== 'all' && l.category !== expenseCategory) continue;
      const key = expenseCategory === 'all' ? l.category : l.subcategory;
      byKey.set(key, (byKey.get(key) ?? 0) + l.amount);
    }
    return Array.from(byKey.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [categoryCostLines, expenseCategory]);

  /** Spend grouped by accounting classification (CapEx / OpEx / COGS …). */
  const expensesByClassification = useMemo(() => {
    const byLabel = new Map<string, number>();
    for (const e of filteredExpenses) {
      const label = (e.accountingClassification ?? '').trim() || 'Unclassified';
      byLabel.set(label, (byLabel.get(label) ?? 0) + e.amount);
    }
    return Array.from(byLabel.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filteredExpenses]);

  /** Spend grouped by expense type / cost behavior (Fixed / Variable …). */
  const expensesByType = useMemo(() => {
    const byLabel = new Map<string, number>();
    for (const e of filteredExpenses) {
      const label = (e.expenseType ?? '').trim() || 'Unclassified';
      byLabel.set(label, (byLabel.get(label) ?? 0) + e.amount);
    }
    return Array.from(byLabel.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filteredExpenses]);

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
    {
      key: 'vendorLocation',
      header: 'Vendor Location',
      accessor: (e) => {
        const loc = expenseLocation(e);
        return loc ? <span className="text-gray-700">{loc}</span> : <span className="text-gray-300">—</span>;
      },
      sortValue: (e) => expenseLocation(e),
    },
    { key: 'category', header: 'Category', accessor: (e) => <span className="text-xs font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">{e.category}</span>, sortValue: (e) => e.category },
    { key: 'accountingClassification', header: 'Accounting', accessor: (e) => e.accountingClassification ? <span className="text-xs font-medium text-berry-700 bg-berry-50 px-2 py-0.5 rounded-full">{e.accountingClassification}</span> : <span className="text-gray-300">—</span>, sortValue: (e) => e.accountingClassification ?? '' },
    { key: 'expenseType', header: 'Type', accessor: (e) => e.expenseType ? <span className="text-xs font-medium text-gold-700 bg-gold-50 px-2 py-0.5 rounded-full">{e.expenseType}</span> : <span className="text-gray-300">—</span>, sortValue: (e) => e.expenseType ?? '' },
    {
      key: 'description',
      header: 'Description',
      // Itemized expenses (with an `items` list) expand on click to show every
      // line — see the Table's `expandable` config below.
      expandTrigger: true,
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
              {remaining > 0 ? (
                <span className="text-xs text-primary-600">+{remaining} more · click to expand</span>
              ) : (
                <span className="text-xs text-gray-400">{items.length} item{items.length !== 1 ? 's' : ''} · click to expand</span>
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
    {
      key: 'amount',
      header: 'Amount',
      accessor: (e) => (
        <span className="font-semibold text-gray-900">
          {(e.currency ?? 'PHP') === 'USD' ? formatUSD(e.amount) : formatPHP(e.amount)}
        </span>
      ),
      sortValue: (e) => e.amount,
    },
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

      {/* KPI cards. Peso is always shown as its own Total / Paid / Outstanding
          trio; the matching USD trio appears only when there are USD expenses.
          Total = Paid + Outstanding within each currency (never mixed). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* ── Peso (₱) ─────────────────────────────────────────────────────── */}
        <StatCard title="Total Expenses (₱)" value={formatPHP(total)} icon={Receipt} iconColor="text-red-500" iconBg="bg-red-50" />
        <StatCard title="Paid (₱)" value={formatPHP(paidTotal)} icon={Wallet} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
        {/* Outstanding in pesos — red + clickable to filter to pending PHP rows. */}
        <StatCard
          title="Outstanding (₱)"
          value={formatPHP(pendingTotal)}
          subtitle={hasPendingPHP ? `${pendingCountPHP} unpaid · click to filter` : 'All settled'}
          icon={Clock}
          iconColor={hasPendingPHP ? 'text-red-500' : 'text-gold-500'}
          iconBg={hasPendingPHP ? 'bg-red-50' : 'bg-gold-50'}
          titleColor={hasPendingPHP ? 'text-red-600' : undefined}
          valueColor={hasPendingPHP ? 'text-red-600' : undefined}
          onClick={hasPendingPHP ? () => setPendingFilter((f) => (f === 'php' ? 'off' : 'php')) : undefined}
        />

        {/* ── Dollar ($) — only when there are USD expenses ─────────────────── */}
        {hasUsdExpenses && (
          <>
            <StatCard title="Total Expenses ($)" value={formatUSD(totalUSD)} icon={Receipt} iconColor="text-red-500" iconBg="bg-red-50" />
            <StatCard title="Paid ($)" value={formatUSD(paidTotalUSD)} icon={Wallet} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
            {/* Outstanding in dollars — red + clickable to filter to pending USD rows. */}
            <StatCard
              title="Outstanding ($)"
              value={formatUSD(pendingTotalUSD)}
              subtitle={hasPendingUSD ? `${pendingCountUSD} unpaid · click to filter` : 'All settled'}
              icon={Clock}
              iconColor={hasPendingUSD ? 'text-red-500' : 'text-gold-500'}
              iconBg={hasPendingUSD ? 'bg-red-50' : 'bg-gold-50'}
              titleColor={hasPendingUSD ? 'text-red-600' : undefined}
              valueColor={hasPendingUSD ? 'text-red-600' : undefined}
              onClick={hasPendingUSD ? () => setPendingFilter((f) => (f === 'usd' ? 'off' : 'usd')) : undefined}
            />
          </>
        )}
      </div>

      {/* Active drilldown banner from an Outstanding card */}
      {activePendingFilter !== 'off' && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          <span>
            Showing <span className="font-semibold">{filteredPendingCount}</span>{' '}
            outstanding {activePendingFilter === 'usd' ? 'USD ($)' : 'peso (₱)'}{' '}
            expense{filteredPendingCount !== 1 ? 's' : ''}.
          </span>
          <button
            type="button"
            onClick={() => setPendingFilter('off')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <X className="w-3.5 h-3.5" /> Clear filter
          </button>
        </div>
      )}

      {expenses.length > 0 && (
        <CollapsibleSection title="Analytics" subtitle="Charts & trends" storageKey="expenses.analytics.collapsed">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Expense trend over time */}
          <SectionCard title="Expense Trend" subtitle="Total expenses per month">
            {expenseTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={expenseTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="expenseTrendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_EXPENSE} stopOpacity={0.32} />
                      <stop offset="95%" stopColor={CHART_EXPENSE} stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `₱${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip
                    formatter={(v) => formatPHP(Number(v))}
                    cursor={{ stroke: '#f0b4b4', strokeWidth: 1 }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Area type="monotone" dataKey="amount" name="Expenses" stroke={CHART_EXPENSE} strokeWidth={2} fill="url(#expenseTrendGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No expenses in this view yet.</div>
            )}
          </SectionCard>

          {/* Expenses by category — top-level by default, drill into subcategories */}
          <SectionCard
            title="Expenses by Category"
            subtitle={
              expenseCategory === 'all'
                ? 'Share of spend per category'
                : `Subcategory breakdown · ${expenseCategory}`
            }
            actions={
              <select
                value={expenseCategory}
                onChange={(e) => setExpenseCategory(e.target.value)}
                aria-label="Filter expenses by category"
                className="text-xs border border-primary-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="all">All categories</option>
                {expenseCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            }
          >
            {expensesByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={expensesByCategory}
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
                    {expensesByCategory.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => formatPHP(Number(v))}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400 text-center px-4">
                {expenseCategory === 'all' ? 'No category spend yet.' : `No spend recorded under ${expenseCategory} yet.`}
              </div>
            )}
          </SectionCard>

          {/* Expenses by accounting classification */}
          <SectionCard title="By Accounting Classification" subtitle="CapEx vs OpEx vs COGS (share of spend)">
            {expensesByClassification.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={expensesByClassification}
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
                    {expensesByClassification.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => formatPHP(Number(v))}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No classified expenses yet.</div>
            )}
          </SectionCard>

          {/* Expenses by cost behavior (fixed vs variable) */}
          <SectionCard title="By Cost Behavior" subtitle="Fixed vs variable spend (expense type)">
            {expensesByType.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={expensesByType} layout="vertical" margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} tickFormatter={(v) => `₱${Math.round(Number(v) / 1000)}k`} />
                  <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={110} />
                  <Tooltip
                    formatter={(v) => formatPHP(Number(v))}
                    cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Bar dataKey="value" name="Spend" radius={[0, 4, 4, 0]}>
                    {expensesByType.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No expenses with a cost behavior yet.</div>
            )}
          </SectionCard>
        </div>
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
          data={tableData}
          columns={columns}
          keyExtractor={(e) => e.id}
          searchFilter={(e, q) =>
            e.vendorName.toLowerCase().includes(q) ||
            expenseLocation(e).toLowerCase().includes(q) ||
            e.category.toLowerCase().includes(q) ||
            (e.accountingClassification ?? '').toLowerCase().includes(q) ||
            (e.expenseType ?? '').toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.paymentMethod.toLowerCase().includes(q) ||
            (e.items ?? []).some((it) => (it.name ?? '').toLowerCase().includes(q))
          }
          searchPlaceholder="Search expenses…"
          // A Paid expense is locked: no inline edit or delete until it's set
          // back to Pending. Its recorded amount/vendor/items — and the
          // inventory, dashboards and KPIs they drive — must not drift after
          // money changed hands.
          actions={(e) =>
            e.paid ? (
              <RowActions
                onEdit={() => {}}
                onDelete={() => {}}
                locked
                lockedReason="This expense is marked Paid. Set it to Pending first to edit or delete it."
              />
            ) : (
              <RowActions onEdit={() => requestEdit(e)} onDelete={() => crud.requestDelete(e)} />
            )
          }
          bulkActions={{
            noun: 'expense',
            actions: [
              { label: 'Mark Paid', icon: <CheckCircle2 className="w-4 h-4" />, onClick: (rows) => bulkSetPaid(rows, true) },
              { label: 'Mark Pending', icon: <CircleDashed className="w-4 h-4" />, onClick: (rows) => bulkSetPaid(rows, false) },
            ],
            // Deleting reverses each expense's effect on inventory/dashboards/
            // KPIs, so paid rows are skipped — they must be set to Pending
            // first. Warn when the selection includes any locked rows.
            onDelete: (rows) => {
              const deletable = rows.filter((e) => !e.paid);
              const lockedCount = rows.length - deletable.length;
              deletable.forEach((e) => deleteExpense(e.id));
              if (lockedCount > 0) {
                toast.error(
                  `${lockedCount} paid expense${lockedCount !== 1 ? 's were' : ' was'} skipped. Set ${lockedCount !== 1 ? 'them' : 'it'} to Pending first to delete.`,
                  { duration: 4000 },
                );
              }
            },
          }}
          // Notes edit inline; a notes-only patch leaves the purchase signature
          // unchanged, so updateExpense skips inventory reconciliation. Paid
          // rows are locked from editing (including Notes) — the store rejects
          // it too, but we short-circuit here for the toast UX.
          onCellEdit={(e, key, value) => {
            if (e.paid) {
              toast.error('This expense is marked Paid. Set it to Pending first to edit it.', { duration: 4000 });
              return;
            }
            updateExpense(e.id, { [key]: value });
          }}
          // Itemized expenses expand (via the Description cell) to list every
          // line bought — name, quantity, unit price, and line total.
          expandable={{
            isExpandable: (e) => (e.items?.length ?? 0) > 0,
            render: (e) => {
              const money = (n: number) => ((e.currency ?? 'PHP') === 'USD' ? formatUSD(n) : formatPHP(n));
              const items = e.items ?? [];
              const itemsTotal = items.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
              return (
                <div className="rounded-lg border border-primary-100 bg-white overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-primary-50/60 text-primary-800">
                        <th className="px-3 py-2 text-left font-semibold">Item</th>
                        <th className="px-3 py-2 text-left font-semibold">Category</th>
                        <th className="px-3 py-2 text-right font-semibold">Qty</th>
                        <th className="px-3 py-2 text-right font-semibold">Unit Price</th>
                        <th className="px-3 py-2 text-right font-semibold">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map((it, idx) => {
                        const qty = Number(it.quantity) || 0;
                        return (
                          <tr key={idx} className="text-gray-700">
                            <td className="px-3 py-2">{it.name || it.subcategory || 'Item'}</td>
                            <td className="px-3 py-2 text-gray-500">
                              {it.category}{it.subcategory ? ` – ${it.subcategory}` : ''}
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              {formatNumber(qty, Number.isInteger(qty) ? 0 : 2)}{it.unit ? ` ${it.unit}` : ''}
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">{money(Number(it.unitPrice) || 0)}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap font-medium text-gray-900">{money(Number(it.total) || 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t border-gray-200 font-semibold text-gray-900">
                        <td className="px-3 py-2" colSpan={4}>Total ({items.length} item{items.length !== 1 ? 's' : ''})</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{money(itemsTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            },
          }}
          persistKey="expenses"
          defaultSort={{ key: 'date', dir: 'asc' }}
          getRecency={(e) => e.createdAt}
        />
        </>
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Expense' : 'Add Expense'} size="2xl">
        {/* Restored-draft notice — only when adding (not editing) a draft exists.
            Lets the user start fresh instead of continuing where they left off. */}
        {!crud.editing && hasDraft && (
          <div className="mb-4 flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-primary-200 bg-primary-50 text-sm text-primary-800">
            <span>Continuing your unsaved draft. Your progress is kept until you save it.</span>
            <button
              type="button"
              onClick={discardDraft}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-primary-700 hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              <X className="w-3.5 h-3.5" /> Discard draft
            </button>
          </div>
        )}
        <ExpenseForm
          key={crud.editing?.id ?? `new-${formGen}`}
          expense={crud.editing}
          onClose={crud.closeModal}
        />
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
