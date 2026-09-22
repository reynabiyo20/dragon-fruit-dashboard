import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Sprout, Handshake, Scale, PackageCheck, ShoppingCart,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { Table, type Column } from '../../components/ui/Table';
import { PeriodFilter } from '../../components/ui/PeriodFilter';
import {
  type PeriodFilter as Period, ALL_PERIODS, availableYears, dateMatchesPeriod,
} from '../../utils/period';
import { formatNumber, formatDate } from '../../utils/format';
import { useWholesaleForecast } from '../../hooks/useWholesaleForecast';
import { useNowTick } from '../../hooks/useNowTick';
import type { ForecastWindow } from '../../utils/forecast';
import { BRAND } from '../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
} from '../../constants/chartTheme';

/** Format a kilogram figure consistently. */
function kg(value: number): string {
  return `${formatNumber(value, 1)} kg`;
}

export function WholesaleForecastPage() {
  // Recompute windows against the clock (off-season roll-forward is date-based).
  useNowTick(60_000);
  const { windows, totals, deploymentCount } = useWholesaleForecast();

  // ── Period filter (narrows the chart + table; KPIs stay all-time totals) ─────
  const [period, setPeriod] = useState<Period>(ALL_PERIODS);
  const years = useMemo(() => availableYears(windows.map((w) => w.date)), [windows]);
  const filteredWindows = useMemo(
    () => windows.filter((w) => dateMatchesPeriod(w.date, period)),
    [windows, period],
  );

  const columns: Column<ForecastWindow>[] = [
    {
      key: 'window',
      header: 'Harvest Window',
      accessor: (w) => (
        <div>
          <span className="font-medium text-gray-900">{w.label}</span>
          <p className="text-xs text-gray-400">~ {formatDate(w.date)}</p>
        </div>
      ),
      sortValue: (w) => w.key,
    },
    {
      key: 'farm',
      header: 'Farm Plants Pool',
      accessor: (w) => (
        <div className="text-sm">
          <span className="font-medium text-gold-700">{kg(w.farm.kg)}</span>
          <p className="text-xs text-gray-400">{formatNumber(w.farm.pieces, 0)} pcs · {formatNumber(w.farm.cuttings, 0)} plants</p>
        </div>
      ),
      sortValue: (w) => w.farm.kg,
    },
    {
      key: 'internal',
      header: 'Internal (Cuttings) Pool',
      accessor: (w) => (
        <div className="text-sm">
          <span className="font-medium text-leaf-700">{kg(w.internal.kg)}</span>
          <p className="text-xs text-gray-400">{formatNumber(w.internal.pieces, 0)} pcs · {formatNumber(w.internal.cuttings, 0)} cuttings</p>
        </div>
      ),
      sortValue: (w) => w.internal.kg,
    },
    {
      key: 'partner',
      header: 'Farm Partner Pool',
      accessor: (w) => (
        <div className="text-sm">
          <span className="font-medium text-berry-700">{kg(w.partner.kg)}</span>
          <p className="text-xs text-gray-400">{formatNumber(w.partner.pieces, 0)} pcs · {formatNumber(w.partner.cuttings, 0)} cuttings</p>
        </div>
      ),
      sortValue: (w) => w.partner.kg,
    },
    {
      key: 'total',
      header: 'Total Combined Supply',
      accessor: (w) => (
        <div className="text-sm">
          <span className="font-bold text-gray-900">{kg(w.totalKg)}</span>
          <p className="text-xs text-gray-400">{formatNumber(w.totalPieces, 0)} pcs total</p>
        </div>
      ),
      sortValue: (w) => w.totalKg,
    },
  ];

  const nextWindow = windows[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dragon Fruit Supply Forecast"
        subtitle="Projected fruit supply from deployed cuttings — for contracting to wholesale customers"
      />

      {windows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter value={period} onChange={setPeriod} years={years} />
        </div>
      )}

      {/* How the forecast is fed */}
      <SectionCard>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-sm text-gray-600">
          <div className="flex items-start gap-2">
            <div className="p-1.5 rounded-lg bg-leaf-50 flex-shrink-0"><Sprout className="w-4 h-4 text-leaf-600" /></div>
            <p>
              <span className="font-medium text-gray-800">Internal pool</span> counts batches marked
              <span className="font-medium"> Planted</span> in Propagation.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <div className="p-1.5 rounded-lg bg-berry-50 flex-shrink-0"><Handshake className="w-4 h-4 text-berry-600" /></div>
            <p>
              <span className="font-medium text-gray-800">Partner pool</span> counts cutting sales marked
              <span className="font-medium"> Delivered</span> in Sales.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <div className="p-1.5 rounded-lg bg-gold-50 flex-shrink-0"><Sprout className="w-4 h-4 text-gold-600" /></div>
            <p>
              <span className="font-medium text-gray-800">Farm pool</span> counts standing plants recorded in
              <span className="font-medium"> Farm Information</span>.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* KPI summary */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard title="Total Projected Supply" value={kg(totals.totalKg)} subtitle={`${formatNumber(totals.totalPieces, 0)} fruits across ${windows.length} window(s)`} icon={Scale} iconColor="text-primary-700" iconBg="bg-primary-50" />
        <StatCard title="Farm Plants Pool" value={kg(totals.farmKg)} subtitle="From standing plants" icon={Sprout} iconColor="text-gold-600" iconBg="bg-gold-50" />
        <StatCard title="Internal (Cuttings) Pool" value={kg(totals.internalKg)} subtitle="From planted batches" icon={Sprout} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
        <StatCard title="Farm Partner Pool" value={kg(totals.partnerKg)} subtitle="From delivered cuttings" icon={Handshake} iconColor="text-berry-600" iconBg="bg-berry-50" />
        <StatCard
          title="Next Harvest Window"
          value={nextWindow ? nextWindow.label : '—'}
          subtitle={nextWindow ? `${kg(nextWindow.totalKg)} projected` : 'No deployments yet'}
          icon={TrendingUp}
          iconColor="text-gold-600"
          iconBg="bg-gold-50"
        />
      </div>

      {windows.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="No supply forecast yet"
          description="Mark internal batches as Planted, or mark cutting sales as Delivered, to project future wholesale supply here."
          action={
            <Link to="/cuttings">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700">
                <Sprout className="w-4 h-4" /> Go to Propagation
              </span>
            </Link>
          }
        />
      ) : filteredWindows.length === 0 ? (
        <SectionCard title="Projected Supply Over Time">
          <div className="h-48 flex items-center justify-center text-sm text-gray-400">
            No windows in the selected period.
          </div>
        </SectionCard>
      ) : (
        <>
          {/* Projected supply over time — internal vs partner, stacked */}
          <SectionCard
            title="Projected Supply Over Time"
            subtitle="Kilograms per harvest window — internal farm pool vs farm partners"
          >
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={filteredWindows.map((w) => ({
                  label: w.label,
                  farm: Number(w.farm.kg.toFixed(1)),
                  internal: Number(w.internal.kg.toFixed(1)),
                  partner: Number(w.partner.kg.toFixed(1)),
                }))}
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="farmGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND.gold} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={BRAND.gold} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="internalGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND.leaf} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={BRAND.leaf} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="partnerGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND.berry} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={BRAND.berry} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `${v}kg`} />
                <Tooltip
                  formatter={(v, name) => [`${formatNumber(Number(v), 1)} kg`, name === 'farm' ? 'Farm plants' : name === 'internal' ? 'Internal' : 'Partner']}
                  cursor={{ stroke: '#dcbcd6', strokeWidth: 1 }}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                />
                <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                <Area type="monotone" dataKey="farm" name="Farm Plants Pool" stackId="1" stroke={BRAND.gold} strokeWidth={2} fill="url(#farmGrad)" />
                <Area type="monotone" dataKey="internal" name="Internal (Cuttings) Pool" stackId="1" stroke={BRAND.leaf} strokeWidth={2} fill="url(#internalGrad)" />
                <Area type="monotone" dataKey="partner" name="Farm Partner Pool" stackId="1" stroke={BRAND.berry} strokeWidth={2} fill="url(#partnerGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </SectionCard>

          <SectionCard
            title="Projected Supply by Harvest Window"
            subtitle="Off-season harvests (Nov–Apr) roll forward to May (Early Season)"
          >
            <Table
              data={filteredWindows}
              columns={columns}
              keyExtractor={(w) => w.key}
              searchable={false}
              emptyMessage="No projected windows."
              persistKey="wholesale-forecast"
              defaultSort={{ key: 'window', dir: 'asc' }}
            />
          </SectionCard>
        </>
      )}

      {/* Contextual links */}
      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/cuttings" className="inline-flex items-center gap-1.5 text-primary-700 hover:underline">
          <Sprout className="w-4 h-4" /> Propagation
        </Link>
        <Link to="/sales" className="inline-flex items-center gap-1.5 text-primary-700 hover:underline">
          <ShoppingCart className="w-4 h-4" /> Sales
        </Link>
      </div>

      <p className="text-xs text-gray-400">
        Based on {formatNumber(deploymentCount, 0)} deployed batch line(s). Projections use average yield
        tiers per cutting type and are estimates — actual harvest weight will vary with growing conditions.
      </p>
    </div>
  );
}
