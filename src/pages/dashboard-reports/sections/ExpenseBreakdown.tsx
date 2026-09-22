/**
 * Section — Expense Bookkeeping Breakdown.
 *
 * Groups total spend by the two bookkeeping attributes carried on each expense
 * (synced from the "Expense Categories" sheet and prefilled by category):
 *   - Accounting classification: CapEx / OpEx / COGS … (donut)
 *   - Cost behavior / expense type: Fixed / Variable / Semi-Variable (bars)
 *
 * These are farm-wide totals (not slicer-scoped). Expenses missing an attribute
 * are pooled into an "Unclassified" slice so the totals always reconcile.
 */
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { SectionCard } from '../../../components/ui/SectionCard';
import { formatPHP } from '../../../utils/format';
import { PIE_COLORS } from '../../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../../constants/chartTheme';
import type { ExpenseBreakdownSlice } from '../useDashboardData';

interface ExpenseBreakdownProps {
  byClassification: ExpenseBreakdownSlice[];
  byType: ExpenseBreakdownSlice[];
  totalExpenses: number;
}

export function ExpenseBreakdown({ byClassification, byType, totalExpenses }: ExpenseBreakdownProps) {
  const hasData = totalExpenses > 0 && (byClassification.length > 0 || byType.length > 0);

  if (!hasData) {
    return (
      <SectionCard title="Expense Breakdown" subtitle="Spend by accounting classification & cost behavior">
        <EmptyChart message="No expenses recorded yet. Add expenses to see how spend splits across CapEx / OpEx / COGS and fixed vs variable cost." />
      </SectionCard>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* Accounting classification — donut */}
      <SectionCard title="By Accounting Classification" subtitle="CapEx vs OpEx vs COGS (share of total spend)">
        {byClassification.length === 0 ? (
          <EmptyChart message="No classified expenses yet." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={byClassification}
                dataKey="amount"
                nameKey="label"
                cx="50%"
                cy={PIE_CENTER_Y}
                innerRadius={PIE_INNER_RADIUS}
                outerRadius={PIE_OUTER_RADIUS}
                paddingAngle={1}
                label={renderPieValueLabel}
                labelLine={false}
              >
                {byClassification.map((_, i) => (
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

      {/* Cost behavior / expense type — horizontal bars */}
      <SectionCard title="By Cost Behavior" subtitle="Fixed vs variable spend (expense type)">
        {byType.length === 0 ? (
          <EmptyChart message="No expenses with a cost behavior yet." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={byType}
              layout="vertical"
              margin={{ top: 5, right: 16, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
              <XAxis
                type="number"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                width={110}
              />
              <Tooltip
                formatter={(v) => formatPHP(Number(v))}
                cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Bar dataKey="amount" name="Spend" radius={[0, 4, 4, 0]}>
                {byType.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
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
