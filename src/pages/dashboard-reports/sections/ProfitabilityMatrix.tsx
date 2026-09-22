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
import { formatPHP } from '../../../utils/format';
import { CHART_REVENUE, CHART_EXPENSE, PIE_COLORS, BRAND } from '../../../constants/chartColors';
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

/** Bar fill by margin band: green ≥30%, gold ≥10%, red below (or negative). */
function marginBarColor(pct: number): string {
  if (pct >= 30) return BRAND.leaf;
  if (pct >= 10) return BRAND.gold;
  return '#ef4444';
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

      {/* Profit margin % by variety — color-coded bars (green ≥30, yellow ≥10, red <10) */}
      <SectionCard title="Profit Margin % by Variety" subtitle="High-value vs low-margin crops" className="xl:col-span-3">
        {!hasSales ? (
          <EmptyChart message="No sales yet." />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, varietyProfit.length * 40)}>
            <BarChart
              layout="vertical"
              data={varietyProfit}
              margin={{ top: 5, right: 40, left: 10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
              <XAxis
                type="number"
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <YAxis
                type="category"
                dataKey="variety"
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                width={110}
              />
              <Tooltip
                formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Margin']}
                cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Bar dataKey="marginPct" name="Margin %" radius={[0, 3, 3, 0]}>
                {varietyProfit.map((v) => (
                  <Cell key={v.variety} fill={marginBarColor(v.marginPct)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
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
