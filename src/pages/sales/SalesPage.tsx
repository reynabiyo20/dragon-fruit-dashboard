import { useMemo, useState } from 'react';
import { Plus, ShoppingCart, TrendingUp, Clock, CheckCircle2, CircleDashed } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, startOfMonth, differenceInDays } from 'date-fns';
import {
  AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar, LabelList, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useSaleStore } from '../../store/saleStore';
import { useCommissionStore } from '../../store/commissionStore';
import { useProductStore } from '../../store/productStore';
import type { Sale } from '../../types';
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
import { formatPHP, formatDate } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { BRAND, PIE_COLORS } from '../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../constants/chartTheme';
import { SaleForm } from './SaleForm';

export function SalesPage() {
  const { sales, deleteSale, updateSale, totalRevenue, totalPaid, totalUnpaid } = useSaleStore();
  const { removeForSale } = useCommissionStore();
  const { getProduct } = useProductStore();
  const crud = useListCrud<Sale>();
  const navigate = useNavigate();

  // ── Period filter (drives the charts below; KPI cards stay all-time) ─────────
  const [period, setPeriod] = useState<Period>(ALL_PERIODS);
  const years = useMemo(() => availableYears(sales.map((s) => s.date)), [sales]);
  const filteredSales = useMemo(
    () => sales.filter((s) => dateMatchesPeriod(s.date, period)),
    [sales, period],
  );

  // ── Deliveries breakdown drill filter: category → variety ────────────────────
  const [deliveryCategory, setDeliveryCategory] = useState<string>('all');
  const [deliveryVariety, setDeliveryVariety] = useState<string>('all');
  // Changing the category resets the variety (varieties are scoped to a category).
  const changeDeliveryCategory = (cat: string) => {
    setDeliveryCategory(cat);
    setDeliveryVariety('all');
  };

  // ── Bulk status edit + undo ─────────────────────────────────────────────────
  // After a bulk paid/received change we snapshot each affected sale's previous
  // patch so the whole action can be reverted in one click. The Undo bar shows
  // only while a snapshot exists.
  const [undoSnapshot, setUndoSnapshot] = useState<{ message: string; prev: { id: string; patch: Partial<Sale> }[] } | null>(null);

  const bulkSetPaid = (rows: Sale[], paid: boolean) => {
    if (rows.length === 0) return;
    const prev = rows.map((s) => ({ id: s.id, patch: { paid: s.paid } }));
    rows.forEach((s) => updateSale(s.id, { paid }));
    setUndoSnapshot({
      message: `Marked ${rows.length} sale${rows.length !== 1 ? 's' : ''} as ${paid ? 'paid' : 'unpaid'}.`,
      prev,
    });
  };

  const bulkSetReceived = (rows: Sale[], delivered: boolean) => {
    if (rows.length === 0) return;
    const prev = rows.map((s) => ({ id: s.id, patch: { delivered: s.delivered ?? false } }));
    rows.forEach((s) => updateSale(s.id, { delivered }));
    setUndoSnapshot({
      message: `Marked ${rows.length} sale${rows.length !== 1 ? 's' : ''} as ${delivered ? 'received' : 'pending'}.`,
      prev,
    });
  };

  const undoBulk = () => {
    if (!undoSnapshot) return;
    undoSnapshot.prev.forEach(({ id, patch }) => updateSale(id, patch));
    setUndoSnapshot(null);
  };

  // ── Chart data (driven by the period filter) ────────────────────────────────
  /** Revenue summed per calendar month, last 12 months, ascending by date. */
  const revenueTrend = useMemo(() => {
    const byMonth = new Map<string, { key: string; amount: number }>();
    for (const s of filteredSales) {
      if (!s.date) continue;
      let monthKey: string;
      let label: string;
      try {
        const start = startOfMonth(parseISO(s.date));
        monthKey = format(start, 'yyyy-MM');
        label = format(start, 'MMM yyyy');
      } catch {
        continue;
      }
      const existing = byMonth.get(label);
      if (existing) existing.amount += s.subtotal;
      else byMonth.set(label, { key: monthKey, amount: s.subtotal });
    }
    return Array.from(byMonth.entries())
      .map(([label, v]) => ({ label, key: v.key, amount: Number(v.amount.toFixed(2)) }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12);
  }, [filteredSales]);

  /** Revenue grouped by sale channel (saleType), descending. */
  const revenueByChannel = useMemo(() => {
    const byType = new Map<string, number>();
    for (const s of filteredSales) {
      const name = s.saleType?.trim() || 'Uncategorized';
      byType.set(name, (byType.get(name) ?? 0) + s.subtotal);
    }
    return Array.from(byType.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filteredSales]);

  /** Revenue grouped by product category (resolved per line item), descending. */
  const salesByCategory = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const s of filteredSales) {
      for (const item of s.items) {
        const category = (item.productId ? getProduct(item.productId)?.category : undefined)
          ?.trim() || 'Uncategorized';
        byCategory.set(category, (byCategory.get(category) ?? 0) + (item.total ?? 0));
      }
    }
    return Array.from(byCategory.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filteredSales, getProduct]);

  /**
   * Every inventory-tracked line item flattened with its resolved category +
   * variety, the quantity, and whether the sale was delivered. Includes BOTH
   * delivered and pending lines so the chart can stack them into a full total.
   */
  const deliveryLines = useMemo(() => {
    const lines: { category: string; variety: string; quantity: number; delivered: boolean }[] = [];
    for (const s of filteredSales) {
      for (const item of s.items) {
        const product = item.productId ? getProduct(item.productId) : undefined;
        if (!product?.category) continue;
        lines.push({
          category: product.category,
          variety: product.subcategory?.trim() || '(unspecified)',
          quantity: Number(item.quantity) || 0,
          delivered: s.delivered === true,
        });
      }
    }
    return lines;
  }, [filteredSales, getProduct]);

  /** Distinct categories present (for the category drill dropdown). */
  const deliveryCategories = useMemo(
    () => Array.from(new Set(deliveryLines.map((l) => l.category))).sort(),
    [deliveryLines],
  );

  /** Distinct varieties within the selected category (for the variety dropdown). */
  const deliveryVarieties = useMemo(() => {
    if (deliveryCategory === 'all') return [];
    return Array.from(
      new Set(deliveryLines.filter((l) => l.category === deliveryCategory).map((l) => l.variety)),
    ).sort();
  }, [deliveryLines, deliveryCategory]);

  /**
   * The deliveries chart data, responding to the drill filter. Each row carries
   * BOTH delivered + pending units so the bar can stack into the full total:
   *  - No category → grouped BY CATEGORY (Cuttings, Fruit, …).
   *  - Category picked → grouped BY VARIETY within that category.
   *  - Category + variety picked → just that variety.
   */
  const deliveryChart = useMemo(() => {
    const map = new Map<string, { delivered: number; pending: number }>();
    for (const l of deliveryLines) {
      if (deliveryCategory !== 'all' && l.category !== deliveryCategory) continue;
      if (deliveryVariety !== 'all' && l.variety !== deliveryVariety) continue;
      const key = deliveryCategory === 'all' ? l.category : l.variety;
      const row = map.get(key) ?? { delivered: 0, pending: 0 };
      if (l.delivered) row.delivered += l.quantity;
      else row.pending += l.quantity;
      map.set(key, row);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({
        name,
        delivered: v.delivered,
        pending: v.pending,
        total: v.delivered + v.pending,
        deliveredPct: v.delivered + v.pending > 0 ? (v.delivered / (v.delivered + v.pending)) * 100 : 0,
      }))
      .filter((d) => d.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [deliveryLines, deliveryCategory, deliveryVariety]);

  /** Delivered vs pending fulfillment summary + avg lead time, across all
   *  deliverable (inventory-tracked) sales — shown as a caption under the chart. */
  const deliverySummary = useMemo(() => {
    const deliverable = filteredSales.filter((s) => s.items.some((i) => !!(i.productId && getProduct(i.productId)?.category)));
    const delivered = deliverable.filter((s) => s.delivered);
    let leadDaysTotal = 0;
    let leadCount = 0;
    for (const s of delivered) {
      if (!s.deliveredDate || !s.date) continue;
      try {
        const days = differenceInDays(parseISO(s.deliveredDate), parseISO(s.date));
        if (days >= 0) { leadDaysTotal += days; leadCount += 1; }
      } catch { /* skip unparseable */ }
    }
    return {
      deliverableCount: deliverable.length,
      deliveredCount: delivered.length,
      pendingCount: deliverable.length - delivered.length,
      avgLeadDays: leadCount > 0 ? leadDaysTotal / leadCount : null,
    };
  }, [filteredSales, getProduct]);

  /**
   * Whether a sale contains any inventory-tracked line. Everything sold is
   * tracked in inventory, so any line with a resolvable product qualifies —
   * "Received by Customer" moves inventory `sold` (auto-creating the row if
   * needed). Resolves the line's product so it's not tied to the product name.
   */
  const hasStockItems = (s: Sale): boolean =>
    s.items.some((i) => {
      const product = i.productId ? getProduct(i.productId) : undefined;
      return !!product && !!product.category;
    });

  const columns: Column<Sale>[] = [
    { key: 'date', header: 'Date', accessor: (s) => formatDate(s.date), sortValue: (s) => s.date },
    { key: 'invoiceNumber', header: 'Invoice #', accessor: (s) => s.invoiceNumber || '—', sortValue: (s) => s.invoiceNumber ?? '' },
    { key: 'customerName', header: 'Customer', accessor: (s) => <span className="font-medium">{s.customerName}</span>, sortValue: (s) => s.customerName },
    {
      key: 'soldByName',
      header: 'Sold By',
      accessor: (s) => {
        if (!s.soldByName) return '—';
        // When we know which employee made the sale, link to their row in the
        // Employees table; otherwise show the plain (unlinked) name.
        if (!s.soldByEmployeeId) return <span className="text-gray-700">{s.soldByName}</span>;
        return (
          <button
            type="button"
            onClick={() => navigate(`/employees?focus=${encodeURIComponent(s.soldByEmployeeId)}`)}
            className="text-primary-700 hover:text-primary-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
            title={`View ${s.soldByName} in Employees`}
          >
            {s.soldByName}
          </button>
        );
      },
      sortValue: (s) => s.soldByName ?? '',
    },
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
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 ${
            s.paid
              ? 'bg-leaf-100 text-leaf-700 hover:bg-leaf-200'
              : 'bg-gold-100 text-gold-700 hover:bg-gold-200'
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
      header: 'Received',
      accessor: (s) => {
        // Sales with a resolvable product track receipt (all sold products are
        // inventory-tracked); lines with no product show a neutral dash.
        if (!hasStockItems(s) && !s.delivered) return <span className="text-gray-300">—</span>;
        return (
          <button
            type="button"
            onClick={() => updateSale(s.id, { delivered: !s.delivered })}
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 ${
              s.delivered
                ? 'bg-berry-100 text-berry-700 hover:bg-berry-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title={s.delivered ? 'Mark as not received' : 'Mark as received by customer'}
            aria-label={`Receipt status: ${s.delivered ? 'Received' : 'Pending'}. Click to toggle.`}
          >
            {s.delivered ? 'Received' : 'Pending'}
          </button>
        );
      },
      sortValue: (s) => (s.delivered ? 1 : 0),
    },
    {
      key: 'notes',
      header: 'Notes',
      accessor: (s) => s.notes?.trim()
        ? <span className="text-gray-600">{s.notes}</span>
        : <span className="text-gray-300">—</span>,
      sortValue: (s) => s.notes ?? '',
      editable: { type: 'text', getValue: (s) => s.notes ?? '' },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        subtitle={`${sales.length} transaction${sales.length !== 1 ? 's' : ''}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>New Sale</Button>}
      />

      {sales.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter value={period} onChange={setPeriod} years={years} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Revenue" value={formatPHP(totalRevenue())} icon={TrendingUp} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
        <StatCard title="Collected" value={formatPHP(totalPaid())} icon={ShoppingCart} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
        <StatCard title="Outstanding" value={formatPHP(totalUnpaid())} icon={Clock} iconColor="text-gold-500" iconBg="bg-gold-50" />
      </div>

      {/* Analytics charts */}
      {sales.length > 0 && (
        <CollapsibleSection title="Analytics" subtitle="Charts & trends" storageKey="sales.analytics.collapsed">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Revenue trend over time */}
          <SectionCard title="Revenue Trend" subtitle="Total sales revenue per month">
            {revenueTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={revenueTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={BRAND.leaf} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={BRAND.leaf} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `₱${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip
                    formatter={(v) => formatPHP(Number(v))}
                    cursor={{ stroke: '#dcbcd6', strokeWidth: 1 }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Area type="monotone" dataKey="amount" name="Revenue" stroke={BRAND.leaf} strokeWidth={2} fill="url(#salesRevenueGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No revenue yet.</div>
            )}
          </SectionCard>

          {/* Revenue by channel */}
          <SectionCard title="Revenue by Channel" subtitle="Share of revenue per sale type">
            {revenueByChannel.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={revenueByChannel}
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
                    {revenueByChannel.map((_, i) => (
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
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No revenue yet.</div>
            )}
          </SectionCard>

          {/* Sales by product category */}
          <SectionCard title="Sales by Category" subtitle="Revenue share per product category">
            {salesByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={salesByCategory}
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
                    {salesByCategory.map((_, i) => (
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
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No category sales yet.</div>
            )}
          </SectionCard>

          {/* Deliveries by category → variety, with a drill-down filter */}
          <SectionCard
            title="Deliveries by Category"
            subtitle={
              deliveryCategory === 'all'
                ? 'Delivered vs pending units per category'
                : deliveryVariety === 'all'
                  ? `Delivered vs pending per ${deliveryCategory} variety`
                  : `Delivered vs pending · ${deliveryCategory} — ${deliveryVariety}`
            }
            actions={
              <div className="flex items-center gap-2">
                <select
                  value={deliveryCategory}
                  onChange={(e) => changeDeliveryCategory(e.target.value)}
                  aria-label="Filter deliveries by category"
                  className="text-xs border border-primary-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="all">All categories</option>
                  {deliveryCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={deliveryVariety}
                  onChange={(e) => setDeliveryVariety(e.target.value)}
                  aria-label="Filter deliveries by variety"
                  disabled={deliveryCategory === 'all' || deliveryVarieties.length === 0}
                  className="text-xs border border-primary-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <option value="all">All varieties</option>
                  {deliveryVarieties.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            }
          >
            {deliveryChart.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={deliveryChart} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={40} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={120} />
                    <Tooltip
                      formatter={(v, name) => [`${Number(v).toLocaleString('en-US')} unit${Number(v) === 1 ? '' : 's'}`, name]}
                      cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                    />
                    <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                    <Bar dataKey="delivered" name="Delivered" stackId="units" fill={BRAND.leaf} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="pending" name="Pending" stackId="units" fill={BRAND.gold} radius={[0, 3, 3, 0]}>
                      <LabelList
                        dataKey="deliveredPct"
                        position="right"
                        formatter={(val) => `${Math.round(Number(val))}% del.`}
                        style={{ fontSize: 10, fill: '#6b6570' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-center text-xs text-gray-500">
                  {deliverySummary.deliveredCount} of {deliverySummary.deliverableCount} orders delivered · {deliverySummary.pendingCount} pending
                  {deliverySummary.avgLeadDays !== null
                    ? ` · avg lead time ${deliverySummary.avgLeadDays.toFixed(1)} day${deliverySummary.avgLeadDays === 1 ? '' : 's'}`
                    : ''}
                </p>
              </>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No sales in this view yet.</div>
            )}
          </SectionCard>
        </div>
        </CollapsibleSection>
      )}

      {sales.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No sales yet" description="Record your first sale to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>New Sale</Button>} />
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
            actions: [
              { label: 'Mark Paid', icon: <CheckCircle2 className="w-4 h-4" />, onClick: (rows) => bulkSetPaid(rows, true) },
              { label: 'Mark Unpaid', icon: <CircleDashed className="w-4 h-4" />, onClick: (rows) => bulkSetPaid(rows, false) },
              { label: 'Mark Received', icon: <CheckCircle2 className="w-4 h-4" />, onClick: (rows) => bulkSetReceived(rows, true) },
              { label: 'Mark Pending', icon: <CircleDashed className="w-4 h-4" />, onClick: (rows) => bulkSetReceived(rows, false) },
            ],
            onDelete: (rows) => rows.forEach((s) => { removeForSale(s.id); deleteSale(s.id); }),
          }}
          // Notes edit inline; a notes-only patch never recomputes items, so no cascade.
          onCellEdit={(s, key, value) => updateSale(s.id, { [key]: value })}
          defaultSort={{ key: 'date', dir: 'asc' }}
          getRecency={(s) => s.createdAt}
        />
        </>
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
