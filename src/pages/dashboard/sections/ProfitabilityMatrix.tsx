/**
 * Section 2 — Crop & Variety Profitability Matrix.
 *
 * Breaks performance down by variety to show which items drive profit and which
 * drain resources:
 *   - Revenue vs Operating Cost, side-by-side bars per variety
 *   - Profit Margin % per variety (color-coded)
 *   - Cutting status distribution (Growing / Callusing / Ready / Sold …)
 */
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { SectionCard } from '../../../components/ui/SectionCard';
import { Badge } from '../../../components/ui/Badge';
import { formatPHP } from '../../../utils/format';
import { CHART_REVENUE, CHART_EXPENSE, PIE_COLORS } from '../../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../../constants/chartTheme';
import type { VarietyProfit } from '../useDashboardData';

interface ProfitabilityMatrixProps {
  varietyProfit: VarietyProfit[];
  statusDistribution: { status: string; quantity: number }[];
}

function marginVariant(pct: number): 'green' | 'yellow' | 'red' {
  if (pct >= 30) return 'green';
  if (pct >= 10) return 'yellow';
  return 'red';
}

export function ProfitabilityMatrix({ varietyProfit, statusDistribution }: ProfitabilityMatrixProps) {
  const hasSales = varietyProfit.length > 0;
  const hasStatus = statusDistribution.length > 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* Revenue vs Cost by variety */}
      <SectionCard
        title="Revenue vs Operating Cost"
        subtitle="By variety — profit drivers vs resource drains"
        className="xl:col-span-2"
      >
        {!hasSales ? (
          <EmptyChart message="No sales yet. Record sales to compare variety profitability." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={varietyProfit} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="variety" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v) => formatPHP(Number(v))}
                cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
              <Bar dataKey="revenue" name="Revenue" fill={CHART_REVENUE} radius={[3, 3, 0, 0]} />
              <Bar dataKey="cost" name="Operating Cost" fill={CHART_EXPENSE} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      {/* Cutting status distribution */}
      <SectionCard title="Growth Status Mix" subtitle="Cuttings by lifecycle stage">
        {!hasStatus ? (
          <EmptyChart message="No cutting batches yet." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={statusDistribution}
                dataKey="quantity"
                nameKey="status"
                cx="50%"
                cy={PIE_CENTER_Y}
                innerRadius={PIE_INNER_RADIUS}
                outerRadius={PIE_OUTER_RADIUS}
                paddingAngle={1}
                label={renderPieValueLabel}
                labelLine={false}
              >
                {statusDistribution.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => `${v} cuttings`}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      {/* Profit margin % by variety */}
      <SectionCard title="Profit Margin % by Variety" subtitle="High-value vs low-margin crops" className="xl:col-span-3">
        {!hasSales ? (
          <EmptyChart message="No sales yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary-100 bg-primary-50">
                  {['Variety', 'Revenue', 'Operating Cost', 'Profit', 'Margin %'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {varietyProfit.map((v) => (
                  <tr key={v.variety} className="hover:bg-primary-50/50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{v.variety}</td>
                    <td className="px-4 py-2.5 text-leaf-700 font-medium">{formatPHP(v.revenue)}</td>
                    <td className="px-4 py-2.5 text-red-600">{formatPHP(v.cost)}</td>
                    <td className={`px-4 py-2.5 font-semibold ${v.profit >= 0 ? 'text-leaf-700' : 'text-red-600'}`}>
                      {formatPHP(v.profit)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge label={`${v.marginPct.toFixed(1)}%`} variant={marginVariant(v.marginPct)} />
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

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-48 flex items-center justify-center text-sm text-gray-400 text-center px-4">
      {message}
    </div>
  );
}
