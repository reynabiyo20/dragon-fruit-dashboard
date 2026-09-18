/**
 * Section 1 — Executive Summary (high-level KPIs).
 *
 * Revenue, Net Farm Profit, Total Production Yield, Total Cultivated Area, and
 * the definitive efficiency benchmark: Yield per Hectare.
 *
 * Note: "Yield per Acre" from the brief is expressed here as Yield per Hectare,
 * because farm sections are stored in mixed units (Sqm/Hectare/Acre) that we
 * normalize to hectares — the common agricultural unit for this operation.
 */
import { Wallet, TrendingUp, Scale, LandPlot, Gauge, Percent } from 'lucide-react';
import { StatCard } from '../../../components/ui/StatCard';
import { formatPHP, formatNumber } from '../../../utils/format';
import { formatHectares } from '../../../utils/area';

interface ExecutiveSummaryProps {
  revenue: number;
  netProfit: number;
  productionYieldKg: number;
  cultivatedHectares: number;
  yieldPerHectare: number;
  costToIncomePct: number;
}

export function ExecutiveSummary({
  revenue, netProfit, productionYieldKg, cultivatedHectares, yieldPerHectare, costToIncomePct,
}: ExecutiveSummaryProps) {
  const profitPositive = netProfit >= 0;
  const hasArea = cultivatedHectares > 0;
  // Under 100% means revenue covers costs → healthy (leaf); over → red.
  const costHealthy = costToIncomePct > 0 && costToIncomePct <= 100;
  const hasCostRatio = revenue > 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <StatCard
        title="Total Revenue"
        value={formatPHP(revenue)}
        icon={Wallet}
        iconColor="text-leaf-600"
        iconBg="bg-leaf-50"
      />
      <StatCard
        title="Net Farm Profit"
        value={formatPHP(netProfit)}
        subtitle="Revenue − expenses − payroll"
        icon={TrendingUp}
        iconColor={profitPositive ? 'text-leaf-600' : 'text-red-500'}
        iconBg={profitPositive ? 'bg-leaf-50' : 'bg-red-50'}
      />
      <StatCard
        title="Production Yield"
        value={`${formatNumber(productionYieldKg, 1)} kg`}
        subtitle="Total harvested weight"
        icon={Scale}
        iconColor="text-primary-600"
        iconBg="bg-primary-50"
      />
      <StatCard
        title="Cultivated Area"
        value={hasArea ? formatHectares(cultivatedHectares) : '—'}
        subtitle={hasArea ? 'Active farm sections' : 'Set section areas in Farm Info'}
        icon={LandPlot}
        iconColor="text-berry-600"
        iconBg="bg-berry-50"
      />
      <StatCard
        title="Yield per Hectare"
        value={hasArea ? `${formatNumber(yieldPerHectare, 0)} kg/ha` : '—'}
        subtitle="Efficiency benchmark"
        icon={Gauge}
        iconColor="text-gold-600"
        iconBg="bg-gold-50"
      />
      <StatCard
        title="Cost-to-Income"
        value={hasCostRatio ? `${formatNumber(costToIncomePct, 0)}%` : '—'}
        subtitle="Expenses + payroll ÷ revenue"
        icon={Percent}
        iconColor={costHealthy ? 'text-leaf-600' : 'text-red-500'}
        iconBg={costHealthy ? 'bg-leaf-50' : 'bg-red-50'}
      />
    </div>
  );
}
