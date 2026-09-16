import { useMemo } from 'react';
import { Plus, Truck, Package, Phone } from 'lucide-react';
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
import { VendorForm } from './VendorForm';

export function VendorsPage() {
  const { vendors, deleteVendor, updateVendor, countBySupply } = useVendorStore();
  const crud = useListCrud<Vendor>();

  const bySupply = useMemo(() => countBySupply(), [vendors]);
  const supplyCategories = Object.keys(bySupply).length;
  const withContact = useMemo(() => vendors.filter((v) => v.phone || v.contact).length, [vendors]);
  const missingContact = vendors.length - withContact;
  const allHaveContact = vendors.length > 0 && missingContact === 0;

  const supplyText = (v: Vendor) =>
    (v.supplies ?? []).map((s) => (s.subcategory ? `${s.category} – ${s.subcategory}` : s.category)).join(', ');

  const columns: Column<Vendor>[] = [
    { key: 'vendor', header: 'Vendor', accessor: (v) => <span className="font-medium text-gray-900">{v.vendor}</span>, sortValue: (v) => v.vendor },
    { key: 'contact', header: 'Contact', accessor: (v) => v.contact || '—', sortValue: (v) => v.contact, editable: { type: 'text', getValue: (v) => v.contact } },
    { key: 'phone', header: 'Phone', accessor: (v) => v.phone || '—', sortValue: (v) => v.phone, editable: { type: 'text', getValue: (v) => v.phone } },
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
        <StatCard title="Total Vendors" value={vendors.length} icon={Truck} iconColor="text-amber-600" iconBg="bg-amber-50" />
        <StatCard title="Supply Categories" value={supplyCategories} icon={Package} iconColor="text-purple-600" iconBg="bg-purple-50" />
        <StatCard
          title="With Contact Info"
          value={`${withContact} of ${vendors.length}`}
          subtitle={allHaveContact ? 'All vendors have contact info' : `${missingContact} missing contact info`}
          icon={Phone}
          iconColor={allHaveContact ? 'text-green-600' : 'text-red-500'}
          iconBg={allHaveContact ? 'bg-green-50' : 'bg-red-50'}
        />
      </div>

      {vendors.length === 0 ? (
        <EmptyState icon={Truck} title="No vendors yet" description="Add your first vendor to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Vendor</Button>} />
      ) : (
        <Table
          data={vendors}
          columns={columns}
          keyExtractor={(v) => v.id}
          searchFilter={(v, q) =>
            v.vendor.toLowerCase().includes(q) ||
            v.contact.toLowerCase().includes(q) ||
            v.phone.includes(q) ||
            supplyText(v).toLowerCase().includes(q) ||
            v.notes.toLowerCase().includes(q)
          }
          searchPlaceholder="Search vendors…"
          actions={(v) => <RowActions onEdit={() => crud.openEdit(v)} onDelete={() => crud.requestDelete(v)} />}
          bulkActions={{ noun: 'vendor', onDelete: (rows) => rows.forEach((v) => deleteVendor(v.id)) }}
          onCellEdit={(v, key, value) => updateVendor(v.id, { [key]: value })}
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
