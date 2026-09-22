import { useMemo, useState } from 'react';
import { Plus, ShoppingCart, TrendingUp, Clock, CheckCircle2, CircleDashed, X, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format, parseISO, startOfMonth, differenceInDays } from 'date-fns';
import {
  AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar, LabelList, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useSaleStore } from '../../store/saleStore';
import { useProductStore } from '../../store/productStore';
import type { Sale, Currency } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { RowActions } from '../../components/ui/RowActions';
import { UndoBar } from '../../components/ui/UndoBar';
import { PeriodFilter } from '../../components/ui/PeriodFilter';
import {
  type PeriodFilter as Period, ALL_PERIODS, availableYears, dateMatchesPeriod,
} from '../../utils/period';
import { formatPHP, formatUSD, formatDate, formatNumber } from '../../utils/format';
import { computeCuttingPackingStatus, computeSaleDeliveryReadiness } from '../../utils/cuttingPacking';
import { useInventoryStore } from '../../store/inventoryStore';
import { useListCrud } from '../../hooks/useListCrud';
import { useSaleDraftStore, useSaleDraftHasContent } from '../../store/saleDraftStore';
import { BRAND, PIE_COLORS } from '../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../constants/chartTheme';
import { SaleForm } from './SaleForm';

export function SalesPage() {
  const { sales, deleteSale, updateSale } = useSaleStore();
  const { getProduct } = useProductStore();
  const inventoryItems = useInventoryStore((s) => s.items);
  const crud = useListCrud<Sale>();
  const navigate = useNavigate();
  // Whether the in-progress "New Sale" draft has real user-entered content.
  // Derived from the draft (not a sticky flag), so the banner shows only once
  // fields are filled and hides again when they're cleared.
  const hasSaleDraft = useSaleDraftHasContent();
  const clearSaleDraft = useSaleDraftStore((s) => s.clear);
  // Bumped when the user discards a draft, to force the New Sale form to remount
  // with cleared state (its values are seeded once at mount).
  const [saleFormGen, setSaleFormGen] = useState(0);
  const discardSaleDraft = () => {
    clearSaleDraft();
    setSaleFormGen((g) => g + 1);
  };

  // ── Period filter (drives the charts below; KPI cards stay all-time) ─────────
  const [period, setPeriod] = useState<Period>(ALL_PERIODS);
  const years = useMemo(() => availableYears(sales.map((s) => s.date)), [sales]);
  const filteredSales = useMemo(
    () => sales.filter((s) => dateMatchesPeriod(s.date, period)),
    [sales, period],
  );

  // ── Outstanding drilldown: clicking an Outstanding KPI card filters the table
  //    to unpaid sales. Scoped to a currency ('PHP'/'USD') when the business has
  //    international sales, or 'all' otherwise. 'off' = no drilldown active.
  //    Cleared via the banner's "Clear filter". ─────────────────────────────────
  const [outstandingFilter, setOutstandingFilter] = useState<'off' | 'all' | Currency>('off');

  // ── "For Delivery" drilldown: clicking the For Delivery KPI filters the table
  //    to sales that carry a stock item but aren't marked Received yet. Mutually
  //    exclusive with the Outstanding drilldown; cleared via its own banner. ─────
  const [forDeliveryOnly, setForDeliveryOnly] = useState(false);

  // ── "Sales by Category" drill: 'all' shows top-level categories; picking one
  //    drills into its varieties (subcategories). ───────────────────────────────
  const [salesCategory, setSalesCategory] = useState<string>('all');

  // ── Deliveries breakdown drill filter: category → variety ────────────────────
  const [deliveryCategory, setDeliveryCategory] = useState<string>('all');
  const [deliveryVariety, setDeliveryVariety] = useState<string>('all');
  // Changing the category resets the variety (varieties are scoped to a category).
  const changeDeliveryCategory = (cat: string) => {
    setDeliveryCategory(cat);
    setDeliveryVariety('all');
  };

  // ── Bulk status edit + undo ─────────────────────────────────────────────────
  // After a bulk paid/received change we snapshot each affected sale's previous
  // patch so the whole action can be reverted in one click. The Undo bar shows
  // only while a snapshot exists.
  const [undoSnapshot, setUndoSnapshot] = useState<{ message: string; prev: { id: string; patch: Partial<Sale> }[] } | null>(null);

  const bulkSetPaid = (rows: Sale[], paid: boolean) => {
    if (rows.length === 0) return;
    const prev = rows.map((s) => ({ id: s.id, patch: { paid: s.paid } }));
    rows.forEach((s) => updateSale(s.id, { paid }));
    setUndoSnapshot({
      message: `Marked ${rows.length} sale${rows.length !== 1 ? 's' : ''} as ${paid ? 'paid' : 'unpaid'}.`,
      prev,
    });
  };

  // A sale can only be flagged received once its cuttings are PACKED (inventory
  // Available-for-Sale ≥ the sale quantity). Returns the per-variety shortfall
  // when it can't yet — so callers can block the toggle and tell the user what to
  // pack. Un-receiving (delivered → false) is never gated.
  const deliveryReadinessOf = (s: Sale) =>
    computeSaleDeliveryReadiness(s, getProduct, inventoryItems);

  const bulkSetReceived = (rows: Sale[], delivered: boolean) => {
    if (rows.length === 0) return;
    // When marking received, drop any sale whose cuttings aren't fully packed yet
    // and warn about them; the rest still go through. Un-receiving is unrestricted.
    let eligible = rows;
    if (delivered) {
      const blocked: string[] = [];
      eligible = rows.filter((s) => {
        if (s.delivered) return true; // already received — leave as-is
        const readiness = deliveryReadinessOf(s);
        if (!readiness.canDeliver) {
          const detail = readiness.shortfalls.map((sf) => `${sf.toPack} × ${sf.variety}`).join(', ');
          blocked.push(`${s.customerName || 'Sale'} (${detail})`);
          return false;
        }
        return true;
      });
      if (blocked.length > 0) {
        toast.error(
          `Still needs packing before delivery: ${blocked.join('; ')}. Pack these on the Inventory page first.`,
          { duration: 7000 },
        );
      }
      if (eligible.length === 0) return;
    }
    const prev = eligible.map((s) => ({ id: s.id, patch: { delivered: s.delivered ?? false } }));
    eligible.forEach((s) => updateSale(s.id, { delivered }));
    setUndoSnapshot({
      message: `Marked ${eligible.length} sale${eligible.length !== 1 ? 's' : ''} as ${delivered ? 'received' : 'pending'}.`,
      prev,
    });
  };

  const undoBulk = () => {
    if (!undoSnapshot) return;
    undoSnapshot.prev.forEach(({ id, patch }) => updateSale(id, patch));
    setUndoSnapshot(null);
  };

  // Per-row Received toggle. Marking received is gated on packed stock (cuttings
  // must be packed to be handed over); un-receiving is always allowed.
  const toggleReceived = (s: Sale) => {
    if (s.delivered) {
      updateSale(s.id, { delivered: false });
      return;
    }
    const readiness = deliveryReadinessOf(s);
    if (!readiness.canDeliver) {
      const detail = readiness.shortfalls.map((sf) => `${sf.toPack} × ${sf.variety}`).join(', ');
      toast.error(
        `Can't mark as received yet — still needs packing: ${detail}. Pack these on the Inventory page first.`,
        { duration: 7000 },
      );
      return;
    }
    updateSale(s.id, { delivered: true });
  };

  // ── Chart data (driven by the period filter) ────────────────────────────────
  /** Revenue summed per calendar month, last 12 months, ascending by date. */
  const revenueTrend = useMemo(() => {
    const byMonth = new Map<string, { key: string; amount: number }>();
    for (const s of filteredSales) {
      if (!s.date) continue;
      let monthKey: string;
      let label: string;
      try {
        const start = startOfMonth(parseISO(s.date));
        monthKey = format(start, 'yyyy-MM');
        label = format(start, 'MMM yyyy');
      } catch {
        continue;
      }
      const existing = byMonth.get(label);
      if (existing) existing.amount += s.subtotal;
      else byMonth.set(label, { key: monthKey, amount: s.subtotal });
    }
    return Array.from(byMonth.entries())
      .map(([label, v]) => ({ label, key: v.key, amount: Number(v.amount.toFixed(2)) }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12);
  }, [filteredSales]);

  /** Revenue grouped by sale channel (saleType), descending. */
  const revenueByChannel = useMemo(() => {
    const byType = new Map<string, number>();
    for (const s of filteredSales) {
      const name = s.saleType?.trim() || 'Uncategorized';
      byType.set(name, (byType.get(name) ?? 0) + s.subtotal);
    }
    return Array.from(byType.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filteredSales]);

  /**
   * Every sale line flattened into a revenue line with its resolved category +
   * variety (subcategory). This is what the "Sales by Category" chart aggregates
   * so it can group by category, then drill into varieties within one.
   */
  const categoryRevenueLines = useMemo(() => {
    const lines: { category: string; variety: string; revenue: number }[] = [];
    for (const s of filteredSales) {
      for (const item of s.items) {
        const product = item.productId ? getProduct(item.productId) : undefined;
        lines.push({
          category: product?.category?.trim() || 'Uncategorized',
          variety: product?.subcategory?.trim() || '(unspecified)',
          revenue: item.total ?? 0,
        });
      }
    }
    return lines;
  }, [filteredSales, getProduct]);

  /** Distinct top-level categories present (for the sales-by-category drill). */
  const salesCategories = useMemo(
    () => Array.from(new Set(categoryRevenueLines.map((l) => l.category))).sort(),
    [categoryRevenueLines],
  );

  /**
   * "Sales by Category" chart, responding to the drill filter:
   *  - 'all' → grouped BY top-level category (Fruit, Cuttings, Drink …).
   *  - a category picked → grouped BY variety within that category.
   */
  const salesByCategory = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const l of categoryRevenueLines) {
      if (salesCategory !== 'all' && l.category !== salesCategory) continue;
      const key = salesCategory === 'all' ? l.category : l.variety;
      byKey.set(key, (byKey.get(key) ?? 0) + l.revenue);
    }
    return Array.from(byKey.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [categoryRevenueLines, salesCategory]);

  /**
   * Every inventory-tracked line item flattened with its resolved category +
   * variety, the quantity, and whether the sale was delivered. Includes BOTH
   * delivered and pending lines so the chart can stack them into a full total.
   */
  const deliveryLines = useMemo(() => {
    const lines: { category: string; variety: string; quantity: number; delivered: boolean }[] = [];
    for (const s of filteredSales) {
      for (const item of s.items) {
        const product = item.productId ? getProduct(item.productId) : undefined;
        if (!product?.category) continue;
        lines.push({
          category: product.category,
          variety: product.subcategory?.trim() || '(unspecified)',
          quantity: Number(item.quantity) || 0,
          delivered: s.delivered === true,
        });
      }
    }
    return lines;
  }, [filteredSales, getProduct]);

  /** Distinct categories present (for the category drill dropdown). */
  const deliveryCategories = useMemo(
    () => Array.from(new Set(deliveryLines.map((l) => l.category))).sort(),
    [deliveryLines],
  );

  /** Distinct varieties within the selected category (for the variety dropdown). */
  const deliveryVarieties = useMemo(() => {
    if (deliveryCategory === 'all') return [];
    return Array.from(
      new Set(deliveryLines.filter((l) => l.category === deliveryCategory).map((l) => l.variety)),
    ).sort();
  }, [deliveryLines, deliveryCategory]);

  /**
   * The deliveries chart data, responding to the drill filter. Each row carries
   * BOTH delivered + pending units so the bar can stack into the full total:
   *  - No category → grouped BY CATEGORY (Cuttings, Fruit, …).
   *  - Category picked → grouped BY VARIETY within that category.
   *  - Category + variety picked → just that variety.
   */
  const deliveryChart = useMemo(() => {
    const map = new Map<string, { delivered: number; pending: number }>();
    for (const l of deliveryLines) {
      if (deliveryCategory !== 'all' && l.category !== deliveryCategory) continue;
      if (deliveryVariety !== 'all' && l.variety !== deliveryVariety) continue;
      const key = deliveryCategory === 'all' ? l.category : l.variety;
      const row = map.get(key) ?? { delivered: 0, pending: 0 };
      if (l.delivered) row.delivered += l.quantity;
      else row.pending += l.quantity;
      map.set(key, row);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({
        name,
        delivered: v.delivered,
        pending: v.pending,
        total: v.delivered + v.pending,
        deliveredPct: v.delivered + v.pending > 0 ? (v.delivered / (v.delivered + v.pending)) * 100 : 0,
      }))
      .filter((d) => d.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [deliveryLines, deliveryCategory, deliveryVariety]);

  /** Delivered vs pending fulfillment summary + avg lead time, across all
   *  deliverable (inventory-tracked) sales — shown as a caption under the chart. */
  const deliverySummary = useMemo(() => {
    const deliverable = filteredSales.filter((s) => s.items.some((i) => !!(i.productId && getProduct(i.productId)?.category)));
    const delivered = deliverable.filter((s) => s.delivered);
    let leadDaysTotal = 0;
    let leadCount = 0;
    for (const s of delivered) {
      if (!s.deliveredDate || !s.date) continue;
      try {
        const days = differenceInDays(parseISO(s.deliveredDate), parseISO(s.date));
        if (days >= 0) { leadDaysTotal += days; leadCount += 1; }
      } catch { /* skip unparseable */ }
    }
    return {
      deliverableCount: deliverable.length,
      deliveredCount: delivered.length,
      pendingCount: deliverable.length - delivered.length,
      avgLeadDays: leadCount > 0 ? leadDaysTotal / leadCount : null,
    };
  }, [filteredSales, getProduct]);

  /**
   * Whether a sale contains any inventory-tracked line. Everything sold is
   * tracked in inventory, so any line with a resolvable product qualifies —
   * "Received by Customer" moves inventory `sold` (auto-creating the row if
   * needed). Resolves the line's product so it's not tied to the product name.
   */
  const hasStockItems = (s: Sale): boolean =>
    s.items.some((i) => {
      const product = i.productId ? getProduct(i.productId) : undefined;
      return !!product && !!product.category;
    });

  // Currency-scoped KPI figures, computed over the SELECTED PERIOD (filteredSales)
  // so the cards move with the period filter. PHP and USD are never summed — each
  // stays in its own currency.
  const kpis = useMemo(() => {
    const cur = (s: Sale) => (s.currency ?? 'PHP');
    const sumWhere = (currency: Currency, pred: (s: Sale) => boolean) =>
      filteredSales.filter((s) => cur(s) === currency && pred(s)).reduce((sum, s) => sum + s.subtotal, 0);
    const countWhere = (currency: Currency, pred: (s: Sale) => boolean) =>
      filteredSales.filter((s) => cur(s) === currency && pred(s)).length;
    const any = () => true;
    const unpaid = (s: Sale) => !s.paid;
    const paid = (s: Sale) => s.paid;
    return {
      hasUsdSales: filteredSales.some((s) => cur(s) === 'USD'),
      revenuePHP: sumWhere('PHP', any), revenueUSD: sumWhere('USD', any),
      collectedPHP: sumWhere('PHP', paid), collectedUSD: sumWhere('USD', paid),
      outstandingPHP: sumWhere('PHP', unpaid), outstandingUSD: sumWhere('USD', unpaid),
      unpaidCountPHP: countWhere('PHP', unpaid), unpaidCountUSD: countWhere('USD', unpaid),
    };
  }, [filteredSales]);
  const {
    hasUsdSales, revenuePHP, revenueUSD, collectedPHP, collectedUSD,
    outstandingPHP, outstandingUSD, unpaidCountPHP, unpaidCountUSD,
  } = kpis;
  const hasOutstandingPHP = outstandingPHP > 0;
  const hasOutstandingUSD = outstandingUSD > 0;
  const unpaidCount = unpaidCountPHP + unpaidCountUSD;

  // ── For Delivery — fulfillment backlog ───────────────────────────────────────
  // Sales that carry an inventory-tracked (stock) item but aren't marked Received
  // yet. Currency-agnostic — this is a count of orders awaiting hand-off, not a
  // money figure. Period-scoped like the other KPIs.
  const forDeliverySales = useMemo(
    () => filteredSales.filter((s) => hasStockItems(s) && !s.delivered),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredSales],
  );
  const forDeliveryCount = forDeliverySales.length;
  const hasForDelivery = forDeliveryCount > 0;

  // Packed-vs-ready status for the cuttings tied up in pending (undelivered)
  // sales. `toPack` is how many cutting pieces still need packing before those
  // orders can ship; when it's 0 the pending orders are already covered by
  // packed stock (ready to hand over). Drives the "For Delivery" card so the
  // user knows whether a delivery is ready or needs packing first.
  const packingStatus = useMemo(
    () => computeCuttingPackingStatus(forDeliverySales, getProduct, inventoryItems),
    [forDeliverySales, getProduct, inventoryItems],
  );
  const needsPacking = packingStatus.toPack > 0;

  // The table narrows while a KPI drilldown is active (respecting the period so
  // it matches the card clicked). The Outstanding and For-Delivery drilldowns are
  // mutually exclusive — activating one clears the other.
  const tableData = useMemo(() => {
    if (forDeliveryOnly) return filteredSales.filter((s) => hasStockItems(s) && !s.delivered);
    if (outstandingFilter === 'off') return filteredSales;
    return filteredSales.filter(
      (s) => !s.paid && (outstandingFilter === 'all' || (s.currency ?? 'PHP') === outstandingFilter),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSales, outstandingFilter, forDeliveryOnly]);

  // Activating one drilldown clears the other so the table + banners stay in sync.
  const activateOutstanding = (scope: 'all' | Currency) => { setForDeliveryOnly(false); setOutstandingFilter(scope); };
  const activateForDelivery = () => { setOutstandingFilter('off'); setForDeliveryOnly(true); };
  // Count shown in the drilldown banner, matching the active currency scope.
  const drilldownCount =
    outstandingFilter === 'PHP' ? unpaidCountPHP
      : outstandingFilter === 'USD' ? unpaidCountUSD
        : unpaidCount;

  // A sale that is BOTH Paid and Received is "completed" — money changed hands
  // and stock left — so it's locked against editing and deletion to keep its
  // recorded amounts, line items, inventory, and commissions from drifting after
  // the fact. To edit or delete such a sale, the user must first reopen it by
  // marking it Unpaid and/or Pending (the Status/Received toggles in the table,
  // or the bulk actions). A sale that is Unpaid and Pending is freely editable.
  const LOCKED_REASON =
    'This sale is Paid and Received. Mark it Unpaid and Pending to edit or delete it.';
  const isLocked = (s: Sale): boolean => !!s.paid && !!s.delivered;

  const requestEdit = (s: Sale) => {
    // Guard in case this is reached for a locked sale (RowActions already hides
    // the Edit button when locked). Block the edit and explain why.
    if (isLocked(s)) {
      toast.error(LOCKED_REASON, { duration: 5000 });
      return;
    }
    crud.openEdit(s);
  };

  // Deleting a sale reverts every effect it had — inventory (sold/packed/
  // available/ending), commissions, and Propagation batches — all handled
  // atomically inside deleteSale. A completed (Paid + Received) sale is locked
  // from deletion; the user must reopen it (Unpaid + Pending) first.
  const requestDelete = (s: Sale) => {
    if (isLocked(s)) {
      toast.error(LOCKED_REASON, { duration: 5000 });
      return;
    }
    crud.requestDelete(s);
  };

  // Delete a sale. deleteSale is self-contained: it removes the sale and reverses
  // its inventory, commission, and cutting-batch effects in one step, so KPIs and
  // dashboards (all derived from the sales array) update automatically. Kept as a
  // thin wrapper so the single-row confirm and the bulk path share one code path.
  const cascadeDeleteSale = (s: Sale) => {
    deleteSale(s.id);
  };

  const columns: Column<Sale>[] = [
    { key: 'date', header: 'Date', accessor: (s) => formatDate(s.date), sortValue: (s) => s.date },
    { key: 'invoiceNumber', header: 'Invoice #', accessor: (s) => s.invoiceNumber || '—', sortValue: (s) => s.invoiceNumber ?? '' },
    { key: 'customerName', header: 'Customer', accessor: (s) => <span className="font-medium">{s.customerName}</span>, sortValue: (s) => s.customerName },
    {
      key: 'soldByName',
      header: 'Sold By',
      accessor: (s) => {
        if (!s.soldByName) return '—';
        // When we know which employee made the sale, link to their row in the
        // Employees table; otherwise show the plain (unlinked) name.
        if (!s.soldByEmployeeId) return <span className="text-gray-700">{s.soldByName}</span>;
        return (
          <button
            type="button"
            onClick={() => navigate(`/employees?focus=${encodeURIComponent(s.soldByEmployeeId)}`)}
            className="text-primary-700 hover:text-primary-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
            title={`View ${s.soldByName} in Employees`}
          >
            {s.soldByName}
          </button>
        );
      },
      sortValue: (s) => s.soldByName ?? '',
    },
    {
      key: 'items',
      header: 'Items',
      // The row expands on click (via the Table's `expandable` config below) to
      // show every line — see the detail panel in the <Table>.
      expandTrigger: true,
      accessor: (s) => <SaleItemsCell sale={s} />,
      sortValue: (s) => s.items.length,
    },
    {
      key: 'subtotal',
      header: 'Total',
      accessor: (s) => (
        <span className="font-semibold text-gray-900">
          {(s.currency ?? 'PHP') === 'USD' ? formatUSD(s.subtotal) : formatPHP(s.subtotal)}
        </span>
      ),
      sortValue: (s) => s.subtotal,
    },
    { key: 'paymentMethod', header: 'Payment', accessor: (s) => s.paymentMethod || '—', sortValue: (s) => s.paymentMethod ?? '' },
    {
      key: 'paid',
      header: 'Status',
      accessor: (s) => (
        <button
          type="button"
          onClick={() => updateSale(s.id, { paid: !s.paid })}
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 ${
            s.paid
              ? 'bg-leaf-100 text-leaf-700 hover:bg-leaf-200'
              : 'bg-gold-100 text-gold-700 hover:bg-gold-200'
          }`}
          title={s.paid ? 'Mark as unpaid' : 'Mark as paid'}
          aria-label={`Payment status: ${s.paid ? 'Paid' : 'Unpaid'}. Click to mark as ${s.paid ? 'unpaid' : 'paid'}.`}
        >
          {s.paid ? 'Paid' : 'Unpaid'}
        </button>
      ),
      sortValue: (s) => (s.paid ? 1 : 0),
    },
    {
      key: 'delivered',
      header: 'Received',
      accessor: (s) => {
        // Sales with a resolvable product track receipt (all sold products are
        // inventory-tracked); lines with no product show a neutral dash.
        if (!hasStockItems(s) && !s.delivered) return <span className="text-gray-300">—</span>;

        // For a PENDING order, surface its own packing shortfall so the user sees
        // exactly how many cuttings THIS order still needs packed before it can be
        // handed over — instead of inferring it from the aggregate KPI. A packed,
        // ready order shows plain "Pending"; a short one shows "Pending · pack N"
        // with a red hint and a detailed tooltip.
        const readiness = s.delivered ? null : deliveryReadinessOf(s);
        const stillToPack = readiness ? readiness.shortfalls.reduce((sum, sf) => sum + sf.toPack, 0) : 0;
        const shortDetail = readiness && stillToPack > 0
          ? readiness.shortfalls.map((sf) => `${sf.toPack} × ${sf.variety}`).join(', ')
          : '';

        const pendingClass = stillToPack > 0
          ? 'bg-red-100 text-red-700 hover:bg-red-200'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200';
        const title = s.delivered
          ? 'Mark as not received'
          : stillToPack > 0
            ? `Still needs packing: ${shortDetail}. Pack these on the Inventory page before this order can be received.`
            : 'Mark as received by customer';
        const label = s.delivered
          ? 'Received'
          : stillToPack > 0
            ? `Pending · pack ${formatNumber(stillToPack, 0)}`
            : 'Pending';

        return (
          <button
            type="button"
            onClick={() => toggleReceived(s)}
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 ${
              s.delivered ? 'bg-berry-100 text-berry-700 hover:bg-berry-200' : pendingClass
            }`}
            title={title}
            aria-label={
              s.delivered
                ? 'Receipt status: Received. Click to mark as not received.'
                : stillToPack > 0
                  ? `Receipt status: Pending. Still needs packing: ${shortDetail}.`
                  : 'Receipt status: Pending, packed and ready. Click to mark as received.'
            }
          >
            {label}
          </button>
        );
      },
      sortValue: (s) => (s.delivered ? 1 : 0),
    },
    {
      key: 'notes',
      header: 'Notes',
      accessor: (s) => s.notes?.trim()
        ? <span className="text-gray-600">{s.notes}</span>
        : <span className="text-gray-300">—</span>,
      sortValue: (s) => s.notes ?? '',
      // Locked (Paid + Received) sales render notes read-only — no inline editor.
      editable: { type: 'text', getValue: (s) => s.notes ?? '', canEdit: (s) => !isLocked(s) },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        subtitle={`${sales.length} transaction${sales.length !== 1 ? 's' : ''}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>New Sale</Button>}
      />

      {sales.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter value={period} onChange={setPeriod} years={years} />
        </div>
      )}

      {hasUsdSales ? (
        // ── Mixed-currency view — PHP and USD reported separately (never summed).
        //    Each metric gets a ₱ card and a $ card. Total = Collected + Outstanding.
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Total Revenue */}
          <StatCard title="Total Revenue (₱)" value={formatPHP(revenuePHP)} icon={TrendingUp} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
          {/* Collected (money received) */}
          <StatCard title="Collected Revenue (₱)" value={formatPHP(collectedPHP)} icon={ShoppingCart} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
          {/* Outstanding (₱) — red only when PHP is owed; click to drill in. */}
          <StatCard
            title="Outstanding (₱)"
            value={formatPHP(outstandingPHP)}
            icon={Clock}
            iconColor={hasOutstandingPHP ? 'text-red-500' : 'text-gold-500'}
            iconBg={hasOutstandingPHP ? 'bg-red-50' : 'bg-gold-50'}
            valueColor={hasOutstandingPHP ? 'text-red-600' : 'text-gray-900'}
            subtitle={hasOutstandingPHP ? `${unpaidCountPHP} unpaid · click to view` : undefined}
            onClick={hasOutstandingPHP ? () => activateOutstanding('PHP') : undefined}
          />

          <StatCard title="Total Revenue ($)" value={formatUSD(revenueUSD)} icon={TrendingUp} iconColor="text-berry-600" iconBg="bg-berry-50" />
          <StatCard title="Collected Revenue ($)" value={formatUSD(collectedUSD)} icon={ShoppingCart} iconColor="text-berry-600" iconBg="bg-berry-50" />
          <StatCard
            title="Outstanding ($)"
            value={formatUSD(outstandingUSD)}
            icon={Clock}
            iconColor={hasOutstandingUSD ? 'text-red-500' : 'text-gold-500'}
            iconBg={hasOutstandingUSD ? 'bg-red-50' : 'bg-gold-50'}
            valueColor={hasOutstandingUSD ? 'text-red-600' : 'text-gray-900'}
            subtitle={hasOutstandingUSD ? `${unpaidCountUSD} unpaid · click to view` : undefined}
            onClick={hasOutstandingUSD ? () => activateOutstanding('USD') : undefined}
          />
        </div>
      ) : (
        // ── Local-only view — all sales are PHP. ────────────────────────────────
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard title="Total Revenue" value={formatPHP(revenuePHP)} icon={TrendingUp} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
          <StatCard title="Collected Revenue" value={formatPHP(collectedPHP)} icon={ShoppingCart} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
          <StatCard
            title="Outstanding"
            value={formatPHP(outstandingPHP)}
            icon={Clock}
            iconColor={hasOutstandingPHP ? 'text-red-500' : 'text-gold-500'}
            iconBg={hasOutstandingPHP ? 'bg-red-50' : 'bg-gold-50'}
            valueColor={hasOutstandingPHP ? 'text-red-600' : 'text-gray-900'}
            subtitle={hasOutstandingPHP ? `${unpaidCountPHP} unpaid · click to view` : undefined}
            onClick={hasOutstandingPHP ? () => activateOutstanding('all') : undefined}
          />
        </div>
      )}

      {/* For Delivery — fulfillment backlog (stock items not yet Received).
          Currency-agnostic; mirrors the Outstanding KPI (red when > 0, click to
          filter the table, clear via the banner). */}
      {sales.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="For Delivery"
            value={forDeliveryCount}
            icon={Truck}
            iconColor={needsPacking ? 'text-red-500' : hasForDelivery ? 'text-gold-500' : 'text-leaf-500'}
            iconBg={needsPacking ? 'bg-red-50' : hasForDelivery ? 'bg-gold-50' : 'bg-leaf-50'}
            valueColor={needsPacking ? 'text-red-600' : 'text-gray-900'}
            subtitle={
              !hasForDelivery
                ? 'All orders received'
                : needsPacking
                  ? `${packingStatus.toPack} cutting${packingStatus.toPack !== 1 ? 's' : ''} to pack · click to view`
                  : `${forDeliveryCount} order${forDeliveryCount !== 1 ? 's' : ''} packed & ready · click to view`
            }
            onClick={hasForDelivery ? activateForDelivery : undefined}
          />
        </div>
      )}

      {/* Analytics charts */}
      {sales.length > 0 && (
        <CollapsibleSection title="Analytics" subtitle="Charts & trends" storageKey="sales.analytics.collapsed">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Revenue trend over time */}
          <SectionCard title="Revenue Trend" subtitle="Total sales revenue per month">
            {revenueTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={revenueTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={BRAND.leaf} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={BRAND.leaf} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `₱${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip
                    formatter={(v) => formatPHP(Number(v))}
                    cursor={{ stroke: '#dcbcd6', strokeWidth: 1 }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Area type="monotone" dataKey="amount" name="Revenue" stroke={BRAND.leaf} strokeWidth={2} fill="url(#salesRevenueGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No revenue yet.</div>
            )}
          </SectionCard>

          {/* Revenue by channel */}
          <SectionCard title="Revenue by Channel" subtitle="Share of revenue per sale type">
            {revenueByChannel.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={revenueByChannel}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy={PIE_CENTER_Y}
                    innerRadius={PIE_INNER_RADIUS}
                    outerRadius={PIE_OUTER_RADIUS}
                    paddingAngle={1}
                    label={renderPieValueLabel}
                    labelLine={false}
                  >
                    {revenueByChannel.map((_, i) => (
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
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No revenue yet.</div>
            )}
          </SectionCard>

          {/* Sales by product category — top-level by default, drill into varieties */}
          <SectionCard
            title="Sales by Category"
            subtitle={
              salesCategory === 'all'
                ? 'Revenue share per product category'
                : `Variety breakdown · ${salesCategory}`
            }
            actions={
              <select
                value={salesCategory}
                onChange={(e) => setSalesCategory(e.target.value)}
                aria-label="Filter sales by category"
                className="text-xs border border-primary-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="all">All categories</option>
                {salesCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            }
          >
            {salesByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={salesByCategory}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy={PIE_CENTER_Y}
                    innerRadius={PIE_INNER_RADIUS}
                    outerRadius={PIE_OUTER_RADIUS}
                    paddingAngle={1}
                    label={renderPieValueLabel}
                    labelLine={false}
                  >
                    {salesByCategory.map((_, i) => (
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
              <div className="h-48 flex items-center justify-center text-sm text-gray-400 text-center px-4">
                {salesCategory === 'all' ? 'No category sales yet.' : `No sales recorded under ${salesCategory} yet.`}
              </div>
            )}
          </SectionCard>

          {/* Deliveries by category → variety, with a drill-down filter */}
          <SectionCard
            title="Deliveries by Category"
            subtitle={
              deliveryCategory === 'all'
                ? 'Delivered vs pending units per category'
                : deliveryVariety === 'all'
                  ? `Delivered vs pending per ${deliveryCategory} variety`
                  : `Delivered vs pending · ${deliveryCategory} — ${deliveryVariety}`
            }
            actions={
              <div className="flex items-center gap-2">
                <select
                  value={deliveryCategory}
                  onChange={(e) => changeDeliveryCategory(e.target.value)}
                  aria-label="Filter deliveries by category"
                  className="text-xs border border-primary-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="all">All categories</option>
                  {deliveryCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={deliveryVariety}
                  onChange={(e) => setDeliveryVariety(e.target.value)}
                  aria-label="Filter deliveries by variety"
                  disabled={deliveryCategory === 'all' || deliveryVarieties.length === 0}
                  className="text-xs border border-primary-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <option value="all">All varieties</option>
                  {deliveryVarieties.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            }
          >
            {deliveryChart.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={deliveryChart} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={40} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={120} />
                    <Tooltip
                      formatter={(v, name) => [`${Number(v).toLocaleString('en-US')} unit${Number(v) === 1 ? '' : 's'}`, name]}
                      cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                    />
                    <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                    <Bar dataKey="delivered" name="Delivered" stackId="units" fill={BRAND.leaf} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="pending" name="Pending" stackId="units" fill={BRAND.gold} radius={[0, 3, 3, 0]}>
                      <LabelList
                        dataKey="deliveredPct"
                        position="right"
                        formatter={(val) => `${Math.round(Number(val))}% del.`}
                        style={{ fontSize: 10, fill: '#6b6570' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-center text-xs text-gray-500">
                  {deliverySummary.deliveredCount} of {deliverySummary.deliverableCount} orders delivered · {deliverySummary.pendingCount} pending
                  {deliverySummary.avgLeadDays !== null
                    ? ` · avg lead time ${deliverySummary.avgLeadDays.toFixed(1)} day${deliverySummary.avgLeadDays === 1 ? '' : 's'}`
                    : ''}
                </p>
              </>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No sales in this view yet.</div>
            )}
          </SectionCard>
        </div>
        </CollapsibleSection>
      )}

      {sales.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No sales yet" description="Record your first sale to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>New Sale</Button>} />
      ) : (
        <>
        {undoSnapshot && (
          <UndoBar
            message={undoSnapshot.message}
            onUndo={undoBulk}
            onDismiss={() => setUndoSnapshot(null)}
          />
        )}
        {/* Active drilldown banner from the "Outstanding" KPI card */}
        {outstandingFilter !== 'off' && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
            <span>
              Showing <span className="font-semibold">{drilldownCount}</span>{' '}
              outstanding (unpaid){' '}
              {outstandingFilter === 'PHP' ? '₱ ' : outstandingFilter === 'USD' ? '$ ' : ''}
              sale{drilldownCount !== 1 ? 's' : ''}.
            </span>
            <button
              type="button"
              onClick={() => setOutstandingFilter('off')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              <X className="w-3.5 h-3.5" /> Clear filter
            </button>
          </div>
        )}
        {/* Active drilldown banner from the "For Delivery" KPI card */}
        {forDeliveryOnly && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
            <span>
              Showing <span className="font-semibold">{forDeliveryCount}</span>{' '}
              order{forDeliveryCount !== 1 ? 's' : ''} for delivery (not yet received).
              {needsPacking ? (
                <>
                  {' '}
                  <span className="font-semibold">{packingStatus.toPack}</span> cutting
                  {packingStatus.toPack !== 1 ? 's' : ''} still need packing before delivery.
                </>
              ) : (
                <> All packed &amp; ready to hand over.</>
              )}
            </span>
            <button
              type="button"
              onClick={() => setForDeliveryOnly(false)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              <X className="w-3.5 h-3.5" /> Clear filter
            </button>
          </div>
        )}
        <Table
          data={tableData}
          columns={columns}
          keyExtractor={(s) => s.id}
          searchFilter={(s, q) =>
            s.customerName.toLowerCase().includes(q) ||
            (s.invoiceNumber ?? '').toLowerCase().includes(q) ||
            s.paymentMethod.toLowerCase().includes(q) ||
            (s.soldByName ?? '').toLowerCase().includes(q) ||
            s.items.some((i) => (i.productName ?? '').toLowerCase().includes(q))
          }
          searchPlaceholder="Search sales…"
          actions={(s) => (
            <RowActions
              onEdit={() => requestEdit(s)}
              onDelete={() => requestDelete(s)}
              locked={isLocked(s)}
              lockedReason={LOCKED_REASON}
            />
          )}
          bulkActions={{
            noun: 'sale',
            actions: [
              { label: 'Mark Paid', icon: <CheckCircle2 className="w-4 h-4" />, onClick: (rows) => bulkSetPaid(rows, true) },
              { label: 'Mark Unpaid', icon: <CircleDashed className="w-4 h-4" />, onClick: (rows) => bulkSetPaid(rows, false) },
              { label: 'Mark Received', icon: <CheckCircle2 className="w-4 h-4" />, onClick: (rows) => bulkSetReceived(rows, true) },
              { label: 'Mark Pending', icon: <CircleDashed className="w-4 h-4" />, onClick: (rows) => bulkSetReceived(rows, false) },
            ],
            onDelete: (rows) => {
              // Locked (Paid + Received) sales are completed and can't be deleted
              // until reopened. Drop them from the batch and warn; the rest are
              // deleted and fully reverted (inventory, commissions, cuttings).
              const locked = rows.filter(isLocked);
              const deletable = rows.filter((s) => !isLocked(s));
              if (locked.length > 0) {
                toast.error(
                  `${locked.length} completed (Paid + Received) sale${locked.length !== 1 ? 's' : ''} skipped — mark them Unpaid and Pending to delete.`,
                  { duration: 6000 },
                );
              }
              deletable.forEach((s) => cascadeDeleteSale(s));
            },
          }}
          // Notes edit inline; a notes-only patch never recomputes items, so no
          // cascade. Blocked on locked (Paid + Received) sales — they must be
          // reopened before any field can change.
          onCellEdit={(s, key, value) => {
            if (isLocked(s)) {
              toast.error(LOCKED_REASON, { duration: 5000 });
              return;
            }
            updateSale(s.id, { [key]: value });
          }}
          // Rows expand (via the Items cell) to list every line sold — item,
          // quantity, unit price, any surcharge, and line total.
          expandable={{
            isExpandable: (s) => s.items.length > 0,
            render: (s) => {
              const isUsd = (s.currency ?? 'PHP') === 'USD';
              const money = (n: number) => (isUsd ? formatUSD(n) : formatPHP(n));
              const hasSurcharge = s.items.some((it) => (it.surcharge ?? 0) !== 0);
              const itemsTotal = s.items.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
              return (
                <div className="rounded-lg border border-primary-100 bg-white overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-primary-50/60 text-primary-800">
                        <th className="px-3 py-2 text-left font-semibold">Item</th>
                        <th className="px-3 py-2 text-right font-semibold">Qty</th>
                        <th className="px-3 py-2 text-right font-semibold">Unit Price</th>
                        {hasSurcharge && <th className="px-3 py-2 text-right font-semibold">Surcharge</th>}
                        <th className="px-3 py-2 text-right font-semibold">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {s.items.map((it, idx) => (
                        <tr key={idx} className="text-gray-700">
                          <td className="px-3 py-2">{it.productName || 'Unknown'}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{it.quantity}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{money(Number(it.unitPrice) || 0)}</td>
                          {hasSurcharge && (
                            <td className="px-3 py-2 text-right whitespace-nowrap text-gray-500">
                              {(it.surcharge ?? 0) !== 0 ? money(it.surcharge) : '—'}
                            </td>
                          )}
                          <td className="px-3 py-2 text-right whitespace-nowrap font-medium text-gray-900">{money(Number(it.total) || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t border-gray-200 font-semibold text-gray-900">
                        <td className="px-3 py-2" colSpan={hasSurcharge ? 4 : 3}>
                          Total ({s.items.length} item{s.items.length !== 1 ? 's' : ''})
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{money(itemsTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            },
          }}
          persistKey="sales"
          defaultSort={{ key: 'date', dir: 'asc' }}
          getRecency={(s) => s.createdAt}
        />
        </>
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Sale' : 'New Sale'} size="2xl">
        {/* Restored-draft notice — only when adding (not editing) a draft exists.
            Lets the user start fresh instead of continuing where they left off. */}
        {!crud.editing && hasSaleDraft && (
          <div className="mb-4 flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-primary-200 bg-primary-50 text-sm text-primary-800">
            <span>Continuing your unsaved draft. Your progress is kept until you save it.</span>
            <button
              type="button"
              onClick={discardSaleDraft}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-primary-700 hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              <X className="w-3.5 h-3.5" /> Discard draft
            </button>
          </div>
        )}
        <SaleForm
          key={crud.editing?.id ?? `new-${saleFormGen}`}
          sale={crud.editing}
          onClose={crud.closeModal}
        />
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((s) => cascadeDeleteSale(s))}
        message={
          crud.deleteTarget?.paid && crud.deleteTarget?.delivered
            ? `Delete completed sale "${crud.deleteTarget?.invoiceNumber || crud.deleteTarget?.id.slice(0, 8)}"? This sale is Paid and Received — deleting it will return its stock to inventory, remove its commission, and revert its KPIs. This cannot be undone.`
            : `Delete sale "${crud.deleteTarget?.invoiceNumber || crud.deleteTarget?.id.slice(0, 8)}"? Its inventory, commission, and KPI effects will be reverted. This cannot be undone.`
        }
      />
    </div>
  );
}

/**
 * Items cell for a sale row. Shows the first few items with a "+N more" toggle;
 * clicking anywhere on the cell expands the row's item list to show every item
 * (and clicking again collapses it). Expansion state is local to the cell.
 */
const ITEMS_COLLAPSED_COUNT = 3;

/**
 * Collapsed preview of a sale's line items. The row itself expands (via the
 * Table's `expandable` config) into a full detail panel — this just shows the
 * first few lines plus a "click to expand" hint, mirroring the Expenses table.
 */
function SaleItemsCell({ sale }: { sale: Sale }) {
  if (sale.items.length === 0) return <span className="text-gray-400">—</span>;

  const shown = sale.items.slice(0, ITEMS_COLLAPSED_COUNT);
  const remaining = sale.items.length - shown.length;

  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((item, idx) => (
        <span key={idx} className="text-xs text-gray-700 whitespace-nowrap">
          {item.productName || 'Unknown'}
          <span className="text-gray-400"> ×{item.quantity}</span>
        </span>
      ))}
      {remaining > 0 ? (
        <span className="text-xs text-primary-600">+{remaining} more · click to expand</span>
      ) : (
        <span className="text-xs text-gray-400">{sale.items.length} item{sale.items.length !== 1 ? 's' : ''} · click to expand</span>
      )}
    </div>
  );
}
