/**
 * Section — Labor & Total Cost Breakdown.
 *
 * Splits payroll cost by its bookkeeping attributes (snapshotted onto each
 * payroll entry from the employee's role, synced from the sheet's "Labor" tab):
 *   - Labor type: Direct / Indirect / Selling / Administrative (donut).
 *   - Combined cost by accounting classification: expenses + payroll folded into
 *     the SAME COGS-vs-OpEx buckets, so it reads as "where every peso of cost
 *     lands in the books" (horizontal bars).
 *
 * Farm-wide totals (not slicer-scoped). Entries missing an attribute pool into
 * an "Unclassified" slice so totals always reconcile.
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

interface LaborBreakdownProps {
  byLaborType: ExpenseBreakdownSlice[];
  costByClassification: ExpenseBreakdownSlice[];
  totalPayroll: number;
  totalCost: number; // expenses + payroll, for the combined card subtitle
}

export function LaborBreakdown({
  byLaborType, costByClassification, totalPayroll, totalCost,
}: LaborBreakdownProps) {
  const hasPayroll = totalPayroll > 0 && byLaborType.length > 0;
  const hasCost = totalCost > 0 && costByClassification.length > 0;

  if (!hasPayroll && !hasCost) {
    return (
      <SectionCard title="Labor & Total Cost" subtitle="Payroll by labor type + combined cost classification">
        <EmptyChart message="No payroll or expenses recorded yet. Run payroll and add expenses to see labor split by Direct/Indirect/Selling/Admin and total cost by COGS vs OpEx." />
      </SectionCard>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* Payroll by labor type — donut */}
      <SectionCard title="Payroll by Labor Type" subtitle="Direct vs Indirect vs Selling vs Administrative">
        {hasPayroll ? (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={byLaborType}
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
                {byLaborType.map((_, i) => (
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
          <EmptyChart message="No payroll recorded yet." />
        )}
      </SectionCard>

      {/* Combined cost by accounting classification — expenses + payroll */}
      <SectionCard
        title="Total Cost by Classification"
        subtitle="Expenses + payroll combined — COGS vs OpEx"
      >
        {hasCost ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={costByClassification}
              layout="vertical"
              margin={{ top: 5, right: 16, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
              <XAxis
                type="number"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `₱${Math.round(Number(v) / 1000)}k`}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                width={150}
              />
              <Tooltip
                formatter={(v) => formatPHP(Number(v))}
                cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Bar dataKey="amount" name="Cost" radius={[0, 4, 4, 0]}>
                {costByClassification.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message="No classified cost yet." />
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
