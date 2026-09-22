import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Truck, Package, Phone, X } from 'lucide-react';
import { useVendorStore } from '../../store/vendorStore';
import type { Vendor } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { RowActions } from '../../components/ui/RowActions';
import { useListCrud } from '../../hooks/useListCrud';
import { locationLabel } from '../../constants/geography';
import { VendorForm } from './VendorForm';

/** A vendor has no contact info when it has no phone number. */
const hasNoContact = (v: Vendor): boolean => !v.phone?.trim();

export function VendorsPage() {
  const { vendors, deleteVendor, updateVendor, countBySupply } = useVendorStore();
  const crud = useListCrud<Vendor>();

  // ── Cross-link focus: /vendors?focus=<id> highlights that row ───────────────
  // Set when arriving from an expense's "Vendor" link. Clear the param after so
  // a refresh doesn't re-focus.
  const [searchParams, setSearchParams] = useSearchParams();
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    const target = searchParams.get('focus');
    if (!target) return;
    setFocusId(target);
    searchParams.delete('focus');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drilldown filter driven by the "Without Contact Info" KPI card. When
  // `?filter=no-contact` is present the table is scoped to vendors missing both
  // a phone and a contact name; a dismissible banner lets the user clear it.
  const noContactFilter = searchParams.get('filter') === 'no-contact';

  const bySupply = useMemo(() => countBySupply(), [vendors]);
  const supplyCategories = Object.keys(bySupply).length;
  const missingContact = useMemo(() => vendors.filter(hasNoContact).length, [vendors]);
  const allHaveContact = vendors.length > 0 && missingContact === 0;

  const applyNoContactFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.set('filter', 'no-contact');
    setSearchParams(next, { replace: true });
  };
  const clearFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('filter');
    setSearchParams(next, { replace: true });
  };

  const visibleVendors = useMemo(
    () => (noContactFilter ? vendors.filter(hasNoContact) : vendors),
    [vendors, noContactFilter]
  );

  const supplyText = (v: Vendor) =>
    (v.supplies ?? []).map((s) => (s.subcategory ? `${s.category} – ${s.subcategory}` : s.category)).join(', ');

  const columns: Column<Vendor>[] = [
    { key: 'vendor', header: 'Vendor', accessor: (v) => <span className="font-medium text-gray-900">{v.vendor}</span>, sortValue: (v) => v.vendor },
    { key: 'contact', header: 'Contact', accessor: (v) => v.contact || '—', sortValue: (v) => v.contact, editable: { type: 'text', getValue: (v) => v.contact } },
    { key: 'phone', header: 'Phone', accessor: (v) => v.phone || '—', sortValue: (v) => v.phone, editable: { type: 'text', getValue: (v) => v.phone } },
    { key: 'location', header: 'Location', accessor: (v) => locationLabel(v.location) || '—', sortValue: (v) => locationLabel(v.location) },
    {
      key: 'supplies',
      header: 'Supplies',
      accessor: (v) => {
        const list = v.supplies ?? [];
        if (list.length === 0) return <span className="text-xs text-gray-400">—</span>;
        return (
          <ul className="list-disc list-inside space-y-0.5">
            {list.map((s, i) => (
              <li key={i} className="text-xs text-gray-700">
                {s.category}{s.subcategory ? ` – ${s.subcategory}` : ''}
              </li>
            ))}
          </ul>
        );
      },
      sortValue: (v) => (v.supplies ?? []).length,
    },
    { key: 'notes', header: 'Notes', accessor: (v) => <span className="text-xs text-gray-400">{v.notes || '—'}</span>, sortValue: (v) => v.notes, editable: { type: 'text', getValue: (v) => v.notes } },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        subtitle={`${vendors.length} vendor${vendors.length !== 1 ? 's' : ''}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Add Vendor</Button>}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard title="Total Vendors" value={vendors.length} icon={Truck} iconColor="text-primary-600" iconBg="bg-primary-50" />
        <StatCard title="Supply Categories" value={supplyCategories} icon={Package} iconColor="text-berry-600" iconBg="bg-berry-50" />
        <StatCard
          title="Without Contact Info"
          titleColor={missingContact > 0 ? 'text-red-600' : undefined}
          valueColor={missingContact > 0 ? 'text-red-600' : undefined}
          value={`${missingContact} of ${vendors.length}`}
          subtitle={
            allHaveContact
              ? 'All vendors have contact info'
              : `${missingContact} missing contact info — click to view`
          }
          icon={Phone}
          iconColor={allHaveContact ? 'text-leaf-600' : 'text-red-500'}
          iconBg={allHaveContact ? 'bg-leaf-50' : 'bg-red-50'}
          onClick={missingContact > 0 ? applyNoContactFilter : undefined}
        />
      </div>

      {/* Active drilldown banner from the "Without Contact Info" card */}
      {noContactFilter && vendors.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          <span>
            Showing <span className="font-semibold">{missingContact}</span>{' '}
            vendor{missingContact !== 1 ? 's' : ''} without contact info.
          </span>
          <button
            type="button"
            onClick={clearFilter}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <X className="w-3.5 h-3.5" /> Clear filter
          </button>
        </div>
      )}

      {vendors.length === 0 ? (
        <EmptyState icon={Truck} title="No vendors yet" description="Add your first vendor to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Vendor</Button>} />
      ) : (
        <Table
          data={visibleVendors}
          columns={columns}
          keyExtractor={(v) => v.id}
          searchFilter={(v, q) =>
            v.vendor.toLowerCase().includes(q) ||
            v.contact.toLowerCase().includes(q) ||
            v.phone.includes(q) ||
            locationLabel(v.location).toLowerCase().includes(q) ||
            supplyText(v).toLowerCase().includes(q) ||
            v.notes.toLowerCase().includes(q)
          }
          searchPlaceholder="Search vendors…"
          actions={(v) => <RowActions onEdit={() => crud.openEdit(v)} onDelete={() => crud.requestDelete(v)} />}
          bulkActions={{ noun: 'vendor', onDelete: (rows) => rows.forEach((v) => deleteVendor(v.id)) }}
          onCellEdit={(v, key, value) => updateVendor(v.id, { [key]: value })}
          persistKey="vendors"
          defaultSort={{ key: 'vendor', dir: 'asc' }}
          getRecency={(v) => v.createdAt}
          focusId={focusId}
        />
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Vendor' : 'Add Vendor'} size="lg">
        <VendorForm vendor={crud.editing} onClose={crud.closeModal} />
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((v) => deleteVendor(v.id))}
        message={`Delete vendor "${crud.deleteTarget?.vendor}"? This cannot be undone.`}
      />
    </div>
  );
}
