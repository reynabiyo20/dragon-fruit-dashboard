import { Link } from 'react-router-dom';
import {
  TrendingUp, Sprout, Handshake, Scale, PackageCheck, ShoppingCart,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { Table, type Column } from '../../components/ui/Table';
import { formatNumber, formatDate } from '../../utils/format';
import { useWholesaleForecast } from '../../hooks/useWholesaleForecast';
import { useNowTick } from '../../hooks/useNowTick';
import type { ForecastWindow } from '../../utils/forecast';

/** Format a kilogram figure consistently. */
function kg(value: number): string {
  return `${formatNumber(value, 1)} kg`;
}

export function WholesaleForecastPage() {
  // Recompute windows against the clock (off-season roll-forward is date-based).
  useNowTick(60_000);
  const { windows, totals, deploymentCount } = useWholesaleForecast();

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
      key: 'internal',
      header: 'Internal Farm Pool',
      accessor: (w) => (
        <div className="text-sm">
          <span className="font-medium text-emerald-700">{kg(w.internal.kg)}</span>
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
          <span className="font-medium text-blue-700">{kg(w.partner.kg)}</span>
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
        title="Wholesale Supply Forecast"
        subtitle="Projected fruit supply from deployed cuttings — for contracting to wholesale customers"
      />

      {/* How the forecast is fed */}
      <SectionCard>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-sm text-gray-600">
          <div className="flex items-start gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-50 flex-shrink-0"><Sprout className="w-4 h-4 text-emerald-600" /></div>
            <p>
              <span className="font-medium text-gray-800">Internal pool</span> counts batches marked
              <span className="font-medium"> Planted</span> in the Cuttings Store.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <div className="p-1.5 rounded-lg bg-blue-50 flex-shrink-0"><Handshake className="w-4 h-4 text-blue-600" /></div>
            <p>
              <span className="font-medium text-gray-800">Partner pool</span> counts cutting sales marked
              <span className="font-medium"> Delivered</span> in Sales.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* KPI summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Projected Supply" value={kg(totals.totalKg)} subtitle={`${formatNumber(totals.totalPieces, 0)} fruits across ${windows.length} window(s)`} icon={Scale} iconColor="text-gray-700" iconBg="bg-gray-100" />
        <StatCard title="Internal Farm Pool" value={kg(totals.internalKg)} subtitle="From planted batches" icon={Sprout} iconColor="text-emerald-600" iconBg="bg-emerald-50" />
        <StatCard title="Farm Partner Pool" value={kg(totals.partnerKg)} subtitle="From delivered cuttings" icon={Handshake} iconColor="text-blue-600" iconBg="bg-blue-50" />
        <StatCard
          title="Next Harvest Window"
          value={nextWindow ? nextWindow.label : '—'}
          subtitle={nextWindow ? `${kg(nextWindow.totalKg)} projected` : 'No deployments yet'}
          icon={TrendingUp}
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
        />
      </div>

      {windows.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="No supply forecast yet"
          description="Mark internal batches as Planted, or mark cutting sales as Delivered, to project future wholesale supply here."
          action={
            <Link to="/cuttings">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700">
                <Sprout className="w-4 h-4" /> Go to Cuttings Store
              </span>
            </Link>
          }
        />
      ) : (
        <SectionCard
          title="Projected Supply by Harvest Window"
          subtitle="Off-season harvests (Nov–Apr) roll forward to May (Early Season)"
        >
          <Table
            data={windows}
            columns={columns}
            keyExtractor={(w) => w.key}
            searchable={false}
            emptyMessage="No projected windows."
          />
        </SectionCard>
      )}

      {/* Contextual links */}
      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/cuttings" className="inline-flex items-center gap-1.5 text-green-700 hover:underline">
          <Sprout className="w-4 h-4" /> Cuttings Store
        </Link>
        <Link to="/sales" className="inline-flex items-center gap-1.5 text-green-700 hover:underline">
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
