/**
 * Financial performance by location — all charts.
 *
 * Local (Philippine) sales are attributed to each customer's province (in PHP);
 * international sales to the customer's country (in USD). PHP and USD are never
 * summed, so the two worlds are shown separately:
 *   - By Region (₱):   donut of sales share across Philippine regions.
 *   - By Province (₱):  Sales vs Expenses grouped bars per province.
 *   - By Country ($):   Sales vs Expenses grouped bars per international country.
 */
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { SectionCard } from '../../../components/ui/SectionCard';
import { formatPHP, formatUSD } from '../../../utils/format';
import { CHART_REVENUE, CHART_EXPENSE, PIE_COLORS } from '../../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../../constants/chartTheme';
import type { LocationPerformance, CountryPerformance } from '../useDashboardData';

interface LocationPerformanceSectionProps {
  byProvince: LocationPerformance[];
  byRegion: LocationPerformance[];
  byCountry: CountryPerformance[];
}

/** Currency-axis formatters shared by the bar charts (thousands shorthand). */
const pesoKAxis = (v: number) => `₱${(v / 1000).toFixed(0)}k`;
const usdKAxis = (v: number) => `$${(v / 1000).toFixed(0)}k`;

export function LocationPerformanceSection({ byProvince, byRegion, byCountry }: LocationPerformanceSectionProps) {
  const hasData = byProvince.some((r) => r.sales > 0 || r.expenses > 0);
  const hasIntl = byCountry.some((r) => r.sales > 0 || r.expenses > 0);

  // Region donut is driven by sales share; regions with no sales are dropped so
  // the pie stays meaningful.
  const regionSales = byRegion.filter((r) => r.sales > 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* By Region — sales share donut (Philippine sales, PHP) */}
      <SectionCard title="Sales by Region (₱)" subtitle="Share of local sales across Philippine regions">
        {regionSales.length === 0 ? (
          <EmptyChart message="No located sales yet." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={regionSales}
                dataKey="sales"
                nameKey="region"
                cx="50%"
                cy={PIE_CENTER_Y}
                innerRadius={PIE_INNER_RADIUS}
                outerRadius={PIE_OUTER_RADIUS}
                paddingAngle={1}
                label={renderPieValueLabel}
                labelLine={false}
              >
                {regionSales.map((_, i) => (
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

      {/* By Province — sales vs expenses grouped bars (Philippine, PHP) */}
      <SectionCard
        title="Sales vs Expenses by Province (₱)"
        subtitle="Local customer sales vs vendor expenses per province"
        className="xl:col-span-2"
      >
        {!hasData ? (
          <EmptyChart message="Record a customer or vendor with a province to see this chart." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byProvince} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="province" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={pesoKAxis} />
              <Tooltip
                formatter={(v) => formatPHP(Number(v))}
                cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
              <Bar dataKey="sales" name="Sales" fill={CHART_REVENUE} radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill={CHART_EXPENSE} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      {/* By Country — international sales vs expenses (USD). Only shown once
          there is international activity, since most data is local (PHP). */}
      {hasIntl && (
        <SectionCard
          title="International: Sales vs Expenses by Country ($)"
          subtitle="USD sales & expenses per country — kept separate from peso figures, never converted"
          className="xl:col-span-3"
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byCountry} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="country" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={usdKAxis} />
              <Tooltip
                formatter={(v) => formatUSD(Number(v))}
                cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
              <Bar dataKey="sales" name="Sales" fill={CHART_REVENUE} radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill={CHART_EXPENSE} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      )}
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
