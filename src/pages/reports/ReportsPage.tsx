import { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from 'recharts';
import {
  format, parseISO, startOfMonth, differenceInDays,
} from 'date-fns';
import {
  TrendingUp, TrendingDown, DollarSign,
  BarChart2, ShoppingCart,
} from 'lucide-react';

import { PageHeader } from '../../components/ui/PageHeader';
import { SectionCard } from '../../components/ui/SectionCard';
import { StatCard } from '../../components/ui/StatCard';
import { Badge } from '../../components/ui/Badge';
import { formatPHP, formatDate, categoryLabel } from '../../utils/format';

import { useSaleStore } from '../../store/saleStore';
import { useExpenseStore } from '../../store/expenseStore';
import { usePayrollStore } from '../../store/payrollStore';
import { useProductStore } from '../../store/productStore';
import { PIE_COLORS, CHART_REVENUE, CHART_EXPENSE, CHART_PAYROLL, CHART_PROFIT } from '../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../constants/chartTheme';

// ─── Tab type ────────────────────────────────────────────────────────────────
type Tab = 'pnl' | 'sales' | 'financial';

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('pnl');

  const { sales } = useSaleStore();
  const { expenses } = useExpenseStore();
  const { entries: payrollEntries } = usePayrollStore();
  const { products } = useProductStore();

  // ── Monthly P&L ─────────────────────────────────────────────────────────────
  const monthlyPnL = useMemo(() => {
    const map = new Map<string, { revenue: number; expenses: number; payroll: number }>();

    const getOrCreate = (month: string) => {
      if (!map.has(month)) map.set(month, { revenue: 0, expenses: 0, payroll: 0 });
      return map.get(month)!;
    };

    sales.forEach((s) => {
      if (!s.date) return;
      try {
        const m = format(startOfMonth(parseISO(s.date)), 'MMM yyyy');
        getOrCreate(m).revenue += s.subtotal;
      } catch { /* skip */ }
    });

    expenses.forEach((e) => {
      if (!e.date) return;
      try {
        const m = format(startOfMonth(parseISO(e.date)), 'MMM yyyy');
        getOrCreate(m).expenses += e.amount;
      } catch { /* skip */ }
    });

    payrollEntries.forEach((p) => {
      if (!p.payPeriodStart) return;
      try {
        const m = format(startOfMonth(parseISO(p.payPeriodStart)), 'MMM yyyy');
        getOrCreate(m).payroll += p.netPay;
      } catch { /* skip */ }
    });

    return Array.from(map.entries())
      .map(([month, d]) => ({
        month,
        revenue: d.revenue,
        expenses: d.expenses,
        payroll: d.payroll,
        profit: d.revenue - d.expenses - d.payroll,
      }))
      .sort((a, b) => {
        try {
          return parseISO(`01 ${a.month}`).getTime() - parseISO(`01 ${b.month}`).getTime();
        } catch { return 0; }
      });
  }, [sales, expenses, payrollEntries]);

  const totalRevenue = useMemo(() => sales.reduce((s, r) => s + r.subtotal, 0), [sales]);
  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);
  const totalPayroll = useMemo(() => payrollEntries.reduce((s, p) => s + p.netPay, 0), [payrollEntries]);
  const netProfit = totalRevenue - totalExpenses - totalPayroll;
  const profitMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  // ── Sales by product ────────────────────────────────────────────────────────
  const salesByProduct = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number }>();
    sales.forEach((s) => {
      s.items.forEach((item) => {
        const key = item.productName || 'Unknown';
        const curr = map.get(key) ?? { qty: 0, revenue: 0 };
        map.set(key, { qty: curr.qty + item.quantity, revenue: curr.revenue + item.total });
      });
    });
    return Array.from(map.entries())
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [sales]);

  // ── Sales by customer (top individual customers by revenue) ───────────────────
  const salesByCustomer = useMemo(() => {
    const map = new Map<string, number>();
    sales.forEach((s) => {
      const key = s.customerName || 'Unknown';
      map.set(key, (map.get(key) ?? 0) + s.subtotal);
    });
    return Array.from(map.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [sales]);

  // ── Sales by sale type (revenue grouped by how the sale was made) ─────────────
  const salesBySaleType = useMemo(() => {
    const map = new Map<string, number>();
    sales.forEach((s) => {
      const key = s.saleType?.trim() || 'Uncategorized';
      map.set(key, (map.get(key) ?? 0) + s.subtotal);
    });
    return Array.from(map.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [sales]);

  // ── Outstanding invoice aging ───────────────────────────────────────────────
  const today = new Date();
  const unpaidSales = useMemo(
    () =>
      sales
        .filter((s) => !s.paid)
        .map((s) => ({
          ...s,
          daysOverdue: s.date ? differenceInDays(today, parseISO(s.date)) : 0,
        }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue),
    [sales]
  );

  const agingBuckets = useMemo(() => {
    const b = { current: 0, days30: 0, days60: 0, over60: 0 };
    unpaidSales.forEach(({ daysOverdue, subtotal }) => {
      if (daysOverdue <= 0) b.current += subtotal;
      else if (daysOverdue <= 30) b.days30 += subtotal;
      else if (daysOverdue <= 60) b.days60 += subtotal;
      else b.over60 += subtotal;
    });
    return b;
  }, [unpaidSales]);

  // ── Product margins (COGS) ─────────────────────────────────────────────────
  const productMargins = useMemo(() =>
    products
      .filter((p) => p.sellingPricePHP > 0)
      .map((p) => {
        const marginPHP = p.sellingPricePHP - p.costPHP;
        const marginPct = p.sellingPricePHP > 0 ? (marginPHP / p.sellingPricePHP) * 100 : 0;
        return {
          id: p.id,
          name: categoryLabel(p.category, p.subcategory),
          costPHP: p.costPHP,
          sellingPricePHP: p.sellingPricePHP,
          marginPHP,
          marginPct,
        };
      })
      .sort((a, b) => b.marginPct - a.marginPct),
    [products]
  );

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'pnl',       label: 'Monthly P&L',     icon: BarChart2 },
    { id: 'sales',     label: 'Sales Analytics', icon: ShoppingCart },
    { id: 'financial', label: 'Financial Metrics', icon: DollarSign },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports & Analytics" subtitle="Financial summaries, sales insights, and profitability metrics" />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Revenue" value={formatPHP(totalRevenue)} icon={TrendingUp} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
        <StatCard title="Total Expenses" value={formatPHP(totalExpenses + totalPayroll)} icon={TrendingDown} iconColor="text-red-500" iconBg="bg-red-50" />
        <StatCard
          title="Net Profit"
          value={formatPHP(netProfit)}
          icon={DollarSign}
          iconColor={netProfit >= 0 ? 'text-leaf-600' : 'text-red-500'}
          iconBg={netProfit >= 0 ? 'bg-leaf-50' : 'bg-red-50'}
        />
        <StatCard
          title="Profit Margin"
          value={`${profitMarginPct.toFixed(1)}%`}
          icon={BarChart2}
          iconColor={profitMarginPct >= 0 ? 'text-leaf-600' : 'text-red-500'}
          iconBg={profitMarginPct >= 0 ? 'bg-leaf-50' : 'bg-red-50'}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={[
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              activeTab === id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB: Monthly P&L ──────────────────────────────────────────────────── */}
      {activeTab === 'pnl' && (
        <div className="space-y-6">
          {monthlyPnL.length === 0 ? (
            <SectionCard title="Monthly P&L">
              <p className="text-sm text-gray-400 py-8 text-center">
                No data yet. Add sales and expenses to see your monthly P&L.
              </p>
            </SectionCard>
          ) : (
            <>
              <SectionCard title="Revenue vs Expenses vs Profit" subtitle="Monthly breakdown">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlyPnL} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="month" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(v) => formatPHP(Number(v))}
                      cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                    />
                    <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                    <Bar dataKey="revenue"  name="Revenue"  fill={CHART_REVENUE} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="expenses" name="Expenses" fill={CHART_EXPENSE} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="payroll"  name="Payroll"  fill={CHART_PAYROLL} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="profit"   name="Profit"   fill={CHART_PROFIT} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </SectionCard>

              {/* P&L Table */}
              <SectionCard title="P&L Summary Table">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-primary-50">
                        {['Month', 'Revenue', 'Expenses', 'Payroll', 'Total Cost', 'Net Profit', 'Margin'].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {monthlyPnL.map((row) => {
                        const totalCost = row.expenses + row.payroll;
                        const margin = row.revenue > 0 ? (row.profit / row.revenue) * 100 : 0;
                        return (
                          <tr key={row.month} className="hover:bg-primary-50/50">
                            <td className="px-4 py-2.5 font-medium text-gray-900">{row.month}</td>
                            <td className="px-4 py-2.5 text-leaf-700 font-medium">{formatPHP(row.revenue)}</td>
                            <td className="px-4 py-2.5 text-red-600">{formatPHP(row.expenses)}</td>
                            <td className="px-4 py-2.5 text-gold-600">{formatPHP(row.payroll)}</td>
                            <td className="px-4 py-2.5 text-gray-700">{formatPHP(totalCost)}</td>
                            <td className={`px-4 py-2.5 font-bold ${row.profit >= 0 ? 'text-leaf-700' : 'text-red-600'}`}>
                              {formatPHP(row.profit)}
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge
                                label={`${margin.toFixed(1)}%`}
                                variant={margin >= 20 ? 'green' : margin >= 0 ? 'yellow' : 'red'}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* Totals row */}
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-primary-50 font-bold">
                        <td className="px-4 py-2.5 text-gray-900">TOTAL</td>
                        <td className="px-4 py-2.5 text-leaf-700">{formatPHP(totalRevenue)}</td>
                        <td className="px-4 py-2.5 text-red-600">{formatPHP(totalExpenses)}</td>
                        <td className="px-4 py-2.5 text-gold-600">{formatPHP(totalPayroll)}</td>
                        <td className="px-4 py-2.5 text-gray-700">{formatPHP(totalExpenses + totalPayroll)}</td>
                        <td className={`px-4 py-2.5 ${netProfit >= 0 ? 'text-leaf-700' : 'text-red-600'}`}>
                          {formatPHP(netProfit)}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            label={`${profitMarginPct.toFixed(1)}%`}
                            variant={profitMarginPct >= 20 ? 'green' : profitMarginPct >= 0 ? 'yellow' : 'red'}
                          />
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </SectionCard>
            </>
          )}
        </div>
      )}

      {/* ── TAB: Sales Analytics ──────────────────────────────────────────────── */}
      {activeTab === 'sales' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Sales by Product */}
            <SectionCard title="Top Products by Revenue" subtitle="Based on all sales records">
              {salesByProduct.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">No sales data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={salesByProduct} layout="vertical" margin={{ left: 20, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={120} />
                    <Tooltip
                      formatter={(v) => formatPHP(Number(v))}
                      cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                    />
                    <Bar dataKey="revenue" name="Revenue" fill={CHART_REVENUE} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            {/* Sales by Customer */}
            <SectionCard title="Sales by Customer" subtitle="Top 8 customers by revenue">
              {salesByCustomer.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">No sales data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={salesByCustomer}
                      dataKey="amount"
                      nameKey="name"
                      cx="50%"
                      cy={PIE_CENTER_Y}
                      innerRadius={PIE_INNER_RADIUS}
                      outerRadius={PIE_OUTER_RADIUS}
                      paddingAngle={1}
                      label={renderPieValueLabel}
                      labelLine={false}
                    >
                      {salesByCustomer.map((_, i) => (
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
              )}
            </SectionCard>

            {/* Sales by Sale Type */}
            <SectionCard title="Sales by Sale Type" subtitle="Revenue grouped by how the sale was made">
              {salesBySaleType.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">No sales data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={salesBySaleType}
                      dataKey="amount"
                      nameKey="name"
                      cx="50%"
                      cy={PIE_CENTER_Y}
                      innerRadius={PIE_INNER_RADIUS}
                      outerRadius={PIE_OUTER_RADIUS}
                      paddingAngle={1}
                      label={renderPieValueLabel}
                      labelLine={false}
                    >
                      {salesBySaleType.map((_, i) => (
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
              )}
            </SectionCard>
          </div>

          {/* Outstanding Invoice Aging */}
          <SectionCard title="Outstanding Invoices — Aging Report">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Current (not overdue)', value: agingBuckets.current, color: 'text-leaf-700', bg: 'bg-leaf-50' },
                { label: '1–30 days overdue', value: agingBuckets.days30, color: 'text-gold-700', bg: 'bg-gold-50' },
                { label: '31–60 days overdue', value: agingBuckets.days60, color: 'text-orange-600', bg: 'bg-orange-50' },
                { label: 'Over 60 days', value: agingBuckets.over60, color: 'text-red-700', bg: 'bg-red-50' },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className={`rounded-xl p-3 ${bg}`}>
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className={`text-lg font-bold mt-0.5 ${color}`}>{formatPHP(value)}</p>
                </div>
              ))}
            </div>

            {unpaidSales.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No outstanding invoices. 🎉</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-primary-50">
                      {['Date', 'Invoice #', 'Customer', 'Amount', 'Days Overdue', 'Status'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {unpaidSales.map((s) => (
                      <tr key={s.id} className="hover:bg-primary-50/50">
                        <td className="px-3 py-2.5 text-gray-600">{formatDate(s.date)}</td>
                        <td className="px-3 py-2.5 text-gray-600">{s.invoiceNumber || '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-gray-900">{s.customerName}</td>
                        <td className="px-3 py-2.5 font-semibold">{formatPHP(s.subtotal)}</td>
                        <td className="px-3 py-2.5">
                          <span className={s.daysOverdue > 60 ? 'text-red-600 font-bold' : s.daysOverdue > 30 ? 'text-orange-500 font-medium' : 'text-gray-600'}>
                            {s.daysOverdue > 0 ? `${s.daysOverdue} days` : 'Current'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge
                            label={s.daysOverdue > 60 ? 'Critical' : s.daysOverdue > 30 ? 'Overdue' : s.daysOverdue > 0 ? 'Pending' : 'Current'}
                            variant={s.daysOverdue > 60 ? 'red' : s.daysOverdue > 30 ? 'yellow' : 'gray'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── TAB: Financial Metrics ────────────────────────────────────────────── */}
      {activeTab === 'financial' && (
        <div className="space-y-6">
          {/* Product Margins */}
          <SectionCard title="Product Profit Margins (COGS)" subtitle="Selling price − cost ÷ selling price">
            {productMargins.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">
                No products with prices set yet. Go to Products and add cost and selling prices.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-primary-50">
                      {['Product', 'Cost (₱)', 'Sell Price (₱)', 'Margin (₱)', 'Margin %'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {productMargins.map((p) => (
                      <tr key={p.id} className="hover:bg-primary-50/50">
                        <td className="px-4 py-2.5 font-medium text-gray-900">{p.name}</td>
                        <td className="px-4 py-2.5 text-gray-600">{formatPHP(p.costPHP)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{formatPHP(p.sellingPricePHP)}</td>
                        <td className={`px-4 py-2.5 font-medium ${p.marginPHP >= 0 ? 'text-leaf-700' : 'text-red-600'}`}>
                          {formatPHP(p.marginPHP)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-gray-100 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${p.marginPct >= 30 ? 'bg-leaf-500' : p.marginPct >= 10 ? 'bg-gold-400' : 'bg-red-400'}`}
                                style={{ width: `${Math.min(100, Math.max(0, p.marginPct))}%` }}
                              />
                            </div>
                            <Badge
                              label={`${p.marginPct.toFixed(1)}%`}
                              variant={p.marginPct >= 30 ? 'green' : p.marginPct >= 10 ? 'yellow' : 'red'}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* Break-even tracker */}
          <SectionCard
            title="Break-Even Tracker"
            subtitle="Monthly fixed costs vs revenue needed to break even"
          >
            {monthlyPnL.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">Add sales and expenses to see break-even data.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
                  {(() => {
                    const avgRevenue = totalRevenue / Math.max(1, monthlyPnL.length);
                    const avgCost    = (totalExpenses + totalPayroll) / Math.max(1, monthlyPnL.length);
                    const monthsToBreakEven = netProfit < 0 ? Math.abs(netProfit / Math.max(1, avgRevenue - avgCost)) : 0;
                    return (
                      <>
                        <div className="bg-leaf-50 rounded-xl p-4">
                          <p className="text-xs text-gray-500">Avg Monthly Revenue</p>
                          <p className="text-lg font-bold text-leaf-700 mt-1">{formatPHP(avgRevenue)}</p>
                        </div>
                        <div className="bg-red-50 rounded-xl p-4">
                          <p className="text-xs text-gray-500">Avg Monthly Costs</p>
                          <p className="text-lg font-bold text-red-700 mt-1">{formatPHP(avgCost)}</p>
                        </div>
                        <div className={`rounded-xl p-4 ${netProfit >= 0 ? 'bg-leaf-50' : 'bg-orange-50'}`}>
                          <p className="text-xs text-gray-500">
                            {netProfit >= 0 ? 'Currently Profitable ✓' : 'Months to Break Even'}
                          </p>
                          <p className={`text-lg font-bold mt-1 ${netProfit >= 0 ? 'text-leaf-700' : 'text-orange-600'}`}>
                            {netProfit >= 0 ? formatPHP(netProfit) : `~${monthsToBreakEven.toFixed(1)} months`}
                          </p>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={monthlyPnL} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="month" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(v) => formatPHP(Number(v))}
                      cursor={{ stroke: '#dcbcd6', strokeWidth: 1 }}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                    />
                    <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                    <Line type="monotone" dataKey="revenue" name="Revenue" stroke={CHART_REVENUE} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="profit" name="Profit" stroke={CHART_PROFIT} strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
