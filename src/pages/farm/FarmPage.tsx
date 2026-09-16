import { useMemo } from 'react';
import { Plus, TreePine, Sprout } from 'lucide-react';
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
import { RowActions } from '../../components/ui/RowActions';
import { formatNumber } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { FarmForm } from './FarmForm';

export function FarmPage() {
  const { sections, deleteSection, totalArea, totalPlantCapacity, plantDensity } = useFarmStore();
  const { entries: productionEntries } = useProductionStore();
  const crud = useListCrud<FarmSection>();

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
        <span className="font-semibold text-green-700">
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
          ? <span className="text-blue-700 font-medium">{d.toFixed(2)} /sqm</span>
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
          ? <span className="text-purple-700 font-medium">{formatNumber(est, 0)} fruits</span>
          : <span className="text-gray-400 text-xs">Log harvests to estimate</span>;
      },
      sortValue: (s) => expectedHarvest(s.currentPlantCapacity) ?? 0,
    },
    { key: 'plantSubcategory', header: 'Plant Variety', accessor: (s) => s.plantSubcategory || '—', sortValue: (s) => s.plantSubcategory },
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
        <StatCard title="Total Sections"       value={sections.length}                              icon={TreePine} iconColor="text-green-600"  iconBg="bg-green-50" />
        <StatCard title="Total Area"           value={`${formatNumber(totalArea(), 0)} Sqm`}        icon={TreePine} iconColor="text-blue-600"   iconBg="bg-blue-50" />
        <StatCard title="Total Plant Capacity" value={formatNumber(totalPlantCapacity(), 0)}        icon={Sprout}   iconColor="text-purple-600" iconBg="bg-purple-50" />
        <StatCard
          title="Overall Yield Rate"
          value={overallYieldRate > 0 ? `${overallYieldRate.toFixed(2)} fruits/plant` : 'No data yet'}
          subtitle="From production history"
          icon={Sprout}
          iconColor="text-teal-600"
          iconBg="bg-teal-50"
        />
      </div>

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
                        <span className="font-medium text-blue-700">{density.toFixed(2)}/sqm</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1 border-t border-gray-200 mt-1">
                      <span className="text-gray-500">Est. Harvest</span>
                      <span className={`font-semibold ${est !== null ? 'text-purple-700' : 'text-gray-400'}`}>
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
            s.pic.toLowerCase().includes(q)
          }
          searchPlaceholder="Search farm sections…"
          actions={(s) => <RowActions onEdit={() => crud.openEdit(s)} onDelete={() => crud.requestDelete(s)} />}
        />
      )}

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
