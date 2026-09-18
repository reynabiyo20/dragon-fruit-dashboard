/**
 * Executive Dashboard.
 *
 * A single, highly-visual command screen unifying financial performance, crop &
 * variety profitability, supply-chain / farm-partner mix, and real-time
 * operational signals — all narrowable by the slicer bar at the top.
 *
 * Sections:
 *   1. Executive Summary (high-level KPIs)
 *   2. Crop & Variety Profitability Matrix
 *   3. Supply Chain & Farm-Partner Mix
 *   4. Real-Time Operational Signals
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ArrowRight } from 'lucide-react';

import { PageHeader } from '../../components/ui/PageHeader';
import { formatNumber } from '../../utils/format';

import { DashboardSlicers } from './DashboardSlicers';
import { DEFAULT_FILTERS, type DashboardFilters } from './dashboardFilters';
import { useDashboardData } from './useDashboardData';
import { ExecutiveSummary } from './sections/ExecutiveSummary';
import { ProfitabilityMatrix } from './sections/ProfitabilityMatrix';
import { SupplyChainMix } from './sections/SupplyChainMix';
import { OperationalSignals } from './sections/OperationalSignals';

/** A lightweight titled band that separates the four dashboard sections. */
function SectionHeading({ index, title, subtitle }: { index: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary-700 text-white text-sm font-bold flex-shrink-0">
        {index}
      </span>
      <div>
        <h2 className="text-base font-bold text-primary-900 leading-tight">{title}</h2>
        <p className="text-xs text-gray-500 leading-tight">{subtitle}</p>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const data = useDashboardData(filters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Dashboard"
        subtitle={`Farm performance at a glance · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
      />

      {/* Interactive slicers — narrow every section at once */}
      <DashboardSlicers filters={filters} onChange={setFilters} years={data.years} />

      {/* ── 1. Operational Signals — daily blockers first, so action items are
             seen before the analysis below. ──────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading index={1} title="Operational Signals" subtitle="Green = good · Yellow = monitor · Red = action required" />
        <OperationalSignals signals={data.signals} />
      </section>

      {/* ── 2. Executive Summary — the headline financial & yield numbers. ─── */}
      <section className="space-y-3">
        <SectionHeading index={2} title="Executive Summary" subtitle="High-level financial & yield KPIs" />
        <ExecutiveSummary
          revenue={data.revenue}
          netProfit={data.netProfit}
          productionYieldKg={data.productionYieldKg}
          cultivatedHectares={data.cultivatedHectares}
          yieldPerHectare={data.yieldPerHectare}
          costToIncomePct={data.costToIncomePct}
        />
      </section>

      {/* ── 3. Crop & Variety Profitability ───────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading index={3} title="Crop & Variety Profitability" subtitle="Which varieties drive profit vs drain resources" />
        <ProfitabilityMatrix
          varietyProfit={data.varietyProfit}
          statusDistribution={data.cuttingStatusDistribution}
        />
      </section>

      {/* ── 4. Supply Chain & Partner Mix ─────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading index={4} title="Supply Chain & Partner Mix" subtitle="Procurement vs sales, pool sourcing, fulfillment & quality" />
        <SupplyChainMix
          procurementCost={data.procurementCost}
          salesEarned={data.salesEarned}
          poolMix={data.poolMix}
          fulfillment={data.fulfillment}
          quality={data.quality}
        />

        {/* Next harvest window callout — ties supply forecast to a concrete date */}
        {data.hasForecast && data.nextWindow && (
          <Link
            to="/wholesale-forecast"
            className="flex items-center justify-between gap-3 rounded-xl border border-primary-100 bg-primary-50/40 px-4 py-3 hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gold-50"><CalendarClock className="w-5 h-5 text-gold-600" /></div>
              <div>
                <p className="text-sm font-semibold text-primary-900">Next harvest window · {data.nextWindow.label}</p>
                <p className="text-xs text-gray-500">
                  {formatNumber(data.nextWindow.totalKg, 1)} kg projected to contract to wholesale customers
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 flex-shrink-0">
              Full forecast <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </Link>
        )}
      </section>
    </div>
  );
}
