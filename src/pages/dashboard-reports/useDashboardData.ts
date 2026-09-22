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
import { differenceInDays, parseISO, format, startOfMonth } from 'date-fns';

import { useSaleStore } from '../../store/saleStore';
import { useExpenseStore } from '../../store/expenseStore';
import { useCustomerStore } from '../../store/customerStore';
import { useVendorStore } from '../../store/vendorStore';
import { usePayrollStore } from '../../store/payrollStore';
import { useProductStore } from '../../store/productStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useProductionStore } from '../../store/productionStore';
import { useCuttingStore } from '../../store/cuttingStore';
import { useFarmStore } from '../../store/farmStore';
import { useWholesaleForecast } from '../../hooks/useWholesaleForecast';

import { totalHectares } from '../../utils/area';
import { computeCuttingPackingStatus } from '../../utils/cuttingPacking';
import { CUTTINGS_PRODUCT_TYPE, LOW_STOCK_THRESHOLD, PAYABLES_ALERT_THRESHOLD } from '../../constants';
import { regionOf, countryOf, PHILIPPINES } from '../../constants/geography';
import {
  UNSPECIFIED_LOCATION,
  localPerformanceByLocation, countryPerformance, rollUpToProvince, rollUpToRegion,
  type LocationPerformance, type CountryPerformance,
} from './locationAggregation';
import type { Currency } from '../../types';
import { sectionHarvestWindow, isInHarvestWindow } from '../../utils/date';
import {
  type DashboardFilters,
  saleMatchesSeason, saleMatchesChannel, saleMatchesFulfillment, saleMatchesPeriod,
} from './dashboardFilters';
import { availableYears } from '../../utils/period';

/** One month's profit-and-loss row for the P&L Summary Table. */
export interface MonthlyPnL {
  month: string;    // "MMM yyyy"
  revenue: number;
  expenses: number;
  payroll: number;
  profit: number;   // revenue − expenses − payroll
}

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

/** One slice of an expense breakdown (by classification or by cost behavior). */
export interface ExpenseBreakdownSlice {
  label: string;
  amount: number;
  pct: number; // share of total expenses
}

/**
 * Financial performance rolled up to one geographic location. `sales` comes
 * from customers in that province/municipality; `expenses` from vendors there.
 * `municipality === ''` denotes a province-level subtotal row.
 */
/** Count of farm-partner customers in one province. */
export interface FarmPartnerLocationSlice {
  province: string;
  region: string;
  count: number;
}

/** One flattened sale line for the International-vs-Local breakdown. */
export interface IntlVsLocalLine {
  segment: 'Local' | 'International';
  currency: Currency;
  country: string;
  category: string;
  variety: string;
  revenue: number;
}

/** International-vs-Local sales split. PHP (local) and USD (international) totals
 *  are kept separate — never summed. `lines` is every sale line for drilling. */
export interface IntlVsLocal {
  localTotal: number;   // PHP
  intlTotal: number;    // USD
  localCount: number;
  intlCount: number;
  lines: IntlVsLocalLine[];
}

// Location performance types + pure rollups live in locationAggregation.ts so
// they're unit-testable; re-export the types for existing consumers.
export type { LocationPerformance, CountryPerformance };

