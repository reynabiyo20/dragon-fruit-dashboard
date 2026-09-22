import { useState } from 'react';
import { Plus, Sprout } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFarmStore } from '../../store/farmStore';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import type { StandingPlanting } from '../../types';
import { SectionCard } from '../../components/ui/SectionCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { InputField, SelectField, TextareaField, CheckboxField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { RowActions } from '../../components/ui/RowActions';
import { useListCrud } from '../../hooks/useListCrud';
import { formatNumber, formatDate } from '../../utils/format';
import { todayISO } from '../../utils/date';
import { CUTTINGS_PRODUCT_TYPE, CUTTING_TYPE_OPTIONS, CUTTING_TYPE_GRAFTED } from '../../constants';
import { ENTITY, toastSuccess } from '../../constants/messages';

/**
 * Manages the actual standing dragon-fruit plants (variety × section) — the real
 * orchard the wholesale forecast's "farm" pool projects from. Full add/edit/
 * delete. Deleting a section elsewhere cascades its plantings away (farmStore).
 */

interface FormState {
  sectionId: string;
  subcategory: string;
  cuttingType: string;
  plantCount: string;
  plantedDate: string;
  matureFruiting: boolean;
  notes: string;
}

const emptyForm = (): FormState => ({
  sectionId: '',
  subcategory: '',
  cuttingType: CUTTING_TYPE_GRAFTED,
  plantCount: '',
  plantedDate: todayISO(),
  matureFruiting: false,
  notes: '',
});

