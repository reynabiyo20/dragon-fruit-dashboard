import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, TreePine, Sprout } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useFarmStore } from '../../store/farmStore';
import { useProductionStore } from '../../store/productionStore';
import type { FarmSection } from '../../types';
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
import { BulkFieldEdit, type BulkFieldConfig } from '../../components/ui/BulkFieldEdit';
import { formatNumber, formatDate } from '../../utils/format';
import { sectionHarvestWindow, isInHarvestWindow } from '../../utils/date';
import { useNowTick } from '../../hooks/useNowTick';
import { FARM_LIFECYCLE_STAGE_OPTIONS, FARM_STAGE_FLOWERING } from '../../constants';
import { useListCrud } from '../../hooks/useListCrud';
import { BRAND } from '../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
} from '../../constants/chartTheme';
import { FarmForm } from './FarmForm';
import { StandingPlantsManager } from './StandingPlantsManager';

export function FarmPage() {
  const { sections, updateSection, deleteSection, totalArea, totalPlantCapacity, plantDensity } = useFarmStore();
  const { entries: productionEntries } = useProductionStore();
  const crud = useListCrud<FarmSection>();
  const nowTick = useNowTick();

  // ── Bulk "Set Stage" (walk-the-area lifecycle tagging) ──
  type BulkKey = 'lifecycleStage' | 'stageDate';
  const [bulkField, setBulkField] = useState<{ key: BulkKey; config: BulkFieldConfig } | null>(null);
  const [bulkRows, setBulkRows] = useState<FarmSection[]>([]);
  const [undoSnapshot, setUndoSnapshot] = useState<{ message: string; prev: { id: string; patch: Partial<FarmSection> }[] } | null>(null);

  const bulkFields: { key: BulkKey; config: BulkFieldConfig }[] = [
    { key: 'lifecycleStage', config: { label: 'Lifecycle Stage', type: 'select', options: FARM_LIFECYCLE_STAGE_OPTIONS, hint: 'Tag the stage from a quick walk-through. "Flowering" drives the area\u2019s harvest-window estimate (~30 days).' } },
    { key: 'stageDate', config: { label: 'Stage Date', type: 'date', hint: 'When this area entered the stage \u2014 the flowering date the harvest estimate counts from.' } },
  ];

  const openBulk = (key: BulkKey, config: BulkFieldConfig, rows: FarmSection[]) => {
    if (rows.length === 0) return;
    setBulkField({ key, config });
    setBulkRows(rows);
  };
  const closeBulk = () => { setBulkField(null); setBulkRows([]); };

  const applyBulk = (value: string | number) => {
    if (!bulkField) return;
    const { key, config } = bulkField;
    const count = bulkRows.length;
    const prev = bulkRows.map((s) => ({ id: s.id, patch: { [key]: s[key] } as Partial<FarmSection> }));
    bulkRows.forEach((s) => updateSection(s.id, { [key]: value } as Partial<FarmSection>));
    setUndoSnapshot({ message: `Set ${config.label.toLowerCase()} to "${value}" for ${count} section${count !== 1 ? 's' : ''}.`, prev });
    toast.success(`Updated ${config.label.toLowerCase()} for ${count} section${count !== 1 ? 's' : ''}`);
    closeBulk();
  };

  const undoBulk = () => {
    if (!undoSnapshot) return;
    undoSnapshot.prev.forEach(({ id, patch }) => updateSection(id, patch));
    setUndoSnapshot(null);
  };

  /**
   * Expected harvest estimate per section:
   * Uses the overall yield rate from production history (good fruits / total plants)
   * multiplied by the section's plant capacity.
   */
  const overallYieldRate = useMemo(() => {
    const totalPlants      = productionEntries.reduce((s, e) => s + e.plants, 0);
    const totalGoodFruits  = productionEntries.reduce((s, e) => s + e.goodFruits, 0);
    return totalPlants > 0 ? totalGoodFruits / totalPlants : 0;
  }, [productionEntries]);

  const expectedHarvest = (capacity: number) =>
    overallYieldRate > 0 ? capacity * overallYieldRate : null;

  /** Plant capacity per section, descending, for the bar chart. */
  const capacityBySection = useMemo(() =>
    sections
      .map((s) => ({
        name: s.plantSubcategory ? `${s.sectionType} · ${s.plantSubcategory}` : s.sectionType,
        value: s.currentPlantCapacity,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value),
    [sections]
  );

  const columns: Column<FarmSection>[] = [
    {
      key: 'sectionType',
      header: 'Section Type',
      accessor: (s) => <span className="font-medium text-gray-900">{s.sectionType}</span>,
      sortValue: (s) => s.sectionType,
    },
    {
      key: 'area',
      header: 'Area',
      accessor: (s) => s.area > 0 ? `${formatNumber(s.area, 0)} ${s.unit}` : <span className="text-gray-400">TBD</span>,
      sortValue: (s) => s.area,
    },
    {
      key: 'currentPlantCapacity',
      header: 'Plant Capacity',
      accessor: (s) => (
        <span className="font-semibold text-primary-700">
          {s.currentPlantCapacity > 0 ? formatNumber(s.currentPlantCapacity, 0) : <span className="text-gray-400 font-normal">TBD</span>}
        </span>
      ),
      sortValue: (s) => s.currentPlantCapacity,
    },
    {
      key: 'density',
      header: 'Plant Density',
      accessor: (s) => {
        const d = plantDensity(s.id);
        return d > 0
          ? <span className="text-primary-700 font-medium">{d.toFixed(2)} /sqm</span>
          : <span className="text-gray-400">—</span>;
      },
      sortValue: (s) => plantDensity(s.id),
    },
    {
      key: 'expectedHarvest',
      header: 'Est. Harvest',
      accessor: (s) => {
        const est = expectedHarvest(s.currentPlantCapacity);
        return est !== null
          ? <span className="text-berry-700 font-medium">{formatNumber(est, 0)} fruits</span>
          : <span className="text-gray-400 text-xs">Log harvests to estimate</span>;
      },
      sortValue: (s) => expectedHarvest(s.currentPlantCapacity) ?? 0,
    },
    { key: 'plantSubcategory', header: 'Plant Variety', accessor: (s) => s.plantSubcategory || '—', sortValue: (s) => s.plantSubcategory },
    {
      key: 'lifecycleStage',
      header: 'Stage',
      accessor: (s) => {
        if (!s.lifecycleStage) return <span className="text-gray-300">—</span>;
        const flowering = s.lifecycleStage === FARM_STAGE_FLOWERING;
        return (
          <div className="flex flex-col gap-0.5">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full w-fit ${flowering ? 'text-berry-700 bg-berry-50' : 'text-primary-700 bg-primary-50'}`}>
              {s.lifecycleStage}
            </span>
            {s.stageDate && <span className="text-xs text-gray-400">since {formatDate(s.stageDate)}</span>}
          </div>
        );
      },
      sortValue: (s) => s.lifecycleStage ?? '',
    },
    {
      key: 'harvestWindow',
      header: 'Harvest Window',
      accessor: (s) => {
        const w = sectionHarvestWindow(s);
        if (!w) return <span className="text-gray-300">—</span>;
        const due = isInHarvestWindow(w, nowTick);
        return (
          <div className="flex flex-col gap-0.5">
            <span className={due ? 'font-semibold text-orange-700' : 'text-gray-600'}>{w.label}</span>
            {due && <span className="text-xs font-bold text-orange-600">⚠️ Fruiting window</span>}
          </div>
        );
      },
      sortValue: (s) => sectionHarvestWindow(s)?.date ?? '',
    },
    { key: 'pic',          header: 'PIC',            accessor: (s) => s.pic || '—',          sortValue: (s) => s.pic },
    { key: 'notes',        header: 'Notes',          accessor: (s) => <span className="text-xs text-gray-400">{s.notes || '—'}</span>, sortValue: (s) => s.notes },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Farm Information"
        subtitle={`${sections.length} section${sections.length !== 1 ? 's' : ''}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Add Section</Button>}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard title="Total Sections"       value={sections.length}                              icon={TreePine} iconColor="text-primary-600"  iconBg="bg-primary-50" />
        <StatCard title="Total Area"           value={`${formatNumber(totalArea(), 0)} Sqm`}        icon={TreePine} iconColor="text-berry-600"   iconBg="bg-berry-50" />
        <StatCard title="Total Plant Capacity" value={formatNumber(totalPlantCapacity(), 0)}        icon={Sprout}   iconColor="text-gold-600" iconBg="bg-gold-50" />
        <StatCard
          title="Overall Yield Rate"
          value={overallYieldRate > 0 ? `${overallYieldRate.toFixed(2)} fruits/plant` : 'No data yet'}
          subtitle="From production history"
          icon={Sprout}
          iconColor="text-leaf-600"
          iconBg="bg-leaf-50"
        />
      </div>

      {/* Plant capacity by section chart */}
      {sections.length > 0 && capacityBySection.length > 0 && (
        <CollapsibleSection title="Analytics" subtitle="Charts" storageKey="farm.analytics.collapsed">
        <SectionCard title="Plant Capacity by Section" subtitle="Current plant capacity across farm sections">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={capacityBySection} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                formatter={(v) => `${formatNumber(Number(v), 0)} plants`}
                cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
              />
              <Bar dataKey="value" name="Plant Capacity" fill={BRAND.leaf} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
        </CollapsibleSection>
      )}

      {/* Section density + harvest estimate cards */}
      {sections.filter(s => s.currentPlantCapacity > 0).length > 0 && (
        <SectionCard
          title="Section Overview"
          subtitle={overallYieldRate > 0
            ? `Estimated harvest based on ${overallYieldRate.toFixed(2)} fruits/plant yield rate from production history`
            : 'Log harvest data on the Production page to enable estimated harvest calculations'}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sections.filter(s => s.currentPlantCapacity > 0).map((sec) => {
              const density = plantDensity(sec.id);
              const est     = expectedHarvest(sec.currentPlantCapacity);
              return (
                <div key={sec.id} className="border border-gray-100 rounded-xl p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-gray-800">{sec.sectionType}</span>
                    {sec.pic && <span className="text-xs text-gray-500">PIC: {sec.pic}</span>}
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Plants</span>
                      <span className="font-medium">{formatNumber(sec.currentPlantCapacity, 0)}</span>
                    </div>
                    {sec.area > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Area</span>
                        <span className="font-medium">{formatNumber(sec.area, 0)} {sec.unit}</span>
                      </div>
                    )}
                    {density > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Density</span>
                        <span className="font-medium text-primary-700">{density.toFixed(2)}/sqm</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1 border-t border-gray-200 mt-1">
                      <span className="text-gray-500">Est. Harvest</span>
                      <span className={`font-semibold ${est !== null ? 'text-berry-700' : 'text-gray-400'}`}>
                        {est !== null ? `${formatNumber(est, 0)} fruits` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {sections.length === 0 ? (
        <EmptyState
          icon={TreePine}
          title="No farm sections yet"
          description="Add farm sections to track your land and plant capacity."
          action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Section</Button>}
        />
      ) : (
        <Table
          data={sections}
          columns={columns}
          keyExtractor={(s) => s.id}
          searchFilter={(s, q) =>
            s.sectionType.toLowerCase().includes(q) ||
            s.plantSubcategory.toLowerCase().includes(q) ||
            (s.lifecycleStage ?? '').toLowerCase().includes(q) ||
            s.pic.toLowerCase().includes(q)
          }
          searchPlaceholder="Search by section, variety, stage, or PIC…"
          // Soft-orange highlight when a flowering area has entered its estimated
          // fruiting window, so the team knows to check it for harvest.
          rowClassName={(s) =>
            isInHarvestWindow(sectionHarvestWindow(s), nowTick)
              ? 'bg-orange-50 hover:bg-orange-100'
              : ''
          }
          bulkActions={{
            noun: 'section',
            actions: bulkFields.map(({ key, config }) => ({
              label: `Set ${config.label}`,
              onClick: (rows: FarmSection[]) => openBulk(key, config, rows),
            })),
          }}
          actions={(s) => <RowActions onEdit={() => crud.openEdit(s)} onDelete={() => crud.requestDelete(s)} />}
        />
      )}

      {undoSnapshot && (
        <UndoBar
          message={undoSnapshot.message}
          onUndo={undoBulk}
          onDismiss={() => setUndoSnapshot(null)}
        />
      )}

      {/* Bulk-tag lifecycle stage / stage date across selected sections (undoable) */}
      <BulkFieldEdit
        open={!!bulkField}
        onClose={closeBulk}
        field={bulkField?.config ?? null}
        count={bulkRows.length}
        onApply={applyBulk}
      />

      {/* Standing plants — the actual orchard feeding the supply forecast */}
      <StandingPlantsManager />

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Farm Section' : 'Add Farm Section'} size="lg">
        <FarmForm section={crud.editing} onClose={crud.closeModal} />
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((s) => deleteSection(s.id))}
        message={`Delete section "${crud.deleteTarget?.sectionType}"? This cannot be undone.`}
      />
    </div>
  );
}
