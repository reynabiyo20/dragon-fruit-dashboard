/**
 * useDashboardData — the single aggregation hook powering the executive dashboard.
 *
 * It pulls every store, applies the active slicers to the sale-driven metrics,
 * and returns the derived numbers for all four dashboard sections:
 *   1. Executive summary KPIs
 *   2. Crop & variety profitability matrix
 *   3. Supply chain & farm-partner mix
 *   4. Real-time operational signals (alert flags)
 *
 * Where the app tracks no data (region, on-time delivery, per-item freshness),
 * we compute the closest honest proxy and label it as such in the UI.
 */
import { useMemo } from 'react';
import { differenceInDays, parseISO } from 'date-fns';

import { useSaleStore } from '../../store/saleStore';
import { useExpenseStore } from '../../store/expenseStore';
import { usePayrollStore } from '../../store/payrollStore';
import { useProductStore } from '../../store/productStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useProductionStore } from '../../store/productionStore';
import { useCuttingStore } from '../../store/cuttingStore';
import { useFarmStore } from '../../store/farmStore';
import { useWholesaleForecast } from '../../hooks/useWholesaleForecast';

import { totalHectares } from '../../utils/area';
import { CUTTINGS_PRODUCT_TYPE, LOW_STOCK_THRESHOLD } from '../../constants';
import { estimateHarvestWindow, isInHarvestWindow } from '../../utils/date';
import {
  type DashboardFilters,
  saleMatchesSeason, saleMatchesChannel, saleMatchesFulfillment, saleMatchesPeriod,
} from './dashboardFilters';
import { availableYears } from '../../utils/period';

export type AlertLevel = 'good' | 'warn' | 'action';

export interface AlertSignal {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  /** Optional route to act on the alert. */
  to?: string;
}

export interface VarietyProfit {
  variety: string;
  revenue: number;
  cost: number;      // COGS: units sold × product cost
  profit: number;    // revenue − cost
  marginPct: number; // profit / revenue × 100
}

