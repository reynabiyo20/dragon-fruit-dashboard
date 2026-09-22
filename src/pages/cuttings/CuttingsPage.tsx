import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Scissors, Sprout, DollarSign, Clock, CheckCircle2, ShoppingCart, PackageCheck,
  Undo2, CalendarClock, X,
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
import { UndoBar } from '../../components/ui/UndoBar';
import { BulkFieldEdit, type BulkFieldConfig } from '../../components/ui/BulkFieldEdit';
import { formatPHP, formatNumber, formatDate } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import {
  CUTTING_SOURCE_CUSTOMER, CUTTING_SOURCE_INTERNAL, CUTTING_SOURCE_PURCHASED,
  CUTTING_STATUS_ROOTED_READY, CUTTING_STATUS_SOURCED,
  CUTTING_STATUS_PACKED, CUTTING_ALLOCATION_REPLANT, CUTTING_ALLOCATION_DELIVERY,
  CUTTINGS_PRODUCT_TYPE,
  CUTTING_TYPE_OPTIONS, CUTTING_ROOT_WEEKS_MIN, CUTTING_ROOT_WEEKS_MAX,
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
  [CUTTING_STATUS_SOURCED]: 'gray',
  Rooting: 'yellow',
  [CUTTING_STATUS_ROOTED_READY]: 'green',
  [CUTTING_STATUS_PACKED]: 'blue',
  'Sold Out': 'blue',
};

