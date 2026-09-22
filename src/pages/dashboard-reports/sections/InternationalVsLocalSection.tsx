/**
 * International vs Local sales.
 *
 * Splits sales into Local (Philippine customers, PHP) and International (customers
 * outside the Philippines, USD). PHP and USD are kept STRICTLY separate — never
 * summed or converted — so each segment is shown with its own total, count, and
 * revenue-by-variety chart in its own currency.
 *
 * A Category → Variety drill (mirroring the Sales page pattern) narrows both
 * segments at once: pick a category to see its varieties, optionally pick one
 * variety to isolate it.
 */
import { useMemo, useState } from 'react';
import { Globe2, MapPin } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { SectionCard } from '../../../components/ui/SectionCard';
import { StatCard } from '../../../components/ui/StatCard';
import { formatPHP, formatUSD } from '../../../utils/format';
import { CHART_REVENUE, BRAND } from '../../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
} from '../../../constants/chartTheme';
import type { IntlVsLocal, IntlVsLocalLine } from '../useDashboardData';

interface InternationalVsLocalSectionProps {
  data: IntlVsLocal;
}

/** Sum revenue by variety for one segment's (already filtered) lines, desc. */
function byVariety(lines: IntlVsLocalLine[]): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const l of lines) map.set(l.variety, (map.get(l.variety) ?? 0) + l.revenue);
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

export function InternationalVsLocalSection({ data }: InternationalVsLocalSectionProps) {
  // Category → variety drill (both optional). Changing the category resets the
  // variety, since varieties are scoped to a category.
  const [category, setCategory] = useState<string>('all');
  const [variety, setVariety] = useState<string>('all');
  const changeCategory = (c: string) => { setCategory(c); setVariety('all'); };

  // Distinct categories across all lines.
  const categories = useMemo(
    () => Array.from(new Set(data.lines.map((l) => l.category))).sort(),
    [data.lines],
  );
  // Varieties within the chosen category.
  const varieties = useMemo(() => {
    if (category === 'all') return [];
    return Array.from(
      new Set(data.lines.filter((l) => l.category === category).map((l) => l.variety)),
    ).sort();
  }, [data.lines, category]);

  // Lines matching the active drill filter.
  const filtered = useMemo(
    () => data.lines.filter((l) =>
      (category === 'all' || l.category === category) &&
      (variety === 'all' || l.variety === variety),
    ),
    [data.lines, category, variety],
  );

  const localLines = filtered.filter((l) => l.segment === 'Local');
  const intlLines = filtered.filter((l) => l.segment === 'International');
  const localByVariety = useMemo(() => byVariety(localLines), [localLines]);
  const intlByVariety = useMemo(() => byVariety(intlLines), [intlLines]);

  // Filtered segment totals (respect the drill).
  const localTotal = localLines.reduce((s, l) => s + l.revenue, 0);
  const intlTotal = intlLines.reduce((s, l) => s + l.revenue, 0);
  const isFiltered = category !== 'all' || variety !== 'all';

  return (
    <div className="space-y-4">
      {/* Segment summary cards — each in its own currency. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          title="Local Sales (Philippines)"
          value={formatPHP(localTotal)}
          subtitle={`${data.localCount} local sale${data.localCount !== 1 ? 's' : ''}${isFiltered ? ' · filtered view' : ''}`}
          icon={MapPin}
          iconColor="text-leaf-600"
          iconBg="bg-leaf-50"
        />
        <StatCard
          title="International Sales"
          value={formatUSD(intlTotal)}
          subtitle={`${data.intlCount} international sale${data.intlCount !== 1 ? 's' : ''}${isFiltered ? ' · filtered view' : ''}`}
          icon={Globe2}
          iconColor="text-berry-600"
          iconBg="bg-berry-50"
        />
      </div>

      {/* Revenue by variety per segment, with a shared category → variety drill. */}
      <SectionCard
        title="Revenue by Variety — Local vs International"
        subtitle={
          category === 'all'
            ? 'PHP and USD shown separately (never combined)'
            : variety === 'all'
              ? `Varieties within ${category}`
              : `${category} — ${variety}`
        }
        actions={
          <div className="flex items-center gap-2">
            <select
              value={category}
              onChange={(e) => changeCategory(e.target.value)}
              aria-label="Filter by category"
              className="text-xs border border-primary-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <select
              value={variety}
              onChange={(e) => setVariety(e.target.value)}
              aria-label="Filter by variety"
              disabled={category === 'all' || varieties.length === 0}
              className="text-xs border border-primary-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <option value="all">All varieties</option>
              {varieties.map((v) => (<option key={v} value={v}>{v}</option>))}
            </select>
          </div>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SegmentChart title="Local (₱)" data={localByVariety} color={CHART_REVENUE} money={formatPHP} />
          <SegmentChart title="International ($)" data={intlByVariety} color={BRAND.berry} money={formatUSD} />
        </div>
      </SectionCard>
    </div>
  );
}

interface SegmentChartProps {
  title: string;
  data: { name: string; value: number }[];
  color: string;
  money: (n: number) => string;
}

function SegmentChart({ title, data, color, money }: SegmentChartProps) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-1">{title}</p>
      {data.length === 0 ? (
        <div className="h-52 flex items-center justify-center text-sm text-gray-400 text-center px-4">
          No sales in this view.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} tickFormatter={(v) => money(Number(v))} />
            <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={110} />
            <Tooltip
              formatter={(v) => money(Number(v))}
              cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
            />
            <Bar dataKey="value" name="Revenue" fill={color} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
