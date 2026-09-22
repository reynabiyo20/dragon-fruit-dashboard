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
import { Wallet, DollarSign, TrendingUp, Scale, LandPlot, Gauge, Percent } from 'lucide-react';
import { StatCard } from '../../../components/ui/StatCard';
import { formatPHP, formatUSD, formatNumber } from '../../../utils/format';
import { formatHectares } from '../../../utils/area';

interface ExecutiveSummaryProps {
  revenue: number;
  /** International (USD) revenue — kept strictly separate from the PHP total, never converted. */
  revenueUSD: number;
  netProfit: number;
  /** International (USD) net profit — USD revenue − USD expenses (no USD payroll). */
  netProfitUSD: number;
  productionYieldKg: number;
  cultivatedHectares: number;
  yieldPerHectare: number;
  costToIncomePct: number;
}

export function ExecutiveSummary({
  revenue, revenueUSD, netProfit, netProfitUSD, productionYieldKg, cultivatedHectares, yieldPerHectare, costToIncomePct,
}: ExecutiveSummaryProps) {
  const hasArea = cultivatedHectares > 0;
  const hasCostRatio = revenue > 0;

  // Currency color-coding, following the brand theme:
  //   Peso (₱) KPIs  → plum/purple (primary)
  //   Dollar ($) KPIs → green (leaf)
  // A negative profit still turns its value red so the health signal isn't lost,
  // but the title + icon keep the currency color so ₱ vs $ stays obvious.
  const PESO = {
    title: 'text-primary-700', icon: 'text-primary-700', bg: 'bg-primary-100',
    surface: 'bg-primary-50 border-primary-200',
  } as const;
  const USD = {
    title: 'text-leaf-700', icon: 'text-leaf-700', bg: 'bg-leaf-100',
    surface: 'bg-leaf-50 border-leaf-200',
  } as const;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8 gap-4">
      <StatCard
        title="Total Revenue (₱)"
        value={formatPHP(revenue)}
        subtitle="Local (Philippine) sales"
        icon={Wallet}
        titleColor={PESO.title}
        valueColor="text-primary-800"
        iconColor={PESO.icon}
        iconBg={PESO.bg}
        surfaceClassName={PESO.surface}
      />
      <StatCard
        title="Total Revenue ($)"
        value={formatUSD(revenueUSD)}
        subtitle="International sales · not converted"
        icon={DollarSign}
        titleColor={USD.title}
        valueColor="text-leaf-700"
        iconColor={USD.icon}
        iconBg={USD.bg}
        surfaceClassName={USD.surface}
      />
      <StatCard
        title="Net Farm Profit (₱)"
        value={formatPHP(netProfit)}
        subtitle="Local revenue − expenses − payroll"
        icon={TrendingUp}
        titleColor={PESO.title}
        valueColor={netProfit >= 0 ? 'text-primary-800' : 'text-red-600'}
        iconColor={PESO.icon}
        iconBg={PESO.bg}
        surfaceClassName={PESO.surface}
      />
      <StatCard
        title="Net Farm Profit ($)"
        value={formatUSD(netProfitUSD)}
        subtitle="International revenue − expenses"
        icon={TrendingUp}
        titleColor={USD.title}
        valueColor={netProfitUSD >= 0 ? 'text-leaf-700' : 'text-red-600'}
        iconColor={USD.icon}
        iconBg={USD.bg}
        surfaceClassName={USD.surface}
      />
      <StatCard
        title="Production Yield"
        value={`${formatNumber(productionYieldKg, 1)} kg`}
        subtitle="Total harvested weight"
        icon={Scale}
        iconColor="text-gray-500"
        iconBg="bg-gray-100"
      />
      <StatCard
        title="Cultivated Area"
        value={hasArea ? formatHectares(cultivatedHectares) : '—'}
        subtitle={hasArea ? 'Active farm sections' : 'Set section areas in Farm Info'}
        icon={LandPlot}
        iconColor="text-gray-500"
        iconBg="bg-gray-100"
      />
      <StatCard
        title="Yield per Hectare"
        value={hasArea ? `${formatNumber(yieldPerHectare, 0)} kg/ha` : '—'}
        subtitle="Efficiency benchmark"
        icon={Gauge}
        iconColor="text-gray-500"
        iconBg="bg-gray-100"
      />
      <StatCard
        title="Cost-to-Income (₱)"
        value={hasCostRatio ? `${formatNumber(costToIncomePct, 0)}%` : '—'}
        subtitle="Local expenses + payroll ÷ local revenue"
        icon={Percent}
        titleColor={PESO.title}
        valueColor="text-primary-800"
        iconColor={PESO.icon}
        iconBg={PESO.bg}
        surfaceClassName={PESO.surface}
      />
    </div>
  );
}