export function StandingPlantsManager() {
  const { sections, plantings, addPlanting, updatePlanting, deletePlanting, getSection } = useFarmStore();
  // Varieties come from the shared product taxonomy (Cuttings/Fruit varieties).
  const categoryEntries = useProductCategoryStore((s) => s.entries);
  const varietyOptions = [
    ...new Set(
      categoryEntries
        .filter((e) => e.subcategory !== '')
        .map((e) => e.subcategory),
    ),
  ]
    .sort()
    .map((v) => ({ value: v, label: v }));

  const crud = useListCrud<StandingPlanting>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState('');

  const sectionOptions = sections.map((s) => ({
    value: s.id,
    label: s.plantSubcategory ? `${s.sectionType} · ${s.plantSubcategory}` : s.sectionType,
  }));

  const sectionLabel = (sectionId: string) => {
    const sec = getSection(sectionId);
    if (!sec) return '— (section removed)';
    return sec.plantSubcategory ? `${sec.sectionType} · ${sec.plantSubcategory}` : sec.sectionType;
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...emptyForm(), sectionId: sections[0]?.id ?? '' });
    setError('');
    setModalOpen(true);
  };

  const openEdit = (p: StandingPlanting) => {
    setEditingId(p.id);
    setForm({
      sectionId: p.sectionId,
      subcategory: p.subcategory,
      cuttingType: p.cuttingType ?? CUTTING_TYPE_GRAFTED,
      plantCount: String(p.plantCount),
      plantedDate: p.plantedDate ?? '',
      matureFruiting: !!p.matureFruiting,
      notes: p.notes ?? '',
    });
    setError('');
    setModalOpen(true);
  };

  const handleSave = () => {
    const sectionId = form.sectionId.trim();
    const subcategory = form.subcategory.trim();
    const plantCount = Number(form.plantCount) || 0;
    if (!sectionId) { setError('Pick a section'); return; }
    if (!subcategory) { setError('Pick a variety'); return; }
    if (plantCount <= 0) { setError('Plant count must be greater than 0'); return; }

    // Keep the taxonomy in step so a newly-typed variety shows everywhere.
    syncTaxonomy(CUTTINGS_PRODUCT_TYPE, subcategory);

    const payload = {
      sectionId,
      subcategory,
      cuttingType: form.cuttingType,
      plantCount,
      plantedDate: form.plantedDate || undefined,
      matureFruiting: form.matureFruiting,
      notes: form.notes,
    };

    if (editingId) {
      updatePlanting(editingId, payload);
      toast.success(toastSuccess(ENTITY.standingPlants, 'updated'));
    } else {
      addPlanting(payload);
      toast.success(toastSuccess(ENTITY.standingPlants, 'created'));
    }
    setModalOpen(false);
  };

  const totalPlants = plantings.reduce((sum, p) => sum + (Number(p.plantCount) || 0), 0);

  return (
    <SectionCard
      title="Standing Plants (Actual Orchard)"
      subtitle={
        plantings.length > 0
          ? `${formatNumber(totalPlants, 0)} living plants across ${plantings.length} planting(s) · feeds the wholesale supply forecast`
          : 'Record the dragon-fruit plants actually growing — these drive the wholesale supply forecast'
      }
      actions={
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={openAdd} disabled={sections.length === 0}>
          Add Plants
        </Button>
      }
    >
      {sections.length === 0 ? (
        <p className="text-xs text-gray-400">Add a farm section first, then record the plants standing in it.</p>
      ) : plantings.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title="No standing plants recorded"
          description="Add the dragon-fruit plants already growing in your sections so the supply forecast reflects your real orchard."
          action={<Button onClick={openAdd} icon={<Plus className="w-4 h-4" />}>Add Plants</Button>}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary-100 bg-primary-50">
                {['Section', 'Variety', 'Type', 'Plants', 'Planted', 'Status', ''].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {plantings.map((p) => (
                <tr key={p.id} className="hover:bg-primary-50/50">
                  <td className="px-3 py-2 text-gray-700">{sectionLabel(p.sectionId)}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{p.subcategory}</td>
                  <td className="px-3 py-2 text-gray-500">{p.cuttingType ?? '—'}</td>
                  <td className="px-3 py-2 font-semibold text-leaf-700">{formatNumber(p.plantCount, 0)}</td>
                  <td className="px-3 py-2 text-gray-500">{p.plantedDate ? formatDate(p.plantedDate) : '—'}</td>
                  <td className="px-3 py-2">
                    {p.matureFruiting ? (
                      <span className="text-xs font-medium text-leaf-700 bg-leaf-50 px-2 py-0.5 rounded-full">Fruiting</span>
                    ) : (
                      <span className="text-xs font-medium text-gold-700 bg-gold-50 px-2 py-0.5 rounded-full">Establishing</span>
                    )}
                    {p.sourceBatchId && <span className="ml-1 text-[10px] text-gray-400">from batch</span>}
                  </td>
                  <td className="px-3 py-2">
                    <RowActions onEdit={() => openEdit(p)} onDelete={() => crud.requestDelete(p)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Standing Plants' : 'Add Standing Plants'} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SelectField
              label="Section"
              required
              options={sectionOptions}
              placeholder="Select section…"
              value={form.sectionId}
              onChange={(e) => { setForm((f) => ({ ...f, sectionId: e.target.value })); setError(''); }}
            />
            <CreatableSelect
              label="Variety"
              required
              options={varietyOptions}
              placeholder="Select or add…"
              value={form.subcategory}
              onChange={(v) => { setForm((f) => ({ ...f, subcategory: v })); setError(''); }}
              onCreate={(v) => { syncTaxonomy(CUTTINGS_PRODUCT_TYPE, v); setForm((f) => ({ ...f, subcategory: v })); setError(''); }}
              createLabel="+ Add new variety…"
              newFieldLabel="New Variety"
              newFieldPlaceholder="e.g. Thai White"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Number of Plants"
              required
              type="number"
              step="1"
              value={form.plantCount}
              onChange={(e) => { setForm((f) => ({ ...f, plantCount: e.target.value })); setError(''); }}
              placeholder="e.g. 400"
            />
            <SelectField
              label="Cutting Type"
              options={CUTTING_TYPE_OPTIONS}
              value={form.cuttingType}
              onChange={(e) => setForm((f) => ({ ...f, cuttingType: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Planted Date"
              type="date"
              value={form.plantedDate}
              onChange={(e) => setForm((f) => ({ ...f, plantedDate: e.target.value }))}
              hint="When they went in the ground (drives first-harvest timing)"
            />
            <div className="flex items-end pb-2">
              <CheckboxField
                label="Already mature & fruiting"
                checked={form.matureFruiting}
                onChange={(checked) => setForm((f) => ({ ...f, matureFruiting: checked }))}
                hint="On for pre-existing plants already producing — forecast projects the next season."
              />
            </div>
          </div>

          <TextareaField label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingId ? 'Save Changes' : 'Add Plants'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((p) => deletePlanting(p.id))}
        title="Remove standing plants"
        message={`Remove ${crud.deleteTarget ? formatNumber(crud.deleteTarget.plantCount, 0) : ''} ${crud.deleteTarget?.subcategory ?? ''} plant(s)? This lowers the supply forecast and can't be undone.`}
        confirmLabel="Remove"
      />
    </SectionCard>
  );
}
