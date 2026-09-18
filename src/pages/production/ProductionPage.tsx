import { useMemo } from 'react';
import { Plus, Factory } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useProductionStore } from '../../store/productionStore';
import { useSaleStore } from '../../store/saleStore';
import { useFarmStore } from '../../store/farmStore';
import { totalHectares } from '../../utils/area';
import type { ProductionEntry } from '../../types';
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
import { formatNumber, formatDate, formatPHP } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { useNowTick } from '../../hooks/useNowTick';
import { estimateHarvestWindow, isInHarvestWindow } from '../../utils/date';
import { BRAND, CHART_EXPENSE } from '../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
} from '../../constants/chartTheme';
import { BarChart, Bar } from 'recharts';
import { ProductionForm } from './ProductionForm';

export function ProductionPage() {
  const { entries, deleteEntry, totalHarvested, totalGoodFruits, totalDamaged, totalWeightKg } = useProductionStore();
  const { sales } = useSaleStore();
  const farmSections = useFarmStore((s) => s.sections);
  const crud = useListCrud<ProductionEntry>();
  // Tick every minute so a row entering its harvest window lights up on its own,
  // without needing a page refresh.
  const nowTick = useNowTick();

  const totalH   = totalHarvested();
  const totalG   = totalGoodFruits();
  const totalD   = totalDamaged();
  const totalW   = totalWeightKg();
  const totalP   = useMemo(() => entries.reduce((s, e) => s + e.plants, 0), [entries]);

  /** Overall yield rate = good fruits / plants */
  const overallYieldRate = totalP > 0 ? totalG / totalP : 0;

  /** Overall damage rate % */
  const damagedPct = totalH > 0 ? (totalD / totalH) * 100 : 0;

  /** Revenue per kg: total sales revenue / total weight harvested */
  const totalRevenue = useMemo(() => sales.reduce((s, r) => s + r.subtotal, 0), [sales]);
  const revenuePerKg = totalW > 0 ? totalRevenue / totalW : 0;

  /** Yield per hectare = total harvest weight ÷ cultivated area (normalized to ha). */
  const cultivatedHa = useMemo(() => totalHectares(farmSections), [farmSections]);
  const yieldPerHa = cultivatedHa > 0 ? totalW / cultivatedHa : 0;

  /** Damage rate trend — per entry, sorted by date */
  const damageTrend = useMemo(() => {
    return [...entries]
      .filter((e) => e.date && e.fruitsHarvested > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({
        date: (() => { try { return format(parseISO(e.date), 'MMM d'); } catch { return e.date; } })(),
        damageRate: parseFloat(((e.damaged / e.fruitsHarvested) * 100).toFixed(1)),
        yieldRate:  parseFloat((e.plants > 0 ? (e.goodFruits / e.plants) : 0).toFixed(2)),
        weightKg:   e.weightKg,
      }));
  }, [entries]);

  /** Harvest volume (good vs damaged fruits) per entry, sorted by date. */
  const harvestVolume = useMemo(() => {
    return [...entries]
      .filter((e) => e.date)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({
        date: (() => { try { return format(parseISO(e.date), 'MMM d'); } catch { return e.date; } })(),
        good: e.goodFruits,
        damaged: e.damaged,
      }));
  }, [entries]);

  /** Total harvest weight grouped by farm block, descending. */
  const outputByBlock = useMemo(() => {
    const byBlock = new Map<string, number>();
    for (const e of entries) {
      const name = e.farmBlock?.trim() || 'Unassigned';
      byBlock.set(name, (byBlock.get(name) ?? 0) + e.weightKg);
    }
    return Array.from(byBlock.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [entries]);

  const columns: Column<ProductionEntry>[] = [
    { key: 'date',             header: 'Date',         accessor: (e) => formatDate(e.date),                                             sortValue: (e) => e.date },
    { key: 'farmBlock',        header: 'Farm Block',   accessor: (e) => e.farmBlock || '—',                                             sortValue: (e) => e.farmBlock },
    { key: 'harvestedBy',      header: 'Harvested By', accessor: (e) => e.harvestedByName || '—',                                       sortValue: (e) => e.harvestedByName ?? '' },
    { key: 'plants',           header: 'Plants',       accessor: (e) => formatNumber(e.plants, 0),                                      sortValue: (e) => e.plants },
    { key: 'fruitsHarvested',  header: 'Harvested',    accessor: (e) => formatNumber(e.fruitsHarvested, 0),                             sortValue: (e) => e.fruitsHarvested },
    { key: 'goodFruits',       header: 'Good',         accessor: (e) => <span className="text-leaf-700 font-medium">{formatNumber(e.goodFruits, 0)}</span>, sortValue: (e) => e.goodFruits },
    { key: 'damaged',          header: 'Damaged',      accessor: (e) => <span className={e.damaged > 0 ? 'text-red-500 font-medium' : 'text-gray-400'}>{formatNumber(e.damaged, 0)}</span>, sortValue: (e) => e.damaged },
    {
      key: 'yieldRate',
      header: 'Yield/Plant',
      accessor: (e) => {
        const yr = e.plants > 0 ? (e.goodFruits / e.plants).toFixed(2) : '—';
        return <span className="text-primary-700 font-medium">{yr}</span>;
      },
      sortValue: (e) => e.plants > 0 ? e.goodFruits / e.plants : 0,
    },
    {
      key: 'damageRate',
      header: 'Damage %',
      accessor: (e) => {
        const pct = e.fruitsHarvested > 0 ? ((e.damaged / e.fruitsHarvested) * 100).toFixed(1) : '0.0';
        return (
          <span className={Number(pct) > 20 ? 'text-red-600 font-bold' : Number(pct) > 10 ? 'text-orange-500' : 'text-gray-600'}>
            {pct}%
          </span>
        );
      },
      sortValue: (e) => e.fruitsHarvested > 0 ? (e.damaged / e.fruitsHarvested) * 100 : 0,
    },
    { key: 'weightKg', header: 'Weight (kg)', accessor: (e) => `${formatNumber(e.weightKg, 2)} kg`, sortValue: (e) => e.weightKg },
    {
      key: 'harvestWindow',
      header: 'Harvest Window',
      accessor: (e) => {
        const w = estimateHarvestWindow(e.floweringDate);
        if (!w) return <span className="text-gray-300">—</span>;
        const due = isInHarvestWindow(w, nowTick);
        return (
          <div className="flex flex-col gap-0.5">
            <span className={due ? 'font-semibold text-orange-700' : 'text-gray-600'}>{w.label}</span>
            {due && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-600">
                ⚠️ Ready to Harvest Fruit
              </span>
            )}
          </div>
        );
      },
      sortValue: (e) => estimateHarvestWindow(e.floweringDate)?.date ?? '',
    },
    { key: 'notes',    header: 'Notes',       accessor: (e) => <span className="text-xs text-gray-400">{e.notes || '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dragon Fruit Production"
        subtitle={`${entries.length} harvest entr${entries.length !== 1 ? 'ies' : 'y'}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Log Harvest</Button>}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Total Harvested"  value={formatNumber(totalH, 0)}        icon={Factory} iconColor="text-primary-600"  iconBg="bg-primary-50" />
        <StatCard title="Good Fruits"      value={formatNumber(totalG, 0)}        icon={Factory} iconColor="text-berry-600"   iconBg="bg-berry-50" />
        <StatCard title="Damaged"          value={`${formatNumber(totalD, 0)} (${damagedPct.toFixed(1)}%)`} icon={Factory} iconColor="text-red-500" iconBg="bg-red-50" />
        <StatCard title="Total Weight"     value={`${formatNumber(totalW, 2)} kg`} icon={Factory} iconColor="text-gold-600" iconBg="bg-gold-50" />
        <StatCard
          title="Yield Rate"
          value={`${overallYieldRate.toFixed(2)} fruits/plant`}
          subtitle="Good fruits ÷ total plants"
          icon={Factory}
          iconColor="text-primary-600"
          iconBg="bg-primary-50"
        />
        <StatCard
          title="Revenue / kg"
          value={formatPHP(revenuePerKg)}
          subtitle="Total revenue ÷ kg harvested"
          icon={Factory}
          iconColor="text-leaf-600"
          iconBg="bg-leaf-50"
        />
        <StatCard
          title="Yield per Hectare"
          value={cultivatedHa > 0 ? `${formatNumber(yieldPerHa, 0)} kg/ha` : '—'}
          subtitle="Total weight ÷ cultivated area"
          icon={Factory}
          iconColor="text-gold-600"
          iconBg="bg-gold-50"
        />
      </div>

      {/* Analytics charts */}
      {entries.length > 0 && (
        <CollapsibleSection title="Analytics" subtitle="Charts & trends" storageKey="production.analytics.collapsed">
      {damageTrend.length > 1 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Damage rate trend */}
          <SectionCard title="Damage Rate Trend (%)" subtitle="Per harvest entry over time">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={damageTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} unit="%" domain={[0, 'auto']} />
                <Tooltip
                  formatter={(v) => `${v}%`}
                  cursor={{ stroke: '#dcbcd6', strokeWidth: 1 }}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                />
                <Line
                  type="monotone"
                  dataKey="damageRate"
                  name="Damage %"
                  stroke={CHART_EXPENSE}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>

          {/* Yield rate trend */}
          <SectionCard title="Yield Rate Trend" subtitle="Good fruits per plant, per harvest">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={damageTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
                <Tooltip
                  formatter={(v) => `${v} fruits/plant`}
                  cursor={{ stroke: '#dcbcd6', strokeWidth: 1 }}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                />
                <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                <Line
                  type="monotone"
                  dataKey="yieldRate"
                  name="Yield (fruits/plant)"
                  stroke={BRAND.leaf}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="weightKg"
                  name="Weight (kg)"
                  stroke={BRAND.berry}
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="4 2"
                />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>
        </div>
      )}

      {/* Harvest volume + output-by-block charts */}
      {(
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Harvest volume over time (stacked good vs damaged) */}
          <SectionCard title="Harvest Volume Over Time" subtitle="Good vs damaged fruits per harvest entry">
            {harvestVolume.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={harvestVolume} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="date" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    formatter={(v, name) => [`${formatNumber(Number(v), 0)} fruits`, name === 'good' ? 'Good' : 'Damaged']}
                    cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                  <Bar dataKey="good" name="Good" stackId="1" fill={BRAND.leaf} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="damaged" name="Damaged" stackId="1" fill={CHART_EXPENSE} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No harvests yet.</div>
            )}
          </SectionCard>

          {/* Output by farm block */}
          <SectionCard title="Output by Farm Block" subtitle="Total harvest weight per farm block">
            {outputByBlock.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={outputByBlock} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} tickFormatter={(v) => `${v}kg`} />
                  <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={120} />
                  <Tooltip
                    formatter={(v) => `${formatNumber(Number(v), 2)} kg`}
                    cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Bar dataKey="value" name="Weight (kg)" fill={BRAND.gold} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No harvests yet.</div>
            )}
          </SectionCard>
        </div>
      )}
        </CollapsibleSection>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={Factory}
          title="No production records yet"
          description="Log your first harvest to get started."
          action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Log Harvest</Button>}
        />
      ) : (
        <Table
          data={entries}
          columns={columns}
          keyExtractor={(e) => e.id}
          searchFilter={(e, q) =>
            e.farmBlock.toLowerCase().includes(q) ||
            (e.harvestedByName ?? '').toLowerCase().includes(q) ||
            e.date.includes(q)
          }
          searchPlaceholder="Search by farm block, harvester, or date…"
          // Soft-orange highlight when a batch has entered its estimated harvest
          // window (current month + week matches), so it can't be missed.
          rowClassName={(e) =>
            isInHarvestWindow(estimateHarvestWindow(e.floweringDate), nowTick)
              ? 'bg-orange-50 hover:bg-orange-100'
              : ''
          }
          actions={(e) => <RowActions onEdit={() => crud.openEdit(e)} onDelete={() => crud.requestDelete(e)} />}
          defaultSort={{ key: 'date', dir: 'asc' }}
          getRecency={(e) => e.createdAt}
        />
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Harvest Entry' : 'Log Harvest'} size="lg">
        <ProductionForm entry={crud.editing} onClose={crud.closeModal} />
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((e) => deleteEntry(e.id))}
        message={`Delete harvest entry for ${formatDate(crud.deleteTarget?.date ?? '')}? This cannot be undone.`}
      />
    </div>
  );
}