export function useDashboardData(filters: DashboardFilters) {
  const { sales } = useSaleStore();
  const { expenses, totalExpenses, totalByAccountingClassification, totalByExpenseType } = useExpenseStore();
  const { customers } = useCustomerStore();
  const { vendors } = useVendorStore();
  const {
    entries: payrollEntries, totalPayroll,
    totalByLaborType, totalByAccountingClassification: payrollByClassification,
  } = usePayrollStore();
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
  // Headline revenue is PHP (local) only — PHP and USD are never summed. The
  // international (USD) side is reported separately (see internationalVsLocal).
  const revenue = useMemo(
    () => filteredSales.filter((r) => (r.currency ?? 'PHP') === 'PHP').reduce((s, r) => s + r.subtotal, 0),
    [filteredSales],
  );
  const revenueUSD = useMemo(
    () => filteredSales.filter((r) => (r.currency ?? 'PHP') === 'USD').reduce((s, r) => s + r.subtotal, 0),
    [filteredSales],
  );
  // Expenses & payroll are farm-wide (not sale-scoped), so they're unfiltered.
  const totalExp = totalExpenses();
  const totalPay = totalPayroll();
  // Currency-split expenses so profit never mixes ₱ and $ (payroll is ₱-only).
  const expensesPHP = useMemo(
    () => expenses.filter((e) => (e.currency ?? 'PHP') === 'PHP').reduce((s, e) => s + e.amount, 0),
    [expenses],
  );
  const expensesUSD = useMemo(
    () => expenses.filter((e) => (e.currency ?? 'PHP') === 'USD').reduce((s, e) => s + e.amount, 0),
    [expenses],
  );
  // Payables = money still OWED, i.e. the UNPAID portion only. This mirrors the
  // Expenses page "Pending" split (total − paid) and payroll's unpaid entries, so
  // the dashboard payables flag stays in sync with what those pages report as
  // outstanding. Paid-out expenses/wages are settled and are NOT payables.
  const unpaidExpensesPHP = useMemo(
    () =>
      expenses
        .filter((e) => (e.currency ?? 'PHP') === 'PHP' && !e.paid)
        .reduce((s, e) => s + e.amount, 0),
    [expenses],
  );
  const unpaidExpensesUSD = useMemo(
    () =>
      expenses
        .filter((e) => (e.currency ?? 'PHP') === 'USD' && !e.paid)
        .reduce((s, e) => s + e.amount, 0),
    [expenses],
  );
  const unpaidPayrollPHP = useMemo(
    () => payrollEntries.filter((e) => !e.paid).reduce((s, e) => s + e.netPay, 0),
    [payrollEntries],
  );
  // Net Farm Profit, per currency. PHP: local revenue − local expenses − payroll.
  // USD: international revenue − international expenses (no USD payroll).
  const netProfit = revenue - expensesPHP - totalPay;
  const netProfitUSD = revenueUSD - expensesUSD;

  const productionYieldKg = totalWeightKg();
  const cultivatedHectares = useMemo(() => totalHectares(farmSections), [farmSections]);
  const yieldPerHectare = cultivatedHectares > 0 ? productionYieldKg / cultivatedHectares : 0;

  // Expense-to-Income (cost-to-revenue) ratio, PESO only. The app tracks no true
  // debt, so this is the honest operating-cost health metric: local outflow ÷
  // local revenue. < 100% means revenue covers costs.
  const costToIncomePct = revenue > 0 ? ((expensesPHP + totalPay) / revenue) * 100 : 0;

  // ── P&L Summary — monthly revenue / expenses / payroll / profit ──────────────
  // Farm-wide (not slicer-scoped) so the summary always reflects the full book.
  // Sales, expenses, and payroll are bucketed by their own month, and PHP and USD
  // are kept STRICTLY SEPARATE (never summed/converted). Payroll is local wages
  // only, so it lands solely in the PHP series; USD has no payroll row.
  const buildMonthlyPnL = (currency: Currency): MonthlyPnL[] => {
    const map = new Map<string, { revenue: number; expenses: number; payroll: number }>();
    const getOrCreate = (month: string) => {
      let row = map.get(month);
      if (!row) { row = { revenue: 0, expenses: 0, payroll: 0 }; map.set(month, row); }
      return row;
    };
    const monthOf = (iso: string): string | null => {
      try { return format(startOfMonth(parseISO(iso)), 'MMM yyyy'); } catch { return null; }
    };
    sales.forEach((s) => {
      if (!s.date || (s.currency ?? 'PHP') !== currency) return;
      const m = monthOf(s.date); if (m) getOrCreate(m).revenue += s.subtotal;
    });
    expenses.forEach((e) => {
      if (!e.date || (e.currency ?? 'PHP') !== currency) return;
      const m = monthOf(e.date); if (m) getOrCreate(m).expenses += e.amount;
    });
    // Payroll is PHP-only.
    if (currency === 'PHP') {
      payrollEntries.forEach((p) => {
        if (!p.payPeriodStart) return;
        const m = monthOf(p.payPeriodStart); if (m) getOrCreate(m).payroll += p.netPay;
      });
    }
    return Array.from(map.entries())
      .map(([month, d]) => ({ month, ...d, profit: d.revenue - d.expenses - d.payroll }))
      .sort((a, b) => {
        try { return parseISO(`01 ${a.month}`).getTime() - parseISO(`01 ${b.month}`).getTime(); }
        catch { return 0; }
      });
  };

  const monthlyPnLPHP = useMemo(() => buildMonthlyPnL('PHP'), [sales, expenses, payrollEntries]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthlyPnLUSD = useMemo(() => buildMonthlyPnL('USD'), [sales, expenses]); // eslint-disable-line react-hooks/exhaustive-deps

  // P&L grand totals per currency (farm-wide). USD carries no payroll.
  const sumRevenue = (cur: Currency) => sales.filter((s) => (s.currency ?? 'PHP') === cur).reduce((sum, r) => sum + r.subtotal, 0);
  const sumExpenses = (cur: Currency) => expenses.filter((e) => (e.currency ?? 'PHP') === cur).reduce((sum, e) => sum + e.amount, 0);

  const pnlRevenuePHP = useMemo(() => sumRevenue('PHP'), [sales]); // eslint-disable-line react-hooks/exhaustive-deps
  const pnlExpensesPHP = useMemo(() => sumExpenses('PHP'), [expenses]); // eslint-disable-line react-hooks/exhaustive-deps
  const pnlRevenueUSD = useMemo(() => sumRevenue('USD'), [sales]); // eslint-disable-line react-hooks/exhaustive-deps
  const pnlExpensesUSD = useMemo(() => sumExpenses('USD'), [expenses]); // eslint-disable-line react-hooks/exhaustive-deps

  const pnlNetProfitPHP = pnlRevenuePHP - pnlExpensesPHP - totalPay;
  const pnlMarginPHP = pnlRevenuePHP > 0 ? (pnlNetProfitPHP / pnlRevenuePHP) * 100 : 0;
  const pnlNetProfitUSD = pnlRevenueUSD - pnlExpensesUSD;
  const pnlMarginUSD = pnlRevenueUSD > 0 ? (pnlNetProfitUSD / pnlRevenueUSD) * 100 : 0;

  const hasUsdPnL = monthlyPnLUSD.length > 0;

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

  // Standing farm plants vs internal cuttings vs farm-partner pool (projected kg).
  const poolMix = {
    farmKg: forecast.totals.farmKg,
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

  // ── Expense bookkeeping breakdowns ───────────────────────────────────────────
  // Grouped from the bookkeeping attributes now carried on each expense:
  // accounting classification (CapEx / OpEx / COGS …) and cost behavior
  // (Fixed / Variable / Semi-Variable). Farm-wide, so not slicer-scoped — they
  // recompute only when the expenses list changes.
  const toBreakdown = (totals: Record<string, number>): ExpenseBreakdownSlice[] => {
    const grand = Object.values(totals).reduce((s, v) => s + v, 0);
    return Object.entries(totals)
      .map(([label, amount]) => ({ label, amount, pct: grand > 0 ? (amount / grand) * 100 : 0 }))
      .filter((s) => s.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  };
  const expenseByClassification = useMemo(
    () => toBreakdown(totalByAccountingClassification()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses],
  );
  const expenseByType = useMemo(
    () => toBreakdown(totalByExpenseType()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses],
  );

  // ── Payroll bookkeeping breakdowns (labor) ───────────────────────────────────
  // From the labor attributes snapshotted onto each payroll entry: labor type
  // (Direct / Indirect / Selling / Administrative) and accounting classification
  // (COGS vs OpEx variants — the SAME buckets expenses use).
  const payrollByLaborType = useMemo(
    () => toBreakdown(totalByLaborType()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payrollEntries],
  );
  const payrollByClassificationSlices = useMemo(
    () => toBreakdown(payrollByClassification()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payrollEntries],
  );

  // ── Combined COGS-vs-OpEx: expenses + payroll in ONE classification view ─────
  // Both sides now book into the same ACCOUNTING_CLASSIFICATIONS buckets, so we
  // merge them for a true "where every peso of cost is classified" breakdown.
  const costByClassification = useMemo(() => {
    const merged: Record<string, number> = { ...totalByAccountingClassification() };
    for (const [label, amt] of Object.entries(payrollByClassification())) {
      merged[label] = (merged[label] ?? 0) + amt;
    }
    return toBreakdown(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, payrollEntries]);

  // ── Financial performance by location ────────────────────────────────────────
  // Sales are attributed to the linked CUSTOMER's location, expenses to the
  // linked VENDOR's location. PHP and USD are NEVER summed, so we split by the
  // record's home country:
  //   - LOCAL (Philippine) records → province/municipality rollup, in PHP.
  //   - INTERNATIONAL records      → per-country rollup, in USD.
  // Sales honor the active slicers (filteredSales); expenses are farm-wide.
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);

  // Local (Philippine) province/municipality rollup — PHP only. Attribution is
  // by the customer's/vendor's CURRENT location (joined live via id), so editing
  // a customer's province instantly moves their sales here on the next render.
  const salesByLocation = useMemo(
    () => localPerformanceByLocation(filteredSales, expenses, customerById, vendorById),
    [filteredSales, expenses, customerById, vendorById],
  );

  // International per-country rollup — USD only.
  const salesByCountry = useMemo<CountryPerformance[]>(
    () => countryPerformance(filteredSales, expenses, customerById, vendorById),
    [filteredSales, expenses, customerById, vendorById],
  );

  // Province- and region-level subtotals, rolled up from salesByLocation.
  const salesByProvince = useMemo<LocationPerformance[]>(() => rollUpToProvince(salesByLocation), [salesByLocation]);
  const salesByRegion = useMemo<LocationPerformance[]>(() => rollUpToRegion(salesByLocation), [salesByLocation]);

  // ── International vs Local sales ─────────────────────────────────────────────
  // Split the (slicer-filtered) sales into Local (PHP) and International (USD)
  // segments. PHP and USD are NEVER summed — each segment carries its own total
  // in its own currency. Every sale LINE is flattened with its category/variety
  // so the section can offer a category → variety drill without re-touching the
  // stores. `country` comes from the linked customer (falls back to the sale's
  // currency for a one-off/manual customer with no saved record).
  const intlVsLocal = useMemo(() => {
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const lines: IntlVsLocalLine[] = [];
    let localTotal = 0;
    let intlTotal = 0;
    const localSaleIds = new Set<string>();
    const intlSaleIds = new Set<string>();

    filteredSales.forEach((sale) => {
      const cur: Currency = (sale.currency ?? 'PHP');
      const isIntl = cur === 'USD';
      const loc = customerById.get(sale.customerId)?.location;
      const country = countryOf(loc) === PHILIPPINES && isIntl ? 'International' : countryOf(loc);
      if (isIntl) { intlTotal += sale.subtotal; intlSaleIds.add(sale.id); }
      else { localTotal += sale.subtotal; localSaleIds.add(sale.id); }
      sale.items.forEach((item) => {
        const product = productById.get(item.productId);
        lines.push({
          segment: isIntl ? 'International' : 'Local',
          currency: cur,
          country,
          category: product?.category?.trim() || 'Uncategorized',
          variety: product?.subcategory?.trim() || item.productName || '(unspecified)',
          revenue: item.total ?? 0,
        });
      });
    });

    return {
      localTotal,       // PHP
      intlTotal,        // USD
      localCount: localSaleIds.size,
      intlCount: intlSaleIds.size,
      lines,
    };
  }, [filteredSales, customers, productById]);

  // Farm partners grouped by province — a partner is a customer flagged
  // `farmPartner`. Province is required on partners (enforced in the form), so
  // this maps our supply-partner footprint geographically. Sorted busiest-first.
  const farmPartnersByProvince = useMemo<FarmPartnerLocationSlice[]>(() => {
    const rollup = new Map<string, FarmPartnerLocationSlice>();
    customers.forEach((cust) => {
      if (!cust.farmPartner) return;
      const province = cust.location?.province?.trim() || UNSPECIFIED_LOCATION;
      let row = rollup.get(province);
      if (!row) {
        row = { province, region: regionOf(province) || UNSPECIFIED_LOCATION, count: 0 };
        rollup.set(province, row);
      }
      row.count += 1;
    });
    return Array.from(rollup.values()).sort((a, b) => b.count - a.count);
  }, [customers]);

  // ── SECTION 4: Real-time operational signals ─────────────────────────────────
  // Thresholds are context-aware rather than fixed counts: receivables escalate
  // on the SHARE of revenue outstanding, stock on out-of-stock severity, harvest
  // on due-now vs coming-this-week, and quality on damage rate gated by sample
  // size so a single early harvest can't trip a red flag.
  const signals = useMemo<AlertSignal[]>(() => {
    const out: AlertSignal[] = [];
    const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;
    const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
    const now = new Date();

    // (a) Harvest timelines — distinguish "due now" (in window) from "coming
    //     within 7 days" so staff can prep, not just react.
    let dueNow = 0;
    let comingSoon = 0;
    // Harvest timing now comes from each SECTION's lifecycle stage (a flowering
    // area is expected to fruit ~30 days later), tagged from a farm walk-through
    // — not a per-harvest flowering date.
    farmSections.forEach((s) => {
      const w = sectionHarvestWindow(s);
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

    // (b2) Total payables — farm-wide money still OWED out: UNPAID expenses +
    //      UNPAID payroll. Fires a red action flag once the outstanding total
    //      clears the alert threshold, otherwise stays green. Detail always
    //      carries each side's subtotal so cash-out obligations sit right next to
    //      the stock flag. This tracks the Expenses page "Pending" figure (total
    //      minus paid) — paid-out costs are settled and are NOT payables.
    // PHP and USD payables are kept SEPARATE (never summed/converted). Payroll is
    // local wages only, so it belongs to the ₱ side; the $ side is USD expenses.
    const payablesPHP = unpaidExpensesPHP + unpaidPayrollPHP;
    const payablesPHPDetail = `${peso(payablesPHP)} owed · Expenses ${peso(unpaidExpensesPHP)} · Payroll ${peso(unpaidPayrollPHP)}`;
    // Link to the page that actually holds the outstanding money: if the whole
    // balance is unpaid payroll (no unpaid expenses), jump to /payroll; otherwise
    // expenses are involved, so send the user to /expenses.
    const payablesPHPTo =
      unpaidExpensesPHP === 0 && unpaidPayrollPHP > 0 ? '/payroll' : '/expenses';
    out.push(
      payablesPHP > PAYABLES_ALERT_THRESHOLD
        ? { id: 'payables-php', level: 'action', title: 'Total payables (₱)', detail: payablesPHPDetail, to: payablesPHPTo }
        : { id: 'payables-php', level: 'good', title: 'Total payables (₱)', detail: payablesPHPDetail, to: payablesPHPTo },
    );

    // International payables — only surfaced when there are UNPAID USD expenses.
    if (unpaidExpensesUSD > 0) {
      const payablesUSDDetail = `${usd(unpaidExpensesUSD)} owed · International expenses`;
      out.push(
        unpaidExpensesUSD > PAYABLES_ALERT_THRESHOLD
          ? { id: 'payables-usd', level: 'action', title: 'Total payables ($)', detail: payablesUSDDetail, to: '/expenses' }
          : { id: 'payables-usd', level: 'good', title: 'Total payables ($)', detail: payablesUSDDetail, to: '/expenses' },
      );
    }

    // (c) Receivables — escalate on the SHARE of revenue outstanding, not a raw
    //     count. PHP and USD are kept SEPARATE (never summed): the peso share is
    //     measured against peso revenue, the dollar share against dollar revenue.
    //     >25% uncollected in EITHER currency = action; any unpaid = monitor.
    const isUsd = (s: (typeof sales)[number]) => (s.currency ?? 'PHP') === 'USD';
    const unpaid = sales.filter((s) => !s.paid);
    const unpaidPHP = unpaid.filter((s) => !isUsd(s)).reduce((sum, s) => sum + s.subtotal, 0);
    const unpaidUSD = unpaid.filter(isUsd).reduce((sum, s) => sum + s.subtotal, 0);
    const revenuePHP = sales.filter((s) => !isUsd(s)).reduce((sum, s) => sum + s.subtotal, 0);
    const revenueUSD = sales.filter(isUsd).reduce((sum, s) => sum + s.subtotal, 0);
    const sharePHP = revenuePHP > 0 ? (unpaidPHP / revenuePHP) * 100 : 0;
    const shareUSD = revenueUSD > 0 ? (unpaidUSD / revenueUSD) * 100 : 0;
    // Compose the amount detail in whichever currencies actually have receivables.
    const parts: string[] = [];
    if (unpaidPHP > 0) parts.push(peso(unpaidPHP));
    if (unpaidUSD > 0) parts.push(usd(unpaidUSD));
    const amountDetail = parts.join(' · ');
    const worstShare = Math.max(sharePHP, shareUSD);
    out.push(
      unpaid.length === 0
        ? { id: 'receivables', level: 'good', title: 'Receivables', detail: 'No outstanding invoices', to: '/sales' }
        : worstShare > 25
          ? { id: 'receivables', level: 'action', title: 'Receivables', detail: `${amountDetail} unpaid · up to ${worstShare.toFixed(0)}% of revenue`, to: '/sales' }
          : { id: 'receivables', level: 'warn', title: 'Receivables', detail: `${unpaid.length} unpaid · ${amountDetail}`, to: '/sales' },
    );

    // (c2) For Delivery — deliverable sales (they carry a cutting line) that
    //      haven't been marked delivered yet. These are open fulfillment items
    //      the team still needs to hand off. Monitor when any are pending; green
    //      when everything deliverable is out the door.
    const forDelivery = sales.filter((s) => hasCuttingLine(s, productById) && !s.delivered);
    out.push(
      forDelivery.length === 0
        ? { id: 'for-delivery', level: 'good', title: 'For delivery', detail: 'Nothing awaiting delivery', to: '/sales' }
        : { id: 'for-delivery', level: 'warn', title: 'For delivery', detail: `${forDelivery.length} order(s) awaiting delivery`, to: '/sales' },
    );

    // (c3) Cuttings to pack — mirrors Inventory's "Needs Packing" pool so the two
    //      views stay in sync. `bareOnHand` is the exact sum of every cutting
    //      row's `needsPacking` (the physical bare stock still awaiting the pack
    //      action) — the same number the Inventory page totals. Action when any
    //      bare stock is waiting, green when nothing needs packing. Pending-order
    //      demand is surfaced as context in the detail line, not the headline.
    const packing = computeCuttingPackingStatus(sales, (id) => productById.get(id), inventoryItems);
    out.push(
      packing.bareOnHand === 0
        ? {
            id: 'cuttings-to-pack',
            level: 'good',
            title: 'Cuttings to pack',
            detail: 'No cuttings awaiting packing',
            to: '/inventory',
          }
        : {
            id: 'cuttings-to-pack',
            level: 'action',
            title: 'Cuttings to pack',
            detail:
              packing.pendingOrders > 0
                ? `${packing.bareOnHand} cutting(s) awaiting packing · ${packing.pendingOrders} pending order(s)`
                : `${packing.bareOnHand} cutting(s) awaiting packing`,
            to: '/inventory',
          },
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
  }, [farmSections, lowStockItems, sales, productById, inventoryItems, totalHarvested, totalDamaged, unpaidExpensesPHP, unpaidExpensesUSD, unpaidPayrollPHP]);

  return {
    // section 1
    revenue, totalExp, totalPay, netProfit, netProfitUSD,
    productionYieldKg, cultivatedHectares, yieldPerHectare, costToIncomePct,
    years,
    // section 2
    varietyProfit, cuttingStatusDistribution,
    // section 3
    procurementCost, salesEarned, poolMix, fulfillment, quality,
    // expense bookkeeping breakdowns
    expenseByClassification, expenseByType,
    // financial performance by location (customer sales vs vendor expenses)
    salesByLocation, salesByProvince, salesByRegion,
    // international (USD) sales & expenses per country — kept separate from PHP
    salesByCountry,
    // international (USD) vs local (PHP) sales — kept separate, never summed
    revenueUSD, intlVsLocal,
    // farm partners grouped by province
    farmPartnersByProvince,
    // P&L summary — PHP and USD kept separate (USD has no payroll)
    monthlyPnLPHP, pnlRevenuePHP, pnlExpensesPHP, pnlPayrollPHP: totalPay,
    pnlNetProfitPHP, pnlMarginPHP,
    monthlyPnLUSD, pnlRevenueUSD, pnlExpensesUSD, pnlNetProfitUSD, pnlMarginUSD,
    hasUsdPnL,
    // payroll (labor) bookkeeping breakdowns + combined cost-by-classification
    payrollByLaborType, payrollByClassification: payrollByClassificationSlices, costByClassification,
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