export function useDashboardData(filters: DashboardFilters) {
  const { sales } = useSaleStore();
  const { totalExpenses } = useExpenseStore();
  const { totalPayroll } = usePayrollStore();
  const { products } = useProductStore();
  const { items: inventoryItems, lowStockItems } = useInventoryStore();
  const {
    entries: productionEntries,
    totalGoodFruits, totalDamaged, totalHarvested, totalWeightKg,
  } = useProductionStore();
  const { batches: cuttingBatches } = useCuttingStore();
  const { sections: farmSections } = useFarmStore();
  const forecast = useWholesaleForecast();

  // Fast product lookup for cost/category joins.
  const productById = useMemo(() => {
    const m = new Map<string, (typeof products)[number]>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  // ── Filtered sales (slicers only affect sale-derived metrics) ────────────────
  const filteredSales = useMemo(
    () => sales.filter((s) =>
      saleMatchesSeason(s, filters.season) &&
      saleMatchesChannel(s, filters.channel) &&
      saleMatchesFulfillment(s, filters.fulfillment) &&
      saleMatchesPeriod(s, filters.period) &&
      matchesCategory(s, productById, filters.category),
    ),
    [sales, productById, filters.season, filters.channel, filters.fulfillment, filters.period, filters.category],
  );

  // Years present in the data, for the period-filter dropdown.
  const years = useMemo(() => availableYears(sales.map((s) => s.date)), [sales]);

  // ── SECTION 1: Executive summary ─────────────────────────────────────────────
  const revenue = useMemo(() => filteredSales.reduce((s, r) => s + r.subtotal, 0), [filteredSales]);
  // Expenses & payroll are farm-wide (not sale-scoped), so they're unfiltered.
  const totalExp = totalExpenses();
  const totalPay = totalPayroll();
  const netProfit = revenue - totalExp - totalPay;

  const productionYieldKg = totalWeightKg();
  const cultivatedHectares = useMemo(() => totalHectares(farmSections), [farmSections]);
  const yieldPerHectare = cultivatedHectares > 0 ? productionYieldKg / cultivatedHectares : 0;

  // Expense-to-Income (cost-to-revenue) ratio. The app tracks no true debt, so
  // this is the honest operating-cost health metric: total outflow ÷ revenue.
  // < 100% means revenue covers costs. Uses filtered revenue vs farm-wide costs.
  const costToIncomePct = revenue > 0 ? ((totalExp + totalPay) / revenue) * 100 : 0;

  // ── SECTION 2: Crop & variety profitability ──────────────────────────────────
  const varietyProfit = useMemo<VarietyProfit[]>(() => {
    const map = new Map<string, { revenue: number; cost: number }>();
    filteredSales.forEach((sale) => {
      sale.items.forEach((item) => {
        const product = productById.get(item.productId);
        // When a product-category slicer is active, only aggregate the line items
        // that actually belong to it — otherwise a mixed-basket sale (e.g. Fruit +
        // Cuttings) would leak its other-category lines into the filtered view.
        if (filters.category !== 'all' && product?.category !== filters.category) return;
        const variety = product?.subcategory || item.productName || 'Unknown';
        const unitCost = product?.costPHP ?? 0;
        const row = map.get(variety) ?? { revenue: 0, cost: 0 };
        row.revenue += item.total;
        row.cost += unitCost * (Number(item.quantity) || 0);
        map.set(variety, row);
      });
    });
    return Array.from(map.entries())
      .map(([variety, d]) => {
        const profit = d.revenue - d.cost;
        return {
          variety,
          revenue: d.revenue,
          cost: d.cost,
          profit,
          marginPct: d.revenue > 0 ? (profit / d.revenue) * 100 : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [filteredSales, productById, filters.category]);

  // Cutting-batch status distribution (Growing / Callusing / Ready / Sold …).
  const cuttingStatusDistribution = useMemo(() => {
    const map = new Map<string, number>();
    cuttingBatches.forEach((b) => {
      const qty = b.quantitySourced || 0;
      map.set(b.status, (map.get(b.status) ?? 0) + qty);
    });
    return Array.from(map.entries())
      .map(([status, quantity]) => ({ status, quantity }))
      .filter((d) => d.quantity > 0);
  }, [cuttingBatches]);

  // ── SECTION 3: Supply chain & partner mix ────────────────────────────────────
  // Procurement (what we spend) vs sales (what we earn).
  const procurementCost = totalExp;
  const salesEarned = revenue;

  // Internal farm pool vs farm-partner pool (projected supply, kg).
  const poolMix = {
    internalKg: forecast.totals.internalKg,
    partnerKg: forecast.totals.partnerKg,
    totalKg: forecast.totals.totalKg,
  };

  // Fulfillment performance — PROXY for on-time delivery (no zone/ETA tracked):
  // share of cutting-delivery-eligible sales actually marked delivered, plus the
  // paid/collected ratio. Uses the FULL sales set (not slicer-filtered) so the
  // headline fulfillment health is stable.
  const fulfillment = useMemo(() => {
    const deliverable = sales.filter((s) => hasCuttingLine(s, productById));
    const delivered = deliverable.filter((s) => s.delivered).length;
    const paidCount = sales.filter((s) => s.paid).length;
    // Average lead time (days) between sale date and delivery, for delivered sales.
    const leadTimes = deliverable
      .filter((s) => s.delivered && s.deliveredDate && s.date)
      .map((s) => {
        try { return differenceInDays(parseISO(s.deliveredDate!), parseISO(s.date)); }
        catch { return 0; }
      })
      .filter((d) => d >= 0);
    const avgLeadDays = leadTimes.length
      ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
      : 0;
    return {
      deliveredPct: deliverable.length ? (delivered / deliverable.length) * 100 : 0,
      deliveredCount: delivered,
      deliverableCount: deliverable.length,
      paidPct: sales.length ? (paidCount / sales.length) * 100 : 0,
      avgLeadDays,
    };
  }, [sales, productById]);

  // Freshness & quality — PROXY from production good/damaged ratio (no per-batch
  // freshness field exists). Higher good-fruit share = better quality score.
  const quality = useMemo(() => {
    const harvested = totalHarvested();
    const good = totalGoodFruits();
    const damaged = totalDamaged();
    return {
      score: harvested > 0 ? (good / harvested) * 100 : 0,
      good,
      damaged,
      harvested,
    };
  }, [totalHarvested, totalGoodFruits, totalDamaged, productionEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SECTION 4: Real-time operational signals ─────────────────────────────────
  // Thresholds are context-aware rather than fixed counts: receivables escalate
  // on the SHARE of revenue outstanding, stock on out-of-stock severity, harvest
  // on due-now vs coming-this-week, and quality on damage rate gated by sample
  // size so a single early harvest can't trip a red flag.
  const signals = useMemo<AlertSignal[]>(() => {
    const out: AlertSignal[] = [];
    const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;
    const now = new Date();

    // (a) Harvest timelines — distinguish "due now" (in window) from "coming
    //     within 7 days" so staff can prep, not just react.
    let dueNow = 0;
    let comingSoon = 0;
    productionEntries.forEach((e) => {
      const w = estimateHarvestWindow(e.floweringDate);
      if (!w) return;
      if (isInHarvestWindow(w, now)) { dueNow += 1; return; }
      try {
        const days = differenceInDays(parseISO(w.date), now);
        if (days >= 0 && days <= 7) comingSoon += 1;
      } catch { /* ignore unparseable */ }
    });
    out.push(
      dueNow > 0
        ? { id: 'harvest', level: 'action', title: 'Harvest window open', detail: `${dueNow} plot(s) ready to pick now${comingSoon ? ` · ${comingSoon} more within 7 days` : ''}`, to: '/production' }
        : comingSoon > 0
          ? { id: 'harvest', level: 'warn', title: 'Harvest approaching', detail: `${comingSoon} plot(s) due within 7 days`, to: '/production' }
          : { id: 'harvest', level: 'good', title: 'Harvest timelines', detail: 'No plots due this week', to: '/production' },
    );

    // (b) Low stock — severity-aware: fully out-of-stock (endingQty <= 0) is an
    //     action item; merely low is a monitor. A depleted item outranks count.
    const lowItems = lowStockItems(LOW_STOCK_THRESHOLD);
    const outOfStock = lowItems.filter((i) => i.endingQty <= 0).length;
    const runningLow = lowItems.length - outOfStock;
    out.push(
      lowItems.length === 0
        ? { id: 'stock', level: 'good', title: 'Inventory levels', detail: 'All tracked items above threshold', to: '/inventory' }
        : outOfStock > 0
          ? { id: 'stock', level: 'action', title: 'Out of stock', detail: `${outOfStock} item(s) depleted${runningLow ? ` · ${runningLow} running low` : ''}`, to: '/inventory' }
          : { id: 'stock', level: 'warn', title: 'Low stock', detail: `${runningLow} item(s) running low`, to: '/inventory' },
    );

    // (c) Receivables — escalate on the SHARE of total revenue outstanding, not a
    //     raw count. >25% of revenue uncollected = action; any unpaid = monitor.
    const unpaid = sales.filter((s) => !s.paid);
    const unpaidTotal = unpaid.reduce((sum, s) => sum + s.subtotal, 0);
    const companyRevenue = sales.reduce((sum, s) => sum + s.subtotal, 0);
    const unpaidShare = companyRevenue > 0 ? (unpaidTotal / companyRevenue) * 100 : 0;
    out.push(
      unpaid.length === 0
        ? { id: 'receivables', level: 'good', title: 'Receivables', detail: 'No outstanding invoices', to: '/sales' }
        : unpaidShare > 25
          ? { id: 'receivables', level: 'action', title: 'Receivables', detail: `${peso(unpaidTotal)} unpaid · ${unpaidShare.toFixed(0)}% of revenue`, to: '/sales' }
          : { id: 'receivables', level: 'warn', title: 'Receivables', detail: `${unpaid.length} unpaid · ${peso(unpaidTotal)}`, to: '/sales' },
    );

    // (d) Crop quality — damage-rate bands, but gated by sample size: with fewer
    //     than 20 fruits harvested the reading isn't trustworthy, so it stays a
    //     monitor at most rather than firing a red flag off one bad pick.
    const harvested = totalHarvested();
    const damageRate = harvested > 0 ? (totalDamaged() / harvested) * 100 : 0;
    const smallSample = harvested > 0 && harvested < 20;
    out.push(
      harvested === 0
        ? { id: 'quality', level: 'good', title: 'Crop quality', detail: 'No harvest data yet', to: '/production' }
        : damageRate <= 10
          ? { id: 'quality', level: 'good', title: 'Crop quality', detail: `${damageRate.toFixed(1)}% damage rate`, to: '/production' }
          : damageRate <= 20 || smallSample
            ? { id: 'quality', level: 'warn', title: 'Crop quality', detail: `${damageRate.toFixed(1)}% damage${smallSample ? ' · small sample' : ' — monitor'}`, to: '/production' }
            : { id: 'quality', level: 'action', title: 'Crop quality', detail: `${damageRate.toFixed(1)}% damage — action needed`, to: '/production' },
    );

    return out;
  }, [productionEntries, lowStockItems, sales, totalHarvested, totalDamaged]);

  return {
    // section 1
    revenue, totalExp, totalPay, netProfit,
    productionYieldKg, cultivatedHectares, yieldPerHectare, costToIncomePct,
    years,
    // section 2
    varietyProfit, cuttingStatusDistribution,
    // section 3
    procurementCost, salesEarned, poolMix, fulfillment, quality,
    // section 4
    signals,
    // meta
    filteredSaleCount: filteredSales.length,
    totalSaleCount: sales.length,
    hasForecast: forecast.windows.length > 0,
    nextWindow: forecast.windows[0],
    inventoryCount: inventoryItems.length,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────
function hasCuttingLine(
  sale: { items: { productId: string }[] },
  productById: Map<string, { category: string }>,
): boolean {
  return sale.items.some((it) => productById.get(it.productId)?.category === CUTTINGS_PRODUCT_TYPE);
}

/** Does any line item on the sale belong to the given product category? */
function matchesCategory(
  sale: { items: { productId: string }[] },
  productById: Map<string, { category: string }>,
  category: string,
): boolean {
  if (category === 'all') return true;
  return sale.items.some((it) => productById.get(it.productId)?.category === category);
}
