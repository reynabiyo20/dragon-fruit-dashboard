import { useMemo } from 'react';
import { Plus, Users, UserPlus } from 'lucide-react';
import { useCustomerStore } from '../../store/customerStore';
import type { Customer } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { RowActions } from '../../components/ui/RowActions';
import { useListCrud } from '../../hooks/useListCrud';
import { CustomerForm } from './CustomerForm';

export function CustomersPage() {
  const { customers, deleteCustomer, updateCustomer } = useCustomerStore();
  const crud = useListCrud<Customer>();

  const withContact = useMemo(
    () => customers.filter((c) => c.phone || c.email || c.fbMessengerName).length,
    [customers]
  );
  const missingContact = customers.length - withContact;
  const allHaveContact = customers.length > 0 && missingContact === 0;

  const columns: Column<Customer>[] = [
    { key: 'customerName', header: 'Name', accessor: (c) => <span className="font-medium text-gray-900">{c.customerName}</span>, sortValue: (c) => c.customerName },
    { key: 'contactPerson', header: 'Contact Person', accessor: (c) => c.contactPerson || '—', sortValue: (c) => c.contactPerson, editable: { type: 'text', getValue: (c) => c.contactPerson } },
    { key: 'phone', header: 'Phone', accessor: (c) => c.phone || '—', sortValue: (c) => c.phone, editable: { type: 'text', getValue: (c) => c.phone } },
    { key: 'fbMessengerName', header: 'FB Handler', accessor: (c) => c.fbMessengerName || '—', sortValue: (c) => c.fbMessengerName, editable: { type: 'text', getValue: (c) => c.fbMessengerName } },
    { key: 'email', header: 'Email', accessor: (c) => c.email || '—', sortValue: (c) => c.email, editable: { type: 'text', getValue: (c) => c.email } },
    { key: 'address', header: 'Address', accessor: (c) => <span className="text-xs text-gray-500">{c.address || '—'}</span>, sortValue: (c) => c.address, editable: { type: 'text', getValue: (c) => c.address } },
    { key: 'notes', header: 'Notes', accessor: (c) => c.notes?.trim() ? <span className="text-gray-600">{c.notes}</span> : <span className="text-gray-300">—</span>, sortValue: (c) => c.notes ?? '', editable: { type: 'text', getValue: (c) => c.notes ?? '' } },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} customer${customers.length !== 1 ? 's' : ''}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Add Customer</Button>}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard title="Total Customers" value={customers.length} icon={Users} iconColor="text-primary-600" iconBg="bg-primary-50" />
        <StatCard
          title="With Contact Info"
          value={`${withContact} of ${customers.length}`}
          subtitle={allHaveContact ? 'All customers have contact info' : `${missingContact} missing contact info`}
          icon={UserPlus}
          iconColor={allHaveContact ? 'text-leaf-600' : 'text-red-500'}
          iconBg={allHaveContact ? 'bg-leaf-50' : 'bg-red-50'}
        />
      </div>

      {customers.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" description="Add your first customer to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Customer</Button>} />
      ) : (
        <Table
          data={customers}
          columns={columns}
          keyExtractor={(c) => c.id}
          searchFilter={(c, q) =>
            c.customerName.toLowerCase().includes(q) ||
            c.contactPerson.toLowerCase().includes(q) ||
            c.phone.includes(q) ||
            c.fbMessengerName.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q) ||
            c.address.toLowerCase().includes(q)
          }
          searchPlaceholder="Search customers…"
          actions={(c) => <RowActions onEdit={() => crud.openEdit(c)} onDelete={() => crud.requestDelete(c)} />}
          bulkActions={{ noun: 'customer', onDelete: (rows) => rows.forEach((c) => deleteCustomer(c.id)) }}
          onCellEdit={(c, key, value) => updateCustomer(c.id, { [key]: value })}
          defaultSort={{ key: 'customerName', dir: 'asc' }}
          getRecency={(c) => c.createdAt}
        />
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Customer' : 'Add Customer'} size="lg">
        <CustomerForm customer={crud.editing} onClose={crud.closeModal} />
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((c) => deleteCustomer(c.id))}
        message={`Delete customer "${crud.deleteTarget?.customerName}"? This cannot be undone.`}
      />
    </div>
  );
}
