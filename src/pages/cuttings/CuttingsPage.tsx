import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Scissors, Sprout, DollarSign, Clock, CheckCircle2, ShoppingCart, PackageCheck,
  Undo2,
} from 'lucide-react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useCuttingStore, liveCuttingStatus } from '../../store/cuttingStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useNowTick } from '../../hooks/useNowTick';
import type { CuttingBatch, CuttingStatus } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { Badge } from '../../components/ui/Badge';
import { RowActions } from '../../components/ui/RowActions';
import { formatPHP, formatNumber, formatDate } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import {
  CUTTING_SOURCE_CUSTOMER, CUTTING_SOURCE_INTERNAL, CUTTING_STATUS_ROOTED_READY,
  CUTTING_STATUS_PACKED, CUTTING_ALLOCATION_REPLANT, CUTTINGS_PRODUCT_TYPE,
} from '../../constants';
import { PIE_COLORS } from '../../constants/chartColors';
import {
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../constants/chartTheme';
import { CuttingForm } from './CuttingForm';

/** Map a lifecycle status to a Badge variant. */
const STATUS_VARIANT: Record<CuttingStatus, 'gray' | 'yellow' | 'green' | 'blue' | 'purple'> = {
  'In Nursery / Callusing': 'purple',
  Sourced: 'gray',
  Rooting: 'yellow',
  Ready: 'green',
  [CUTTING_STATUS_ROOTED_READY]: 'green',
  [CUTTING_STATUS_PACKED]: 'blue',
  'Sold Out': 'blue',
};

/** Human-friendly note about how long until a batch is ready (or that it is). */
function readinessLabel(batch: CuttingBatch): string {
  if (batch.status === 'Sold Out') return 'All sold';
  if (batch.status === CUTTING_STATUS_PACKED) return 'In Available Stock for Sale';
  if (batch.status === CUTTING_STATUS_ROOTED_READY) {
    return batch.allocation === CUTTING_ALLOCATION_REPLANT ? 'Allocated · Replant' : 'Pack to release for sale';
  }
  // Still healing: count down to the end of the callusing hold (the planting date).
  if (batch.status === 'In Nursery / Callusing') {
    try {
      const days = differenceInCalendarDays(parseISO(batch.dateSourced), new Date());
      return days > 0 ? `Callusing · ~${days} day${days !== 1 ? 's' : ''} to plant` : 'Callusing';
    } catch {
      return 'Callusing';
    }
  }
  // Prefer the graft-based rooting date; fall back to the growth-cycle estimate
  // (customer-sourced records usually have no graft date).
  const target = batch.readyDate || batch.estimatedReadyDate;
  if (batch.status === 'Sourced' && !target) return 'Not grafted yet';
  if (!target) return '—';
  try {
    const days = differenceInCalendarDays(parseISO(target), new Date());
    if (batch.status === 'Ready' || days <= 0) return 'Ready';
    return `~${days} day${days !== 1 ? 's' : ''} left`;
  } catch {
    return '—';
  }
}

/**
 * Cuttings page — the *growing* side of the business: sourcing cost, grafting,
 * rooting time, and readiness. Selling happens in the Sales page (one place to
 * sell everything), so this page has no sale-entry flow.
 */
export function CuttingsPage() {
  // Subscribe to the `batches` array itself so the whole page (KPIs + banners)
  // re-renders instantly on any add/edit/delete — no refresh needed. Rollups are
  // derived from this subscribed array rather than from get()-based store methods
  // so they can never read a stale snapshot.
  const storedBatches = useCuttingStore((s) => s.batches);
  // Inventory is the source of truth for what's actually Ready for Sale — it
  // includes farm-packed batches AND cuttings bought already-packed via Expenses.
  const inventoryItems = useInventoryStore((s) => s.items);
  const deleteBatch = useCuttingStore((s) => s.deleteBatch);
  const allocateBatch = useCuttingStore((s) => s.allocateBatch);
  const updateBatch = useCuttingStore((s) => s.updateBatch);
  const markPacked = useCuttingStore((s) => s.markPacked);
  const unmarkPacked = useCuttingStore((s) => s.unmarkPacked);
  const markPlanted = useCuttingStore((s) => s.markPlanted);
  const unmarkPlanted = useCuttingStore((s) => s.unmarkPlanted);

  /**
   * Undo a packed batch. The store guard blocks the undo if the inventory pool
   * can't absorb the subtraction (stock already allocated/sold) — surface that as
   * a toast.
   */
  const handleUndoPacked = (id: string) => {
    const ok = unmarkPacked(id);
    if (ok) toast.success('Reverted to Rooted & Ready to Pack');
    else toast.error('Cannot undo: Stock from this batch has already been allocated or sold.');
  };

  /**
   * Step 1 of the farm path: reserve the batch for our own plots. Flags it For
   * Replant and credits Our Farm Breeding Stock — it's set aside but not yet in
   * the ground (status stays "Rooted & Ready to Pack").
   */
  const handleReserveForFarm = (id: string) => {
    allocateBatch(id, CUTTING_ALLOCATION_REPLANT);
    toast.success('Reserved for the farm — added to Our Farm Breeding Stock');
  };

  /** Step 2: deploy a reserved batch into the field (moves it out of breeding). */
  const handleMarkPlanted = (id: string) => {
    markPlanted(id);
    toast.success('Planted — deployed to the field & added to the wholesale forecast');
  };

  /** Un-reserve: drop the For Replant flag and remove it from breeding stock. */
  const handleUnreserve = (id: string) => {
    allocateBatch(id, '');
    toast.success('Reservation cleared');
  };

  const handlePackForDelivery = (id: string) => {
    markPacked(id);
    toast.success('Packed — added to Available Stock for Sale');
  };

  const handleUndoPlanted = (id: string) => {
    unmarkPlanted(id);
    toast.success('Reverted to Reserved for Farm');
  };

  const crud = useListCrud<CuttingBatch>();
  // Tick every minute so batches crossing their callusing/ready date update their
  // status (and green highlight) on their own, without a page refresh.
  const nowTick = useNowTick();

  // Overlay a freshly time-computed status on each batch so KPIs, banners,
  // badges, and the row highlight all reflect the current clock. The stored
  // status is only recomputed on write, so we derive the live one here.
  const batches = useMemo(
    () => storedBatches.map((b) => ({ ...b, status: liveCuttingStatus(b, nowTick) })),
    [storedBatches, nowTick],
  );

  // Recompute derived rollups whenever batches change.
  const cost = useMemo(() => batches.reduce((sum, b) => sum + b.totalCost, 0), [batches]);
  const sourced = useMemo(() => batches.reduce((sum, b) => sum + b.quantitySourced, 0), [batches]);
  // "Ready for Sale" = the packed-and-undelivered cutting stock across ALL
  // sources, read from inventory's availableForSale pool (farm-packed batches +
  // cuttings bought already-packed via Expenses). This is what's truly sellable,
  // vs. `readyToRoot` below which only counts rooted batches in the Cuttings store.
  const readyForSale = useMemo(
    () =>
      inventoryItems
        .filter((i) => i.category === CUTTINGS_PRODUCT_TYPE)
        .reduce((sum, i) => sum + (i.availableForSale ?? 0), 0),
    [inventoryItems],
  );
  // Batches that have finished rooting and still have stock — used for the
  // "Ready to Sell" banner (rooted/packed with available quantity).
  const ready = useMemo(
    () =>
      batches.filter(
        (b) =>
          (b.status === 'Ready' ||
            b.status === CUTTING_STATUS_ROOTED_READY ||
            b.status === CUTTING_STATUS_PACKED) &&
          b.quantityAvailable > 0,
      ),
    [batches],
  );
  // ── Stage batch counts (match the table's live status 1:1, no qty filter) ──
  // Callusing (In Nursery), Rooting, and Rooted & Ready to Pack. These count
  // every batch in that live status so the KPI equals the visible rows.
  const callusing = useMemo(
    () => batches.filter((b) => b.status === 'In Nursery / Callusing'),
    [batches],
  );
  const rooting = useMemo(
    () => batches.filter((b) => b.status === 'Rooting'),
    [batches],
  );
  const rootedReady = useMemo(
    () => batches.filter((b) => b.status === CUTTING_STATUS_ROOTED_READY),
    [batches],
  );

  const avgCostPerCutting = sourced > 0 ? cost / sourced : 0;

  /** Batch counts per live lifecycle status, for the pipeline donut. */
  const pipelineByStatus = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const b of batches) {
      byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1);
    }
    return Array.from(byStatus.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0);
  }, [batches]);

  const columns: Column<CuttingBatch>[] = [
    {
      key: 'variety',
      header: 'Variety',
      accessor: (b) => (
        <div>
          <span className="font-medium text-gray-900">{b.subcategory}</span>
          <p className="text-xs text-gray-400">
            {b.source === CUTTING_SOURCE_CUSTOMER && b.customerName ? `to ${b.customerName} · ` : ''}
            acquired {b.dateSourced ? formatDate(b.dateSourced) : '—'}
          </p>
        </div>
      ),
      sortValue: (b) => b.subcategory,
    },
    {
      key: 'source',
      header: 'Source',
      accessor: (b) => (
        <Badge
          label={b.source ?? CUTTING_SOURCE_INTERNAL}
          variant={b.source === CUTTING_SOURCE_CUSTOMER ? 'blue' : 'purple'}
        />
      ),
      sortValue: (b) => b.source ?? CUTTING_SOURCE_INTERNAL,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (b) => (
        <div className="flex flex-col gap-0.5">
          <Badge label={b.status} variant={STATUS_VARIANT[b.status]} />
          <span className="text-xs text-gray-400">{readinessLabel(b)}</span>
        </div>
      ),
      sortValue: (b) => b.status,
    },
    {
      key: 'packing',
      header: 'Packing / Deployment',
      accessor: (b) => {
        // Planted batches are deployed in the field and feed the wholesale
        // forecast, with a low-profile Undo mirroring the packed state.
        if (b.planted) {
          return (
            <div className="flex flex-col items-start gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-leaf-700">
                <Sprout className="w-3.5 h-3.5" /> Planted · in field
              </span>
              <Link to="/wholesale-forecast" className="text-xs text-gray-400 hover:text-primary-700 hover:underline">
                deployed {b.deploymentDate ? formatDate(b.deploymentDate) : '—'} · view forecast
              </Link>
              <button
                type="button"
                onClick={() => handleUndoPlanted(b.id)}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-leaf-700 hover:bg-leaf-50 rounded px-1.5 py-0.5 transition-colors"
                title="Revert to Rooted & Ready to Pack and remove it from the wholesale forecast"
              >
                <Undo2 className="w-3 h-3" /> Undo Planted
              </button>
            </div>
          );
        }
        // Packed batches: confirm stock release, plus a low-profile Undo. The undo
        // is blocked at click time if the stock can no longer be pulled back out
        // of inventory (already allocated/sold) — surfaced via a toast.
        if (b.status === CUTTING_STATUS_PACKED) {
          return (
            <div className="flex flex-col items-start gap-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-700">
                <PackageCheck className="w-3.5 h-3.5" /> Packed · in stock for sale
              </span>
              <Link
                to={`/inventory?highlight=${encodeURIComponent(b.subcategory)}`}
                className="text-xs text-gray-400 hover:text-primary-700 hover:underline"
              >
                {formatNumber(b.quantityAvailable, 0)} Ready for Sale · view inventory
              </Link>
              <button
                type="button"
                onClick={() => handleUndoPacked(b.id)}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-primary-700 hover:bg-primary-50 rounded px-1.5 py-0.5 transition-colors"
                title="Revert to Rooted & Ready to Pack and remove the stock from inventory"
              >
                <Undo2 className="w-3 h-3" /> Undo Packed
              </button>
            </div>
          );
        }
        // Rooted-ready internal batches. Two sub-states:
        //  (a) Reserved for the farm (allocation = For Replant): it's set aside in
        //      Our Farm Breeding Stock — offer "Mark as Planted" to deploy it, or
        //      un-reserve. (b) Undecided: present the destination fork.
        if (b.status === CUTTING_STATUS_ROOTED_READY && b.source !== CUTTING_SOURCE_CUSTOMER) {
          if (b.allocation === CUTTING_ALLOCATION_REPLANT) {
            return (
              <div className="flex flex-col items-start gap-1">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-berry-700">
                  <Sprout className="w-3.5 h-3.5" /> Reserved for farm
                </span>
                <Link
                  to={`/inventory?highlight=${encodeURIComponent(b.subcategory)}`}
                  className="text-xs text-gray-400 hover:text-berry-700 hover:underline"
                >
                  {formatNumber(b.quantityAvailable, 0)} in Our Farm Breeding Stock · view inventory
                </Link>
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <Button
                    size="xs"
                    variant="outline"
                    icon={<Sprout className="w-3.5 h-3.5" />}
                    onClick={() => handleMarkPlanted(b.id)}
                  >
                    Mark as Planted
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleUnreserve(b.id)}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-berry-700 hover:bg-berry-50 rounded px-1.5 py-0.5 transition-colors"
                    title="Clear the reservation and return the stock from Breeding Stock"
                  >
                    <Undo2 className="w-3 h-3" /> Undo Reserve
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-gray-400">Choose a destination:</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  icon={<PackageCheck className="w-3.5 h-3.5" />}
                  onClick={() => handlePackForDelivery(b.id)}
                >
                  Pack for Delivery
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  icon={<Sprout className="w-3.5 h-3.5" />}
                  onClick={() => handleReserveForFarm(b.id)}
                >
                  Reserve for Farm
                </Button>
              </div>
            </div>
          );
        }
        return <span className="text-gray-300">—</span>;
      },
      sortValue: (b) => (b.status === CUTTING_STATUS_PACKED ? 2 : b.status === CUTTING_STATUS_ROOTED_READY ? 1 : 0),
    },
    {
      key: 'readyDate',
      header: 'Ready Date',
      // Prefer the graft-based rooting date; fall back to the growth-cycle estimate.
      accessor: (b) => {
        const d = b.readyDate || b.estimatedReadyDate;
        return d ? formatDate(d) : '—';
      },
      // Sort by ready date ascending (closest to today first). Batches with no
      // ready date yet ("not grafted") sort to the END via a high sentinel, so
      // dated batches always lead.
      sortValue: (b) => b.readyDate || b.estimatedReadyDate || '9999-12-31',
    },
    {
      key: 'quantitySourced',
      header: 'Sourced',
      accessor: (b) => formatNumber(b.quantitySourced, 0),
      sortValue: (b) => b.quantitySourced,
    },
    {
      key: 'quantityAvailable',
      header: 'Available',
      accessor: (b) => (
        <span className={b.quantityAvailable > 0 ? 'font-semibold text-leaf-700' : 'text-gray-400'}>
          {formatNumber(b.quantityAvailable, 0)}
        </span>
      ),
      sortValue: (b) => b.quantityAvailable,
    },
    {
      key: 'sourceCostPerCutting',
      header: 'Cost / Cutting',
      accessor: (b) => formatPHP(b.sourceCostPerCutting + b.graftCostPerCutting),
      sortValue: (b) => b.sourceCostPerCutting + b.graftCostPerCutting,
    },
    {
      key: 'totalCost',
      header: 'Batch Cost (₱)',
      accessor: (b) => formatPHP(b.totalCost),
      sortValue: (b) => b.totalCost,
    },
    {
      key: 'notes',
      header: 'Notes',
      accessor: (b) => b.notes?.trim()
        ? <span className="text-gray-600">{b.notes}</span>
        : <span className="text-gray-300">—</span>,
      sortValue: (b) => b.notes ?? '',
      editable: { type: 'text', getValue: (b) => b.notes ?? '' },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuttings Store"
        subtitle={`${batches.length} record${batches.length !== 1 ? 's' : ''} · internal batches + customer purchases`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Add Batch</Button>}
      />

      {/* Selling happens in Sales — make that unmistakable */}
      <SectionCard>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary-50 flex-shrink-0">
              <ShoppingCart className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">Selling cuttings? Record it in Sales.</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Cutting sales are entered in the Sales page, where the small-order surcharge
                (under {formatNumber(25, 0)} cuttings = +₱100/cutting) is applied automatically.
                This page tracks the growing side: cost, rooting, and readiness.
              </p>
            </div>
          </div>
          <Link to="/sales" className="flex-shrink-0">
            <Button variant="outline" size="sm" icon={<ShoppingCart className="w-4 h-4" />}>
              Go to Sales
            </Button>
          </Link>
        </div>
      </SectionCard>

      {/* ── KPIs ── */}
      {/* Money + volume totals. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard title="Total Cost" value={formatPHP(cost)} subtitle="Sourcing + grafting" icon={DollarSign} iconColor="text-red-500" iconBg="bg-red-50" />
        <StatCard title="Total Sourced" value={formatNumber(sourced, 0)} subtitle={avgCostPerCutting > 0 ? `${formatPHP(avgCostPerCutting)} avg / cutting` : 'cuttings'} icon={Sprout} iconColor="text-primary-600" iconBg="bg-primary-50" />
      </div>
      {/* Lifecycle stages. Callusing → Rooting → Rooted & Ready to Pack are batch
          counts (matching the table's live status 1:1); Packed & Ready to Sell is
          the sellable piece quantity from inventory (farm + purchased). */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Callusing" value={formatNumber(callusing.length, 0)} subtitle="In nursery, healing" icon={Sprout} iconColor="text-primary-600" iconBg="bg-primary-50" />
        <StatCard title="Rooting" value={formatNumber(rooting.length, 0)} subtitle="Batches maturing" icon={Clock} iconColor="text-berry-600" iconBg="bg-berry-50" />
        <StatCard title="Rooted & Ready to Pack" value={formatNumber(rootedReady.length, 0)} subtitle="Pack or reserve for replant" icon={PackageCheck} iconColor="text-gold-600" iconBg="bg-gold-50" />
        <StatCard title="Packed & Ready to Sell" value={formatNumber(readyForSale, 0)} subtitle="Packed pieces — farm + purchased" icon={CheckCircle2} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
      </div>

      {/* ── Pipeline by status chart ── */}
      {batches.length > 0 && pipelineByStatus.length > 0 && (
        <CollapsibleSection title="Analytics" subtitle="Charts" storageKey="cuttings.analytics.collapsed">
        <SectionCard title="Cutting Pipeline by Status" subtitle="How many batches sit at each lifecycle stage">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={pipelineByStatus}
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
                {pipelineByStatus.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => `${Number(v)} batches`}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>
        </CollapsibleSection>
      )}

      {/* ── Rooted & ready — needs allocation banner ── */}
      {rootedReady.length > 0 && (
        <SectionCard
          title="🌿 Rooted & Ready to Pack"
          subtitle="These batches have finished rooting — pack for delivery, or reserve them for the farm and then plant"
        >
          <div className="flex flex-wrap gap-2">
            {rootedReady.map((b) => {
              const reserved = b.allocation === CUTTING_ALLOCATION_REPLANT;
              return (
                <div
                  key={b.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${reserved ? 'bg-berry-50 border-berry-300' : 'bg-leaf-50 border-leaf-300'}`}
                >
                  <span className={`text-sm font-medium ${reserved ? 'text-berry-800' : 'text-leaf-800'}`}>{b.subcategory}</span>
                  <Badge label={`${formatNumber(b.quantityAvailable, 0)} ${reserved ? 'reserved' : 'ready'}`} variant={reserved ? 'purple' : 'green'} />
                  {reserved ? (
                    <Button size="xs" variant="outline" icon={<Sprout className="w-3.5 h-3.5" />} onClick={() => handleMarkPlanted(b.id)}>
                      Mark as Planted
                    </Button>
                  ) : (
                    <>
                      <Button size="xs" variant="outline" icon={<PackageCheck className="w-3.5 h-3.5" />} onClick={() => handlePackForDelivery(b.id)}>
                        Pack for Delivery
                      </Button>
                      <Button size="xs" variant="outline" icon={<Sprout className="w-3.5 h-3.5" />} onClick={() => handleReserveForFarm(b.id)}>
                        Reserve for Farm
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* ── Ready-to-sell banner ── */}
      {ready.length > 0 && (
        <SectionCard title="✅ Ready to Sell" subtitle="These batches have finished rooting and have stock available — sell them in the Sales page">
          <div className="flex flex-wrap gap-2">
            {ready.map((b) => (
              <div key={b.id} className="flex items-center gap-2 px-3 py-1.5 bg-leaf-50 border border-leaf-200 rounded-lg">
                <span className="text-sm font-medium text-leaf-800">{b.subcategory}</span>
                <Badge label={`${formatNumber(b.quantityAvailable, 0)} available`} variant="green" />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Rooting / maturing banner ── */}
      {rooting.length > 0 && (
        <SectionCard title="⏳ Rooting" subtitle="Grafted cuttings actively rooting toward their estimated ready date">
          <div className="flex flex-wrap gap-2">
            {rooting.map((b) => (
              <div key={b.id} className="flex items-center gap-2 px-3 py-1.5 bg-gold-50 border border-gold-200 rounded-lg">
                <span className="text-sm font-medium text-gold-800">{b.subcategory}</span>
                <Badge label={readinessLabel(b)} variant="yellow" />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {batches.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title="No cutting batches yet"
          description="Add a batch of cuttings to track cost, rooting time, and readiness. Sell them from the Sales page once they've rooted."
          action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Batch</Button>}
        />
      ) : (
        <Table
          data={batches}
          columns={columns}
          keyExtractor={(b) => b.id}
          searchFilter={(b, q) =>
            b.subcategory.toLowerCase().includes(q) ||
            b.status.toLowerCase().includes(q) ||
            b.notes.toLowerCase().includes(q)
          }
          searchPlaceholder="Search cuttings…"
          emptyMessage="No cutting batches found."
          // Rooted & ready-to-pack batches (not yet packed or planted) glow soft
          // green so they instantly catch the eye for the next staff action.
          rowClassName={(b) =>
            b.status === CUTTING_STATUS_ROOTED_READY && !b.planted
              ? 'bg-primary-50 hover:bg-primary-100'
              : ''
          }
          actions={(b) => <RowActions onEdit={() => crud.openEdit(b)} onDelete={() => crud.requestDelete(b)} />}
          // Notes edit inline; updateBatch only recomputes derived fields, so a
          // notes-only patch has no cascade.
          onCellEdit={(b, key, value) => updateBatch(b.id, { [key]: value })}
          // Default: soonest ready date first (closest to today at the top).
          defaultSort={{ key: 'readyDate', dir: 'asc' }}
          getRecency={(b) => b.createdAt}
        />
      )}

      {/* Add / Edit batch */}
      <Modal
        open={crud.modalOpen}
        onClose={crud.closeModal}
        title={crud.editing ? 'Edit Cutting Batch' : 'Add Cutting Batch'}
        size="lg"
      >
        <CuttingForm batch={crud.editing} onClose={crud.closeModal} />
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((b) => deleteBatch(b.id))}
        message={`Delete the "${crud.deleteTarget?.subcategory}" cutting batch? This cannot be undone.`}
      />
    </div>
  );
}