/** Human-friendly note about how long until a batch is ready (or that it is). */
function readinessLabel(batch: CuttingBatch): string {
  if (batch.status === 'Sold Out') return 'All sold';
  // Planted batches keep the rooted-ready status internally, but they're deployed
  // on the farm — surface that instead of the "Allocated · Replant" pack note.
  if (batch.planted) return 'Deployed on farm';
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
  if (batch.status === CUTTING_STATUS_SOURCED && !target) return 'Not grafted yet';
  if (!target) return '—';
  try {
    const days = differenceInCalendarDays(parseISO(target), new Date());
    if (days <= 0) return 'Ready';
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
  const deleteBatch = useCuttingStore((s) => s.deleteBatch);
  const allocateBatch = useCuttingStore((s) => s.allocateBatch);
  const updateBatch = useCuttingStore((s) => s.updateBatch);
  const unmarkPacked = useCuttingStore((s) => s.unmarkPacked);
  const markPlanted = useCuttingStore((s) => s.markPlanted);
  const unmarkPlanted = useCuttingStore((s) => s.unmarkPlanted);

  // Inventory owns the sellable pools. Packing on this page routes through the
  // same store actions the Inventory page uses (single source of truth): they
  // deduct from Needs Packing and credit Packed + Available to Sell. We also
  // subscribe to the inventory `items` array so the "Packed & Ready to Sell" KPI
  // reflects the live pool and re-renders the instant a pack is saved.
  const inventoryItems = useInventoryStore((s) => s.items);
  const packCuttings = useInventoryStore((s) => s.packCuttings);
  const unpackCuttings = useInventoryStore((s) => s.unpackCuttings);

  /**
   * Undo a packed batch. The store guard blocks the undo if the inventory pool
   * can't absorb the subtraction (stock already allocated/sold) — surface that as
   * a toast.
   */
  const handleUndoPacked = (id: string) => {
    const ok = unmarkPacked(id);
    if (ok) toast.success('Reverted to Rooted & Ready to Pack/Plant');
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

  // Tag a rooted-ready batch "Pack for Delivery": cascade its quantity into
  // Inventory's Needs Packing pool. The actual packing (Needs Packing → Ready
  // for Sale) is then done on the Inventory page, so Inventory owns the sellable
  // state and stays the single source of truth.
  const handlePackForDelivery = (id: string) => {
    allocateBatch(id, CUTTING_ALLOCATION_DELIVERY);
    toast.success('Queued for packing — added to Needs Packing in Inventory');
  };

  // Clear the "Pack for Delivery" tag and pull the quantity back out of Needs
  // Packing. Blocked if some of it was already packed in Inventory (pool would
  // go negative) — surfaced as a toast.
  const handleUnqueuePacking = (id: string) => {
    const batch = useCuttingStore.getState().getBatch(id);
    if (!batch) return;
    const inventory = useInventoryStore.getState();
    const row = inventory.findByCategorySub(CUTTINGS_PRODUCT_TYPE, batch.subcategory);
    if (row && (row.needsPacking ?? 0) < batch.quantityAvailable) {
      toast.error('Cannot undo: some of these cuttings have already been packed in Inventory.');
      return;
    }
    allocateBatch(id, '');
    toast.success('Removed from Needs Packing');
  };

  const handleUndoPlanted = (id: string) => {
    unmarkPlanted(id);
    toast.success('Reverted to Reserved for Farm');
  };

  // ── Pack flow (mirrors the Inventory "Pack Cuttings" form) ──────────────────
  // A batch queued for delivery sits in Inventory's Needs Packing pool. This
  // form lets staff flag it packed right here: it moves the entered quantity out
  // of Needs Packing and into Packed + Available to Sell via the same inventory
  // action the Inventory page uses. `packTarget` holds the batch being packed and
  // the inventory row id its variety maps to; `packMax` is what still needs
  // packing (the row pool clamped to this batch's available quantity).
  const [packTarget, setPackTarget] = useState<{ batch: CuttingBatch; rowId: string; max: number } | null>(null);
  const [packQty, setPackQty] = useState('');
  // One-click undo back into Needs Packing after a successful pack.
  const [packUndo, setPackUndo] = useState<{ message: string; rowId: string; qty: number } | null>(null);

  const openPack = (b: CuttingBatch) => {
    const row = useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, b.subcategory);
    if (!row) {
      toast.error('This batch is not queued for packing yet.');
      return;
    }
    // Only this batch's own queued quantity should be packable from here, but it
    // can never exceed what the shared variety row still has awaiting packing.
    const max = Math.min(b.quantityAvailable, row.needsPacking ?? 0);
    if (max <= 0) {
      toast.error('Nothing left to pack for this batch.');
      return;
    }
    setPackTarget({ batch: b, rowId: row.id, max });
    setPackQty(String(max)); // default to packing the full queued quantity
  };
  const closePack = () => { setPackTarget(null); setPackQty(''); };
  const confirmPack = () => {
    if (!packTarget) return;
    const requested = Math.min(Number(packQty) || 0, packTarget.max);
    const packed = packCuttings(packTarget.rowId, requested);
    if (packed > 0) {
      toast.success(`Packed ${formatNumber(packed, 0)} ${packTarget.batch.subcategory} — now Available to Sell`);
      setPackUndo({
        message: `Packed ${formatNumber(packed, 0)} ${packTarget.batch.subcategory} — now Available to Sell.`,
        rowId: packTarget.rowId,
        qty: packed,
      });
    } else {
      toast.error('Enter a quantity packed (up to what needs packing).');
    }
    closePack();
  };
  const undoPack = () => {
    if (!packUndo) return;
    const moved = unpackCuttings(packUndo.rowId, packUndo.qty);
    if (moved > 0) toast(`Moved ${formatNumber(moved, 0)} back to Needs Packing`, { icon: '↩️' });
    else toast.error('Cannot undo — those cuttings have already been sold.');
    setPackUndo(null);
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

  // Propagation KPIs describe the cuttings the FARM grows, so they're scoped to
  // internal batches. Customer-source batches are just a record of what a buyer
  // took (cascaded from a sale) — they carry no propagation cost/stage and would
  // otherwise inflate the counts.
  const internalBatches = useMemo(
    () => batches.filter((b) => (b.source ?? CUTTING_SOURCE_INTERNAL) !== CUTTING_SOURCE_CUSTOMER),
    [batches],
  );

  // Recompute derived rollups whenever batches change.
  const cost = useMemo(() => internalBatches.reduce((sum, b) => sum + b.totalCost, 0), [internalBatches]);
  const sourced = useMemo(() => internalBatches.reduce((sum, b) => sum + b.quantitySourced, 0), [internalBatches]);
  // Internal batches whose stock is genuinely sellable — used for the "Ready to
  // Sell" banner. Only PACKED batches (and the legacy "Ready" status) qualify; a
  // "Rooted & Ready to Pack" batch still needs a pack/reserve decision, so it
  // belongs to the "Rooted & Ready to Pack" banner instead — never both.
  const ready = useMemo(
    () =>
      internalBatches.filter(
        (b) =>
          b.status === CUTTING_STATUS_PACKED &&
          b.quantityAvailable > 0,
      ),
    [internalBatches],
  );
  // ── Internal-batch lifecycle stage counts ──────────────────────────────────
  // Callusing (In Nursery) → Rooting → Rooted & Ready to Pack. Scoped to internal
  // batches so the KPIs describe the farm's own propagation pipeline.
  const callusing = useMemo(
    () => internalBatches.filter((b) => b.status === 'In Nursery / Callusing'),
    [internalBatches],
  );
  const rooting = useMemo(
    () => internalBatches.filter((b) => b.status === 'Rooting'),
    [internalBatches],
  );
  // Rooted-ready batches that still need a pack/plant decision. A PLANTED batch
  // keeps the "Rooted & Ready" status (so Undo Planted can revert cleanly) and
  // keeps its "For Replant" allocation flag, so it must be excluded explicitly —
  // otherwise it lingers in this pipeline as "N reserved · Mark as Planted" even
  // though it's already deployed to the field (see the Packing/Deployment column,
  // which correctly shows "Planted · in field"). Excluding it here keeps the
  // "Rooted & Ready to Pack/Plant" KPI + banner in sync with the table.
  const rootedReady = useMemo(
    () => internalBatches.filter((b) => b.status === CUTTING_STATUS_ROOTED_READY && !b.planted),
    [internalBatches],
  );
  // Packed cuttings that are ready to sell. This is the propagation OUTPUT, and
  // Inventory owns the sellable pool — packing (here or on the Inventory page)
  // moves stock into `availableForSale`. Summing that pool across all Cuttings
  // rows keeps this KPI in lockstep with the pack action, whichever page it was
  // run from. (Order-fulfillment — what's needed for pending customer orders —
  // lives on the Dashboard signal and the Inventory page, not here.)
  const packedReady = useMemo(
    () =>
      inventoryItems
        .filter((i) => i.category === CUTTINGS_PRODUCT_TYPE)
        .reduce((sum, i) => sum + (i.availableForSale ?? 0), 0),
    [inventoryItems],
  );
  // Batches still missing a Graft / Plant date. Until it's set, the rooting clock
  // hasn't started (status stays "Sourced") and the ready-date estimate is a
  // placeholder — so these are the batches to act on, especially purchased
  // cuttings that arrived already-advanced (set the graft date to their real
  // progress). Packed / planted / sold-out batches are past this step, so exclude
  // them; only batches with stock still on hand count.
  const needsGraftPredicate = (b: CuttingBatch) =>
    !b.dateGrafted &&
    !b.packed &&
    !b.planted &&
    b.status !== 'Sold Out' &&
    b.quantityAvailable > 0;
  const needsGraftDate = useMemo(
    () => internalBatches.filter(needsGraftPredicate),
    [internalBatches],
  );

  const avgCostPerCutting = sourced > 0 ? cost / sourced : 0;

  // ── Bulk field edit (+ undo) ────────────────────────────────────────────────
  // Variety options come from the managed taxonomy (same source as the form).
  const categoryEntries = useProductCategoryStore((s) => s.entries);
  const varietyOptions = useMemo(() => {
    const subs = categoryEntries
      .filter((e) => e.category === CUTTINGS_PRODUCT_TYPE && e.subcategory !== '')
      .map((e) => e.subcategory);
    return [...new Set(subs)].sort().map((v) => ({ value: v, label: v }));
  }, [categoryEntries]);

  // Drilldown: clicking the "Needs Graft / Plant Date" KPI filters the table to
  // just those batches. 'off' by default; cleared via the banner or re-click.
  const [showNeedsGraftOnly, setShowNeedsGraftOnly] = useState(false);

  // Which field is being bulk-edited + the rows it applies to (null = closed).
  const [bulkField, setBulkField] = useState<{ key: keyof CuttingBatch; config: BulkFieldConfig } | null>(null);
  const [bulkRows, setBulkRows] = useState<CuttingBatch[]>([]);
  // Shared undo: previous per-row patches, re-applied via updateBatch.
  const [undoSnapshot, setUndoSnapshot] = useState<{ message: string; prev: { id: string; patch: Partial<CuttingBatch> }[] } | null>(null);

  // The 8 bulk-editable fields, each mapped to its input descriptor.
  const bulkFields: { key: keyof CuttingBatch; config: BulkFieldConfig }[] = [
    { key: 'subcategory', config: { label: 'Variety', type: 'creatable', options: varietyOptions, onCreate: (v) => syncTaxonomy(CUTTINGS_PRODUCT_TYPE, v) } },
    { key: 'harvestDate', config: { label: 'Harvest Date', type: 'date', hint: 'Internal batches: planting date is derived (harvest + callusing hold).' } },
    { key: 'cuttingType', config: { label: 'Cutting Type', type: 'select', options: CUTTING_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label })) } },
    { key: 'dateGrafted', config: { label: 'Date Grafted / Planted', type: 'date' } },
    { key: 'quantitySourced', config: { label: 'Quantity Sourced', type: 'number', min: 1, step: '1', hint: 'Packed or planted batches are skipped to keep inventory pools in sync.' } },
    { key: 'rootWeeks', config: { label: 'Expected Rooting Time', type: 'number', min: CUTTING_ROOT_WEEKS_MIN, step: '1', placeholder: `${CUTTING_ROOT_WEEKS_MIN}–${CUTTING_ROOT_WEEKS_MAX} weeks`, hint: `Rooting takes ${CUTTING_ROOT_WEEKS_MIN}–${CUTTING_ROOT_WEEKS_MAX} weeks.` } },
    { key: 'sourceCostPerCutting', config: { label: 'Source Cost / Cutting (₱)', type: 'number', min: 0, step: '0.01' } },
    { key: 'graftCostPerCutting', config: { label: 'Graft / Prep Cost / Cutting (₱)', type: 'number', min: 0, step: '0.01' } },
  ];

  const openBulk = (key: keyof CuttingBatch, config: BulkFieldConfig, rows: CuttingBatch[]) => {
    if (rows.length === 0) return;
    setBulkField({ key, config });
    setBulkRows(rows);
  };
  const closeBulk = () => { setBulkField(null); setBulkRows([]); };

  const applyBulk = (value: string | number) => {
    if (!bulkField) return;
    const { key, config } = bulkField;

    // Guard: editing quantitySourced on a packed/planted batch would desync the
    // inventory pools (which are only moved by pack/plant/allocate, not
    // updateBatch). Skip those rows and report how many were skipped.
    let rows = bulkRows;
    let skipped = 0;
    if (key === 'quantitySourced') {
      const safe = bulkRows.filter((b) => !(b.packed || b.planted));
      skipped = bulkRows.length - safe.length;
      rows = safe;
    }
    if (rows.length === 0) {
      toast.error('All selected batches are packed/planted — quantity left unchanged.');
      closeBulk();
      return;
    }

    const prev = rows.map((b) => ({ id: b.id, patch: { [key]: b[key] } as Partial<CuttingBatch> }));
    rows.forEach((b) => updateBatch(b.id, { [key]: value } as Partial<CuttingBatch>));

    const count = rows.length;
    const shown = config.type === 'number' ? String(value) : `"${value}"`;
    setUndoSnapshot({
      message: `Set ${config.label.toLowerCase()} to ${shown} for ${count} batch${count !== 1 ? 'es' : ''}.`,
      prev,
    });
    toast.success(
      `Updated ${config.label.toLowerCase()} for ${count} batch${count !== 1 ? 'es' : ''}` +
      (skipped > 0 ? ` · ${skipped} skipped (packed/planted)` : ''),
    );
    closeBulk();
  };

  const undoBulk = () => {
    if (!undoSnapshot) return;
    undoSnapshot.prev.forEach(({ id, patch }) => updateBatch(id, patch));
    setUndoSnapshot(null);
  };

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

  // The table shows all batches, unless the "Needs Graft / Plant Date" drilldown
  // is active — then it's scoped to just those batches.
  const tableData = useMemo(
    () => (showNeedsGraftOnly ? batches.filter(needsGraftPredicate) : batches),
    [batches, showNeedsGraftOnly],
  );

  const columns: Column<CuttingBatch>[] = [
    {
      key: 'variety',
      header: 'Variety',
      accessor: (b) => (
        <div>
          <span className="font-medium text-gray-900">{b.subcategory}</span>
          <p className="text-xs text-gray-400">
            {b.source === CUTTING_SOURCE_CUSTOMER && b.customerName ? `to ${b.customerName} · ` : ''}
            {b.source === CUTTING_SOURCE_PURCHASED && b.vendorName ? `from ${b.vendorName} · ` : ''}
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
          variant={
            b.source === CUTTING_SOURCE_CUSTOMER ? 'blue'
              : b.source === CUTTING_SOURCE_PURCHASED ? 'berry'
                : 'purple'
          }
        />
      ),
      sortValue: (b) => b.source ?? CUTTING_SOURCE_INTERNAL,
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (b) => (
        <div className="flex flex-col gap-0.5">
          {/* A planted batch keeps status = "Rooted & Ready to Pack/Plant"
              internally (so Undo Planted can revert cleanly), but to staff it is
              deployed in the field. Show that here so the Status column matches
              the "Planted · in field" state in the Packing / Deployment column. */}
          {b.planted ? (
            <Badge label="Planted · in field" variant="green" />
          ) : (
            <Badge label={b.status} variant={STATUS_VARIANT[b.status]} />
          )}
          <span className="text-xs text-gray-400">{readinessLabel(b)}</span>
        </div>
      ),
      sortValue: (b) => (b.planted ? 'Planted · in field' : b.status),
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
          // Tagged "Pack for Delivery": the quantity now sits in Inventory's Needs
          // Packing pool, waiting to be packed there. Link across to act on it.
          if (b.allocation === CUTTING_ALLOCATION_DELIVERY) {
            return (
              <div className="flex flex-col items-start gap-1">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-gold-700">
                  <PackageCheck className="w-3.5 h-3.5" /> Queued for packing
                </span>
                <Link
                  to={`/inventory?highlight=${encodeURIComponent(b.subcategory)}`}
                  className="text-xs text-gray-400 hover:text-gold-700 hover:underline"
                >
                  {formatNumber(b.quantityAvailable, 0)} in Needs Packing · view inventory
                </Link>
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <Button
                    size="xs"
                    variant="outline"
                    icon={<PackageCheck className="w-3.5 h-3.5" />}
                    onClick={() => openPack(b)}
                  >
                    Pack
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleUnqueuePacking(b.id)}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gold-700 hover:bg-gold-50 rounded px-1.5 py-0.5 transition-colors"
                    title="Clear the Pack for Delivery tag and remove the quantity from Needs Packing"
                  >
                    <Undo2 className="w-3 h-3" /> Undo Queue
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
      key: 'harvestDate',
      header: 'Harvest Date',
      // Internal (own-farm) batches carry a harvest date; customer-sourced records
      // don't, so they show a dash. Undated batches sort to the end.
      accessor: (b) => (b.harvestDate ? formatDate(b.harvestDate) : '—'),
      sortValue: (b) => b.harvestDate || '9999-12-31',
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
        title="Propagation"
        subtitle={`${batches.length} batch${batches.length !== 1 ? 'es' : ''} the farm is growing · internal + customer-sale sourced`}
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

      {/* Buying-in cuttings? Those go through Expenses → Inventory, not this table. */}
      <SectionCard>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-gold-50 flex-shrink-0">
              <PackageCheck className="w-5 h-5 text-gold-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">Bought cuttings from a vendor? Record it in Expenses.</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Vendor-purchased cuttings are logged as an Expense and land in Inventory — packed
                stock goes to Ready for Sale, unpacked stock to Needs Packing. They don't appear as
                batches here, since this page only tracks cuttings the farm grows. See their packed
                stock and pack bare stock in Inventory.
              </p>
            </div>
          </div>
          <Link to="/inventory" className="flex-shrink-0">
            <Button variant="outline" size="sm" icon={<PackageCheck className="w-4 h-4" />}>
              Go to Inventory
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
      {/* Internal-batch propagation lifecycle: Callusing → Rooting → Rooted &
          Ready to Pack → Packed & Ready to Sell. All scoped to the farm's own
          batches (customer-source records don't have a propagation stage). */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Callusing" value={formatNumber(callusing.length, 0)} subtitle="In nursery, healing" icon={Sprout} iconColor="text-primary-600" iconBg="bg-primary-50" />
        <StatCard title="Rooting" value={formatNumber(rooting.length, 0)} subtitle="Batches maturing" icon={Clock} iconColor="text-berry-600" iconBg="bg-berry-50" />
        <StatCard title="Rooted & Ready to Pack/Plant" value={formatNumber(rootedReady.length, 0)} subtitle="Pack to sell, or reserve & plant" icon={PackageCheck} iconColor="text-gold-600" iconBg="bg-gold-50" />
        <StatCard
          title="Packed & Ready to Sell"
          value={formatNumber(packedReady, 0)}
          subtitle={packedReady > 0 ? 'Packed pieces awaiting sale — sell them in Sales' : 'Packed pieces from farm batches'}
          icon={packedReady > 0 ? PackageCheck : CheckCircle2}
          iconColor={packedReady > 0 ? 'text-red-500' : 'text-leaf-600'}
          iconBg={packedReady > 0 ? 'bg-red-50' : 'bg-leaf-50'}
          titleColor={packedReady > 0 ? 'text-red-600' : undefined}
          valueColor={packedReady > 0 ? 'text-red-600' : undefined}
        />
      </div>

      {/* Action item — batches still missing a Graft / Plant date (rooting clock
          not started). Goes red while any are waiting, back to normal at 0. */}
      <div className="grid grid-cols-1 gap-4">
        <StatCard
          title="Needs Graft / Plant Date"
          value={formatNumber(needsGraftDate.length, 0)}
          subtitle={
            needsGraftDate.length > 0
              ? (showNeedsGraftOnly
                  ? 'Showing these batches — click to show all'
                  : 'Set the graft/plant date to start the rooting clock — click to filter')
              : 'Every batch has its rooting clock set'
          }
          icon={CalendarClock}
          iconColor={needsGraftDate.length > 0 ? 'text-red-500' : 'text-leaf-600'}
          iconBg={needsGraftDate.length > 0 ? 'bg-red-50' : 'bg-leaf-50'}
          titleColor={needsGraftDate.length > 0 ? 'text-red-600' : undefined}
          valueColor={needsGraftDate.length > 0 ? 'text-red-600' : undefined}
          onClick={needsGraftDate.length > 0 ? () => setShowNeedsGraftOnly((v) => !v) : undefined}
        />
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

      {undoSnapshot && (
        <UndoBar
          message={undoSnapshot.message}
          onUndo={undoBulk}
          onDismiss={() => setUndoSnapshot(null)}
        />
      )}

      {packUndo && (
        <UndoBar
          message={packUndo.message}
          onUndo={undoPack}
          onDismiss={() => setPackUndo(null)}
        />
      )}

      {/* Active "Needs Graft / Plant Date" filter banner — lets the user clear it. */}
      {showNeedsGraftOnly && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          <span>
            Showing {formatNumber(needsGraftDate.length, 0)} batch{needsGraftDate.length !== 1 ? 'es' : ''} that need a graft / plant date.
          </span>
          <button
            type="button"
            onClick={() => setShowNeedsGraftOnly(false)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <X className="w-3.5 h-3.5" /> Clear filter
          </button>
        </div>
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
          data={tableData}
          columns={columns}
          keyExtractor={(b) => b.id}
          searchFilter={(b, q) =>
            b.subcategory.toLowerCase().includes(q) ||
            b.status.toLowerCase().includes(q) ||
            b.notes.toLowerCase().includes(q)
          }
          searchPlaceholder={showNeedsGraftOnly ? 'Search batches needing a date…' : 'Search cuttings…'}
          emptyMessage={showNeedsGraftOnly ? 'No batches need a graft / plant date.' : 'No cutting batches found.'}
          // Rooted & ready-to-pack batches (not yet packed or planted) glow soft
          // green so they instantly catch the eye for the next staff action.
          rowClassName={(b) =>
            b.status === CUTTING_STATUS_ROOTED_READY && !b.planted
              ? 'bg-primary-50 hover:bg-primary-100'
              : ''
          }
          bulkActions={{
            noun: 'batch',
            actions: bulkFields.map(({ key, config }) => ({
              label: `Set ${config.label}`,
              onClick: (rows: CuttingBatch[]) => openBulk(key, config, rows),
            })),
            onDelete: (rows) => rows.forEach((b) => deleteBatch(b.id)),
          }}
          actions={(b) => <RowActions onEdit={() => crud.openEdit(b)} onDelete={() => crud.requestDelete(b)} />}
          // Notes edit inline; updateBatch only recomputes derived fields, so a
          // notes-only patch has no cascade.
          onCellEdit={(b, key, value) => updateBatch(b.id, { [key]: value })}
          // Default: soonest ready date first (closest to today at the top).
          persistKey="cuttings"
          defaultSort={{ key: 'readyDate', dir: 'asc' }}
          getRecency={(b) => b.createdAt}
        />
      )}

      {/* Pack queued cuttings → Ready for Sale (mirrors the Inventory form) */}
      <Modal open={!!packTarget} onClose={closePack} title="Pack Cuttings" size="sm">
        {packTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Move packed <span className="font-medium text-gray-900">{packTarget.batch.subcategory}</span> cuttings
              from <span className="font-medium">Needs Packing</span> into <span className="font-medium">Available to Sell</span>.
              {' '}<span className="text-gray-500">{formatNumber(packTarget.max, 0)} awaiting packing.</span>
            </p>
            <div>
              <label htmlFor="cutting-pack-qty" className="block text-sm font-medium text-gray-700 mb-1">Quantity packed</label>
              <input
                id="cutting-pack-qty"
                type="number"
                min="0"
                step="1"
                max={packTarget.max}
                value={packQty}
                onChange={(e) => setPackQty(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                Deducts from Needs Packing and adds to Packed &amp; Ready to Sell in Inventory. Ending Qty is unchanged — the stock was already on hand.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closePack}>Cancel</Button>
              <Button icon={<PackageCheck className="w-4 h-4" />} onClick={confirmPack}>Pack</Button>
            </div>
          </div>
        )}
      </Modal>

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

      {/* Bulk-edit one field across the selected batches (undoable) */}
      <BulkFieldEdit
        open={!!bulkField}
        onClose={closeBulk}
        field={bulkField?.config ?? null}
        count={bulkRows.length}
        onApply={applyBulk}
      />
    </div>
  );
}
