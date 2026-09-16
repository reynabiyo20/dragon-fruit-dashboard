import { useMemo, useState } from 'react';
import { Plus, UserCheck, Banknote, Users } from 'lucide-react';
import { useEmployeeStore, isEmployeeActive } from '../../store/employeeStore';
import type { Employee } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import { StatCard } from '../../components/ui/StatCard';
import { RowActions } from '../../components/ui/RowActions';
import { formatPHP } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { EmployeeForm } from './EmployeeForm';

type BadgeVariant = 'green' | 'blue' | 'yellow' | 'gray';

const typeVariant = (t: string): BadgeVariant => {
  if (t === 'Full Time') return 'green';
  if (t === 'Part Time') return 'blue';
  if (t === 'Contractual') return 'yellow';
  return 'gray';
};

export function EmployeesPage() {
  const { employees, deleteEmployee, updateEmployee, setActive, totalMonthlySalary, countByType } = useEmployeeStore();
  const crud = useListCrud<Employee>();

  const [showInactive, setShowInactive] = useState(false);

  const activeCount = useMemo(() => employees.filter(isEmployeeActive).length, [employees]);
  const inactiveCount = employees.length - activeCount;
  const visibleEmployees = useMemo(
    () => (showInactive ? employees : employees.filter(isEmployeeActive)),
    [employees, showInactive]
  );

  const monthlyCommitment = useMemo(() => totalMonthlySalary(), [employees]);
  const byType = useMemo(() => countByType(), [employees]);
  const commissionedCount = useMemo(() => employees.filter((e) => isEmployeeActive(e) && e.commission > 0).length, [employees]);

  const columns: Column<Employee>[] = [
    { key: 'name', header: 'Name', accessor: (e) => <span className="font-medium text-gray-900">{e.name}</span>, sortValue: (e) => e.name },
    { key: 'position', header: 'Position', accessor: (e) => e.position, sortValue: (e) => e.position },
    { key: 'employeeType', header: 'Type', accessor: (e) => <Badge label={e.employeeType} variant={typeVariant(e.employeeType)} />, sortValue: (e) => e.employeeType },
    {
      key: 'status',
      header: 'Status',
      accessor: (e) => {
        const active = isEmployeeActive(e);
        return (
          <button
            type="button"
            role="switch"
            aria-checked={active}
            onClick={() => setActive(e.id, !active)}
            title={active ? 'Active — shown in timesheet & payroll. Click to deactivate.' : 'Inactive — hidden from timesheet & payroll. Click to activate.'}
            className="inline-flex items-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-green-500 rounded-full"
          >
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                active ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  active ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </span>
            <span className={`text-xs font-medium ${active ? 'text-green-700' : 'text-gray-500'}`}>
              {active ? 'Active' : 'Inactive'}
            </span>
          </button>
        );
      },
      sortValue: (e) => (isEmployeeActive(e) ? 1 : 0),
    },
    { key: 'dailyRate', header: 'Daily Rate', accessor: (e) => formatPHP(e.dailyRate), sortValue: (e) => e.dailyRate },
    { key: 'weeklyRate', header: 'Weekly Rate', accessor: (e) => formatPHP(e.weeklyRate), sortValue: (e) => e.weeklyRate },
    { key: 'monthlySalary', header: 'Monthly Salary', accessor: (e) => <span className="font-semibold text-green-700">{formatPHP(e.monthlySalary)}</span>, sortValue: (e) => e.monthlySalary },
    { key: 'commission', header: 'Commission', accessor: (e) => e.commission > 0 ? `${e.commission}%` : '—', sortValue: (e) => e.commission },
    { key: 'notes', header: 'Notes', accessor: (e) => <span className="text-xs text-gray-400">{e.notes || '—'}</span>, sortValue: (e) => e.notes, editable: { type: 'text', getValue: (e) => e.notes } },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        subtitle={`${activeCount} active${inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ''}`}
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Add Employee</Button>}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard title="Total Employees" value={employees.length} icon={UserCheck} iconColor="text-blue-600" iconBg="bg-blue-50" />
        <StatCard title="Monthly Salary Commitment" value={formatPHP(monthlyCommitment)} subtitle="Sum of all monthly salaries" icon={Banknote} iconColor="text-green-600" iconBg="bg-green-50" />
        <StatCard title="On Commission" value={commissionedCount} subtitle="Employees with a commission %" icon={Users} iconColor="text-purple-600" iconBg="bg-purple-50" />
      </div>

      {/* Headcount by type */}
      {Object.keys(byType).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(byType).map(([type, count]) => (
            <div key={type} className="flex items-center gap-1.5 px-3 py-1 bg-white border border-gray-200 rounded-full text-sm">
              <Badge label={type} variant={typeVariant(type)} />
              <span className="text-gray-600 font-medium">{count}</span>
            </div>
          ))}
        </div>
      )}

      {inactiveCount > 0 && (
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
          />
          Show inactive ({inactiveCount})
        </label>
      )}

      {employees.length === 0 ? (
        <EmptyState icon={UserCheck} title="No employees yet" description="Add your first employee to get started." action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Employee</Button>} />
      ) : (
        <Table
          data={visibleEmployees}
          columns={columns}
          keyExtractor={(e) => e.id}
          searchFilter={(e, q) =>
            e.name.toLowerCase().includes(q) ||
            e.position.toLowerCase().includes(q) ||
            e.employeeType.toLowerCase().includes(q) ||
            e.notes.toLowerCase().includes(q)
          }
          searchPlaceholder="Search employees…"
          actions={(e) => <RowActions onEdit={() => crud.openEdit(e)} onDelete={() => crud.requestDelete(e)} />}
          onCellEdit={(e, key, value) => updateEmployee(e.id, { [key]: value })}
        />
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Employee' : 'Add Employee'} size="lg">
        <EmployeeForm employee={crud.editing} onClose={crud.closeModal} />
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((e) => deleteEmployee(e.id))}
        message={`Delete employee "${crud.deleteTarget?.name}"? This cannot be undone.`}
      />
    </div>
  );
}
