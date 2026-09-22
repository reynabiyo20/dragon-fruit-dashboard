import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Users, UserPlus, X } from 'lucide-react';
import { useCustomerStore } from '../../store/customerStore';
import type { Customer } from '../../types';
import {
  locationLabel, isInternationalLocation, countryOf,
  PROVINCE_OPTIONS, COUNTRY_OPTIONS, PHILIPPINES,
} from '../../constants/geography';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { Badge } from '../../components/ui/Badge';
import { RowActions } from '../../components/ui/RowActions';
import { useListCrud } from '../../hooks/useListCrud';
import { CustomerForm } from './CustomerForm';

/** A customer has no contact info when none of phone, email, or FB handle is set. */
const hasNoContact = (c: Customer): boolean => !(c.phone || c.email || c.fbMessengerName);

export function CustomersPage() {
  const { customers, deleteCustomer, updateCustomer } = useCustomerStore();
  const crud = useListCrud<Customer>();

  // Drilldown filter driven by the "Without Contact Info" KPI card. When
  // `?filter=no-contact` is present the table is scoped to customers missing all
  // contact channels; a dismissible banner lets the user clear it.
  const [searchParams, setSearchParams] = useSearchParams();
  const noContactFilter = searchParams.get('filter') === 'no-contact';

  const missingContact = useMemo(
    () => customers.filter(hasNoContact).length,
    [customers]
  );
  const allHaveContact = customers.length > 0 && missingContact === 0;

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

  const visibleCustomers = useMemo(
    () => (noContactFilter ? customers.filter(hasNoContact) : customers),
    [customers, noContactFilter]
  );

  const columns: Column<Customer>[] = [
    { key: 'customerName', header: 'Name', accessor: (c) => <span className="font-medium text-gray-900">{c.customerName}</span>, sortValue: (c) => c.customerName },
    {
      key: 'farmPartner',
      header: 'Farm Partner',
      // Flags a customer the business also buys from (auto-linked to Vendors).
      accessor: (c) =>
        c.farmPartner ? (
          <Badge label="Farm Partner" variant="berry" />
        ) : (
          <span className="text-gray-300">—</span>
        ),
      // Sort partners together (true first when descending).
      sortValue: (c) => (c.farmPartner ? 1 : 0),
    },
    { key: 'contactPerson', header: 'Contact Person', accessor: (c) => c.contactPerson || '—', sortValue: (c) => c.contactPerson, editable: { type: 'text', getValue: (c) => c.contactPerson } },
    { key: 'phone', header: 'Phone', accessor: (c) => c.phone || '—', sortValue: (c) => c.phone, editable: { type: 'text', getValue: (c) => c.phone } },
    { key: 'fbMessengerName', header: 'FB Handler', accessor: (c) => c.fbMessengerName || '—', sortValue: (c) => c.fbMessengerName, editable: { type: 'text', getValue: (c) => c.fbMessengerName } },
    { key: 'email', header: 'Email', accessor: (c) => c.email || '—', sortValue: (c) => c.email, editable: { type: 'text', getValue: (c) => c.email } },
    { key: 'address', header: 'Address', accessor: (c) => <span className="text-xs text-gray-500">{c.address || '—'}</span>, sortValue: (c) => c.address, editable: { type: 'text', getValue: (c) => c.address } },
    {
      key: 'location',
      header: 'Location',
      // Country for international customers, province for Philippine ones.
      accessor: (c) => {
        const label = locationLabel(c.location);
        if (!label) return <span className="text-gray-300">—</span>;
        const intl = isInternationalLocation(c.location);
        return (
          <span className={intl ? 'font-medium text-berry-700' : 'text-gray-700'}>
            {label}
            {intl && <span className="ml-1 text-[10px] uppercase tracking-wide text-berry-400">Intl</span>}
          </span>
        );
      },
      sortValue: (c) => locationLabel(c.location),
      // Inline-editable: local (PH) customers edit their Province; international
      // ones edit their Country. The commit handler folds the picked value back
      // into the structured location (see onCellEdit below).
      editable: {
        type: 'select',
        getValue: (c) =>
          isInternationalLocation(c.location) ? countryOf(c.location) : (c.location?.province ?? ''),
        options: (c) =>
          isInternationalLocation(c.location)
            ? COUNTRY_OPTIONS
            : [{ value: '', label: 'Select province…' }, ...PROVINCE_OPTIONS],
      },
    },
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
          title="Without Contact Info"
          titleColor={missingContact > 0 ? 'text-red-600' : undefined}
          valueColor={missingContact > 0 ? 'text-red-600' : undefined}
          value={`${missingContact} of ${customers.length}`}
          subtitle={
            allHaveContact
              ? 'All customers have contact info'
              : `${missingContact} missing contact info — click to view`
          }
          icon={UserPlus}
          iconColor={allHaveContact ? 'text-leaf-600' : 'text-red-500'}
          iconBg={allHaveContact ? 'bg-leaf-50' : 'bg-red-50'}
          onClick={missingContact > 0 ? applyNoContactFilter : undefined}
        />
      </div>

      {/* Active drilldown banner from the "Without Contact Info" card */}
      {noContactFilter && customers.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          <span>
            Showing <span className="font-semibold">{missingContact}</span>{' '}
            customer{missingContact !== 1 ? 's' : ''} without contact info.
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

      {customers.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" description="Add your first customer to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Customer</Button>} />
      ) : (
        <Table
          data={visibleCustomers}
          columns={columns}
          keyExtractor={(c) => c.id}
          searchFilter={(c, q) =>
            c.customerName.toLowerCase().includes(q) ||
            c.contactPerson.toLowerCase().includes(q) ||
            c.phone.includes(q) ||
            c.fbMessengerName.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q) ||
            c.address.toLowerCase().includes(q) ||
            locationLabel(c.location).toLowerCase().includes(q)
          }
          searchPlaceholder="Search customers…"
          actions={(c) => <RowActions onEdit={() => crud.openEdit(c)} onDelete={() => crud.requestDelete(c)} />}
          bulkActions={{ noun: 'customer', onDelete: (rows) => rows.forEach((c) => deleteCustomer(c.id)) }}
          onCellEdit={(c, key, value) => {
            if (key === 'location') {
              // The location cell edits a single dimension: Province for local
              // (PH) customers, Country for international ones. Fold the picked
              // value back into the structured location, clearing the
              // Philippine-only fields when the record is international and
              // resetting municipality when the province changes.
              const picked = String(value);
              const location = isInternationalLocation(c.location)
                ? { country: picked, province: '', municipality: '' }
                : { country: PHILIPPINES, province: picked, municipality: '' };
              updateCustomer(c.id, { location });
              return;
            }
            updateCustomer(c.id, { [key]: value });
          }}
          persistKey="customers"
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
