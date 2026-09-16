import { Link } from 'react-router-dom';
import {
  ShoppingCart, Receipt, Banknote, TrendingUp,
  Users, Package, Truck, Sprout, UserCheck, Scissors, Scale, Handshake,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useMemo } from 'react';
import { format, parseISO, startOfMonth } from 'date-fns';

import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { PageHeader } from '../../components/ui/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { formatPHP, formatDate, formatNumber } from '../../utils/format';

import { useSaleStore } from '../../store/saleStore';
import { useExpenseStore } from '../../store/expenseStore';
import { usePayrollStore } from '../../store/payrollStore';
import { useEmployeeStore } from '../../store/employeeStore';
import { useProductStore } from '../../store/productStore';
import { useCustomerStore } from '../../store/customerStore';
import { useVendorStore } from '../../store/vendorStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useProductionStore } from '../../store/productionStore';
import { useCuttingStore } from '../../store/cuttingStore';
import { useWholesaleForecast } from '../../hooks/useWholesaleForecast';

const PIE_COLORS = ['#16a34a', '#15803d', '#86efac', '#4ade80', '#bbf7d0', '#f59e0b', '#ef4444', '#3b82f6'];

export function DashboardPage() {
  const { sales, totalRevenue } = useSaleStore();
  const { expenses, totalExpenses, totalByCategory } = useExpenseStore();
  const { entries: _payrollEntries, totalPayroll } = usePayrollStore();
  const { employees } = useEmployeeStore();
  const { products } = useProductStore();
  const { customers } = useCustomerStore();
  const { vendors } = useVendorStore();
  const { items: inventoryItems } = useInventoryStore();
  const { entries: productionEntries } = useProductionStore();
  const {
    batches: cuttingBatches,
    totalCost: cuttingCost,
    totalAvailableToSell: cuttingsReady,
  } = useCuttingStore();

  const forecast = useWholesaleForecast();

  const revenue = totalRevenue();
  const totalExp = totalExpenses();
  const totalPay = totalPayroll();
  const profit = revenue - totalExp - totalPay;

  // ── Sales by month ───────────────────────────────────────────────────────────
  const salesByMonth = useMemo(() => {
    const map = new Map<string, number>();
    sales.forEach((s) => {
      if (!s.date) return;
      try {
        const month = format(startOfMonth(parseISO(s.date)), 'MMM yyyy');
        map.set(month, (map.get(month) ?? 0) + s.subtotal);
      } catch { /* skip malformed dates */ }
    });
    return Array.from(map.entries())
      .map(([month, amount]) => ({ month, amount }))
      .slice(-6);
  }, [sales]);

  // ── Expenses by category ─────────────────────────────────────────────────────
  // Uses the store's category split so multi-item expenses attribute each line to
  // its own category (rather than lumping the whole amount under the first one).
  const expensesByCategory = useMemo(() => {
    return Object.entries(totalByCategory())
      .map(([category, value]) => ({ category, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses]);

  // ── Recent sales ─────────────────────────────────────────────────────────────
  const recentSales = useMemo(
    () => [...sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [sales]
  );

  // ── Production summary ───────────────────────────────────────────────────────
  const productionData = useMemo(() => {
    return productionEntries.slice(-7).map((e) => ({
      date: e.date ? format(parseISO(e.date), 'MMM d') : '—',
      good: e.goodFruits,
      damaged: e.damaged,
      weight: e.weightKg,
    }));
  }, [productionEntries]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`Overview · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
      />

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Revenue"
          value={formatPHP(revenue)}
          icon={ShoppingCart}
          iconColor="text-green-600"
          iconBg="bg-green-50"
        />
        <StatCard
          title="Total Expenses"
          value={formatPHP(totalExp)}
          icon={Receipt}
          iconColor="text-red-500"
          iconBg="bg-red-50"
        />
        <StatCard
          title="Total Payroll"
          value={formatPHP(totalPay)}
          icon={Banknote}
          iconColor="text-orange-500"
          iconBg="bg-orange-50"
        />
        <StatCard
          title="Net Profit"
          value={formatPHP(profit)}
          subtitle="Revenue − Expenses − Payroll"
          icon={TrendingUp}
          iconColor={profit >= 0 ? 'text-green-600' : 'text-red-500'}
          iconBg={profit >= 0 ? 'bg-green-50' : 'bg-red-50'}
        />
      </div>

      {/* ── Entity counts ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard title="Employees"   value={employees.length}      icon={UserCheck} iconColor="text-blue-600"   iconBg="bg-blue-50" />
        <StatCard title="Products"    value={products.length}       icon={Package}   iconColor="text-purple-600" iconBg="bg-purple-50" />
        <StatCard title="Customers"   value={customers.length}      icon={Users}     iconColor="text-cyan-600"   iconBg="bg-cyan-50" />
        <StatCard title="Vendors"     value={vendors.length}        icon={Truck}     iconColor="text-amber-600"  iconBg="bg-amber-50" />
        <StatCard title="Inventory Items" value={inventoryItems.length} icon={Sprout} iconColor="text-teal-600" iconBg="bg-teal-50" />
      </div>

      {/* ── Cuttings summary ─────────────────────────────────────────────── */}
      {cuttingBatches.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Cuttings Cost"
            value={formatPHP(cuttingCost())}
            subtitle="Sourcing + grafting invested"
            icon={Scissors}
            iconColor="text-red-500"
            iconBg="bg-red-50"
          />
          <StatCard
            title="Cuttings Ready to Sell"
            value={cuttingsReady()}
            subtitle="Rooted & available"
            icon={Sprout}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-50"
          />
          <StatCard
            title="Cutting Batches"
            value={cuttingBatches.length}
            icon={Package}
            iconColor="text-purple-600"
            iconBg="bg-purple-50"
          />
        </div>
      )}

      {/* ── Wholesale supply forecast ─────────────────────────────────────── */}
      {forecast.windows.length > 0 && (
        <SectionCard
          title="Wholesale Supply Forecast"
          subtitle="Projected fruit from deployed cuttings — available to contract to wholesale customers"
          actions={
            <Link to="/wholesale-forecast" className="text-xs font-medium text-green-700 hover:underline">
              View full forecast →
            </Link>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <StatCard
              title="Total Projected Supply"
              value={`${formatNumber(forecast.totals.totalKg, 1)} kg`}
              subtitle={`${formatNumber(forecast.totals.totalPieces, 0)} fruits`}
              icon={Scale}
              iconColor="text-gray-700"
              iconBg="bg-gray-100"
            />
            <StatCard
              title="Internal Farm Pool"
              value={`${formatNumber(forecast.totals.internalKg, 1)} kg`}
              subtitle="From planted batches"
              icon={Sprout}
              iconColor="text-emerald-600"
              iconBg="bg-emerald-50"
            />
            <StatCard
              title="Farm Partner Pool"
              value={`${formatNumber(forecast.totals.partnerKg, 1)} kg`}
              subtitle="From delivered cuttings"
              icon={Handshake}
              iconColor="text-blue-600"
              iconBg="bg-blue-50"
            />
            <StatCard
              title="Next Harvest Window"
              value={forecast.windows[0]?.label ?? '—'}
              subtitle={forecast.windows[0] ? `${formatNumber(forecast.windows[0].totalKg, 1)} kg projected` : ''}
              icon={TrendingUp}
              iconColor="text-amber-600"
              iconBg="bg-amber-50"
            />
          </div>
        </SectionCard>
      )}

      {/* ── Charts row 1 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Sales trend */}
        <SectionCard title="Sales Trend" subtitle="Last 6 months" className="xl:col-span-2">
          {salesByMonth.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">
              No sales data yet. Add sales to see the trend.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={salesByMonth} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16a34a" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatPHP(Number(v))} />
                <Area type="monotone" dataKey="amount" stroke="#16a34a" fill="url(#salesGrad)" strokeWidth={2} name="Sales" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* Expenses by category */}
        <SectionCard title="Expenses by Category">
          {expensesByCategory.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">
              No expense data yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={expensesByCategory}
                  dataKey="value"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) =>
                    (percent ?? 0) > 0.05 ? `${String(name).substring(0, 8)}…` : ''
                  }
                  labelLine={false}
                >
                  {expensesByCategory.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatPHP(Number(v))} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      {/* ── Charts row 2 ──────────────────────────────────────────────────── */}
      {productionData.length > 0 && (
        <SectionCard title="Recent Harvest" subtitle="Last 7 production entries">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={productionData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="good" name="Good Fruits" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="damaged" name="Damaged" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      )}

      {/* ── Profit summary ────────────────────────────────────────────────── */}
      <SectionCard title="Financial Summary">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Revenue',  value: revenue,   color: 'text-green-700', bg: 'bg-green-50' },
            { label: 'Total Expenses', value: totalExp,  color: 'text-red-600',   bg: 'bg-red-50' },
            { label: 'Net Profit',     value: profit,    color: profit >= 0 ? 'text-green-700' : 'text-red-600', bg: profit >= 0 ? 'bg-green-50' : 'bg-red-50' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`rounded-xl p-4 ${bg}`}>
              <p className="text-xs font-medium text-gray-500">{label}</p>
              <p className={`text-xl font-bold mt-1 ${color}`}>{formatPHP(value)}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ── Recent Sales table ────────────────────────────────────────────── */}
      <SectionCard title="Recent Sales" subtitle="5 most recent transactions">
        {recentSales.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No sales recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Date', 'Invoice', 'Customer', 'Amount', 'Status'].map((h) => (
                    <th key={h} className="pb-2 text-left text-xs font-semibold text-gray-500 pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentSales.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 pr-4 text-gray-600">{formatDate(s.date)}</td>
                    <td className="py-2 pr-4 text-gray-600">{s.invoiceNumber || '—'}</td>
                    <td className="py-2 pr-4 text-gray-800 font-medium">{s.customerName}</td>
                    <td className="py-2 pr-4 font-semibold text-gray-900">{formatPHP(s.subtotal)}</td>
                    <td className="py-2">
                      <Badge label={s.paid ? 'Paid' : 'Unpaid'} variant={s.paid ? 'green' : 'yellow'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
