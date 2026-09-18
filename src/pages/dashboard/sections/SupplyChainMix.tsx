/**
 * Section 3 — Supply Chain & Farm-Partner Mix.
 *
 *  - Procurement vs Sales: what we spend vs what we earn.
 *  - Internal vs Partner supply pool (projected kg from the wholesale forecast).
 *  - Fulfillment Performance: delivered % + collected % + avg lead time.
 *      (PROXY: the app tracks no delivery zone or promised-date, so "on-time"
 *       is approximated by delivered-vs-eligible and payment collection.)
 *  - Freshness & Quality Score: good-fruit share from production.
 *      (PROXY: no per-batch freshness field exists.)
 */
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Handshake, Sprout, Truck, ShoppingBag } from 'lucide-react';
import { SectionCard } from '../../../components/ui/SectionCard';
import { formatPHP, formatNumber } from '../../../utils/format';
import { CHART_REVENUE, CHART_EXPENSE } from '../../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
} from '../../../constants/chartTheme';

interface SupplyChainMixProps {
  procurementCost: number;
  salesEarned: number;
  poolMix: { internalKg: number; partnerKg: number; totalKg: number };
  fulfillment: {
    deliveredPct: number;
    deliveredCount: number;
    deliverableCount: number;
    paidPct: number;
    avgLeadDays: number;
  };
  quality: { score: number; good: number; damaged: number; harvested: number };
}

/** A labeled horizontal progress meter used for fulfillment/quality percentages. */
function Meter({ label, pct, tone, caption }: { label: string; pct: number; tone: string; caption: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm font-bold text-gray-900">{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-1.5 h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-1 text-xs text-gray-400">{caption}</p>
    </div>
  );
}

function meterTone(pct: number): string {
  if (pct >= 80) return 'bg-leaf-500';
  if (pct >= 50) return 'bg-gold-400';
  return 'bg-red-400';
}

export function SupplyChainMix({
  procurementCost, salesEarned, poolMix, fulfillment, quality,
}: SupplyChainMixProps) {
  const procurementData = [
    { name: 'Procurement', value: procurementCost, fill: CHART_EXPENSE },
    { name: 'Sales', value: salesEarned, fill: CHART_REVENUE },
  ];
  const hasPool = poolMix.totalKg > 0;
  const internalPct = hasPool ? (poolMix.internalKg / poolMix.totalKg) * 100 : 0;
  const partnerPct = hasPool ? (poolMix.partnerKg / poolMix.totalKg) * 100 : 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* Procurement vs Sales */}
      <SectionCard title="Procurement vs Sales" subtitle="Cash out vs cash in">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={procurementData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v) => formatPHP(Number(v))}
              cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
            />
            <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]}>
              {procurementData.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-1 text-xs text-gray-400 text-center">
          Net position: <span className={salesEarned - procurementCost >= 0 ? 'text-leaf-700 font-semibold' : 'text-red-600 font-semibold'}>
            {formatPHP(salesEarned - procurementCost)}
          </span>
        </p>
      </SectionCard>

      {/* Internal vs Partner pool */}
      <SectionCard title="Farm Pool Mix" subtitle="Projected supply source (kg)">
        {!hasPool ? (
          <div className="h-48 flex items-center justify-center text-sm text-gray-400 text-center px-4">
            No deployed cuttings yet — plant internal batches or deliver partner cuttings to build the forecast.
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-leaf-50"><Sprout className="w-5 h-5 text-leaf-600" /></div>
              <div className="flex-1">
                <Meter label="Internal Farm Pool" pct={internalPct} tone="bg-leaf-500" caption={`${formatNumber(poolMix.internalKg, 1)} kg projected`} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-berry-50"><Handshake className="w-5 h-5 text-berry-600" /></div>
              <div className="flex-1">
                <Meter label="Farm Partner Pool" pct={partnerPct} tone="bg-berry-500" caption={`${formatNumber(poolMix.partnerKg, 1)} kg projected`} />
              </div>
            </div>
            <div className="rounded-lg bg-primary-50 px-3 py-2 text-center">
              <span className="text-xs text-gray-500">Total projected supply </span>
              <span className="text-sm font-bold text-primary-800">{formatNumber(poolMix.totalKg, 1)} kg</span>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Fulfillment + Quality */}
      <SectionCard title="Fulfillment & Quality" subtitle="Delivery reliability + crop quality">
        <div className="space-y-4 py-1">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary-50"><Truck className="w-5 h-5 text-primary-600" /></div>
            <div className="flex-1">
              <Meter
                label="Cutting Delivery Rate"
                pct={fulfillment.deliveredPct}
                tone={meterTone(fulfillment.deliveredPct)}
                caption={`${fulfillment.deliveredCount}/${fulfillment.deliverableCount} orders delivered · ~${formatNumber(fulfillment.avgLeadDays, 0)} day lead`}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gold-50"><ShoppingBag className="w-5 h-5 text-gold-600" /></div>
            <div className="flex-1">
              <Meter
                label="Invoices Collected"
                pct={fulfillment.paidPct}
                tone={meterTone(fulfillment.paidPct)}
                caption="Share of sales marked paid"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-leaf-50"><Sprout className="w-5 h-5 text-leaf-600" /></div>
            <div className="flex-1">
              <Meter
                label="Freshness & Quality Score"
                pct={quality.score}
                tone={meterTone(quality.score)}
                caption={quality.harvested > 0 ? `${formatNumber(quality.good, 0)} good of ${formatNumber(quality.harvested, 0)} harvested` : 'No harvest data yet'}
              />
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
