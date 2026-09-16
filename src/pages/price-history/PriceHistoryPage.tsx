import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { TrendingUp, Package, Truck } from 'lucide-react';

import { PageHeader } from '../../components/ui/PageHeader';
import { SectionCard } from '../../components/ui/SectionCard';
import { StatCard } from '../../components/ui/StatCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatPHP, formatDate } from '../../utils/format';

import { useExpenseStore } from '../../store/expenseStore';
import { useSaleStore } from '../../store/saleStore';

const LINE_COLORS = ['#16a34a', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

type Tab = 'supplies' | 'products';

function fmtDate(d: string) {
  try { return format(parseISO(d), 'MMM d, yy'); } catch { return d; }
}

export function PriceHistoryPage() {
  const [tab, setTab] = useState<Tab>('supplies');

  const { pricedSupplies, supplyPriceHistory } = useExpenseStore();
  const { soldProducts, productPriceHistory } = useSaleStore();

  const supplies = useMemo(() => pricedSupplies(), [pricedSupplies]);
  const products = useMemo(() => soldProducts(), [soldProducts]);

  const [selectedSupply, setSelectedSupply] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<string>('');

  // Default selections
  const supplyKey = selectedSupply || (supplies[0] ? `${supplies[0].category}||${supplies[0].subcategory}` : '');
  const productKey = selectedProduct || (products[0]?.productId ?? '');

  // ── Supply price history (grouped by vendor) ─────────────────────────────────
  const supplyData = useMemo(() => {
    if (!supplyKey) return { points: [], vendors: [] as string[], chart: [] as Record<string, unknown>[] };
    const [base, sub] = supplyKey.split('||');
    const points = supplyPriceHistory(base, sub);

    const vendors = [...new Set(points.map((p) => p.vendorName || 'Unknown'))];
    // Build chart rows keyed by date, one series per vendor
    const byDate = new Map<string, Record<string, unknown>>();
    points.forEach((p) => {
      const d = fmtDate(p.date);
      if (!byDate.has(d)) byDate.set(d, { date: d });
      byDate.get(d)![p.vendorName || 'Unknown'] = p.unitPrice;
    });
    return { points, vendors, chart: Array.from(byDate.values()) };
  }, [supplyKey, supplyPriceHistory]);

  // ── Product price history ────────────────────────────────────────────────────
  const productData = useMemo(() => {
    if (!productKey) return { points: [], chart: [] as { date: string; price: number }[] };
    const points = productPriceHistory(productKey);
    const chart = points.map((p) => ({ date: fmtDate(p.date), price: p.unitPrice }));
    return { points, chart };
  }, [productKey, productPriceHistory]);

  const supplyStats = useMemo(() => {
    const prices = supplyData.points.map((p) => p.unitPrice);
    if (prices.length === 0) return null;
    return {
      latest: prices[prices.length - 1],
      min: Math.min(...prices),
      max: Math.max(...prices),
      count: prices.length,
    };
  }, [supplyData]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Price History"
        subtitle="Track how supply costs and product prices change over time"
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          { id: 'supplies', label: 'Supply Costs', icon: Truck },
          { id: 'products', label: 'Product Prices', icon: Package },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={[
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Supply Costs ──────────────────────────────────────────────────────── */}
      {tab === 'supplies' && (
        supplies.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No supply price history yet"
            description="Record expenses with a quantity and unit price (on quantifiable categories like Fertilizer) to build price history here."
          />
        ) : (
          <div className="space-y-4">
            <div className="max-w-sm">
              <label className="text-sm font-medium text-gray-700">Supply</label>
              <select
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                value={supplyKey}
                onChange={(e) => setSelectedSupply(e.target.value)}
              >
                {supplies.map((s) => (
                  <option key={`${s.category}||${s.subcategory}`} value={`${s.category}||${s.subcategory}`}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {supplyStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard title="Latest Price" value={formatPHP(supplyStats.latest)} icon={TrendingUp} iconColor="text-green-600" iconBg="bg-green-50" />
                <StatCard title="Lowest" value={formatPHP(supplyStats.min)} icon={TrendingUp} iconColor="text-blue-600" iconBg="bg-blue-50" />
                <StatCard title="Highest" value={formatPHP(supplyStats.max)} icon={TrendingUp} iconColor="text-red-500" iconBg="bg-red-50" />
                <StatCard title="Purchases" value={supplyStats.count} icon={Truck} iconColor="text-purple-600" iconBg="bg-purple-50" />
              </div>
            )}

            <SectionCard title="Unit Price Over Time" subtitle="One line per vendor">
              {supplyData.chart.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">No priced purchases for this supply.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={supplyData.chart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${v}`} />
                    <Tooltip formatter={(v) => formatPHP(Number(v))} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    {supplyData.vendors.map((vendor, i) => (
                      <Line
                        key={vendor}
                        type="monotone"
                        dataKey={vendor}
                        name={vendor}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title="Purchase Records">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      {['Date', 'Vendor', 'Qty', 'Unit Price', 'Total'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...supplyData.points].reverse().map((p) => (
                      <tr key={p.expenseId} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-600">{formatDate(p.date)}</td>
                        <td className="px-4 py-2.5 text-gray-800 font-medium">{p.vendorName || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{p.quantity || '—'}</td>
                        <td className="px-4 py-2.5 font-semibold text-gray-900">{formatPHP(p.unitPrice)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{p.quantity ? formatPHP(p.quantity * p.unitPrice) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )
      )}

      {/* ── Product Prices ────────────────────────────────────────────────────── */}
      {tab === 'products' && (
        products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No product price history yet"
            description="Record sales to build selling-price history for your products."
          />
        ) : (
          <div className="space-y-4">
            <div className="max-w-sm">
              <label className="text-sm font-medium text-gray-700">Product</label>
              <select
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                value={productKey}
                onChange={(e) => setSelectedProduct(e.target.value)}
              >
                {products.map((p) => (
                  <option key={p.productId} value={p.productId}>{p.productName}</option>
                ))}
              </select>
            </div>

            <SectionCard title="Selling Price Over Time">
              {productData.chart.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">No sales for this product yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={productData.chart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${v}`} />
                    <Tooltip formatter={(v) => formatPHP(Number(v))} />
                    <Line type="monotone" dataKey="price" name="Selling Price" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title="Sale Records">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      {['Date', 'Qty', 'Unit Price', 'Total'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...productData.points].reverse().map((p, i) => (
                      <tr key={`${p.saleId}-${i}`} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-600">{formatDate(p.date)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{p.quantity}</td>
                        <td className="px-4 py-2.5 font-semibold text-gray-900">{formatPHP(p.unitPrice)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{formatPHP(p.quantity * p.unitPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )
      )}
    </div>
  );
}
