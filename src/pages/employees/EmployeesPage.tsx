import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
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
import { UndoBar } from '../../components/ui/UndoBar';
import { BulkFieldEdit, type BulkFieldConfig } from '../../components/ui/BulkFieldEdit';
import { formatPHP } from '../../utils/format';
import { useListCrud } from '../../hooks/useListCrud';
import { useEmployeePositionStore, useEmployeeTypeStore } from '../../store/optionStores';
import { EmployeeForm } from './EmployeeForm';

/** The employee fields we support bulk-editing (drives the field descriptors). */
type BulkKey = 'position' | 'employeeType' | 'active' | 'dailyRate';

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

  // ── Cross-link focus: /employees?focus=<id> highlights that row ─────────────
  // Set when arriving from e.g. a sale's "Sold By" link. If the target employee
  // is inactive, reveal inactive rows so it's visible, then clear the param so a
  // refresh doesn't re-focus.
  const [searchParams, setSearchParams] = useSearchParams();
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    const target = searchParams.get('focus');
    if (!target) return;
    setFocusId(target);
    const emp = employees.find((e) => e.id === target);
    if (emp && !isEmployeeActive(emp)) setShowInactive(true);
    searchParams.delete('focus');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCount = useMemo(() => employees.filter(isEmployeeActive).length, [employees]);
  const inactiveCount = employees.length - activeCount;
  const visibleEmployees = useMemo(
    () => (showInactive ? employees : employees.filter(isEmployeeActive)),
    [employees, showInactive]
  );

  const monthlyCommitment = useMemo(() => totalMonthlySalary(), [employees]);
  const byType = useMemo(() => countByType(), [employees]);
  const commissionedCount = useMemo(() => employees.filter((e) => isEmployeeActive(e) && e.commission > 0).length, [employees]);

  // ── Bulk field edit (+ undo) ────────────────────────────────────────────────
  const positionOptions = useEmployeePositionStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addPosition = useEmployeePositionStore((s) => s.add);
  const typeOptions = useEmployeeTypeStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addType = useEmployeeTypeStore((s) => s.add);

  const [bulkField, setBulkField] = useState<{ key: BulkKey; config: BulkFieldConfig } | null>(null);
  const [bulkRows, setBulkRows] = useState<Employee[]>([]);
  // Shared undo: previous per-row patches (dailyRate undo also restores derived
  // weekly/monthly since updateEmployee recomputes them from dailyRate).
  const [undoSnapshot, setUndoSnapshot] = useState<{ message: string; prev: { id: string; patch: Partial<Employee> }[] } | null>(null);

  const bulkFields: { key: BulkKey; config: BulkFieldConfig }[] = [
    { key: 'position', config: { label: 'Position', type: 'creatable', options: positionOptions, onCreate: addPosition } },
    { key: 'employeeType', config: { label: 'Type', type: 'creatable', options: typeOptions, onCreate: addType } },
    { key: 'active', config: { label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }], hint: 'Inactive employees are hidden from the timesheet & payroll run.' } },
    { key: 'dailyRate', config: { label: 'Daily Rate (₱)', type: 'number', min: 0, step: '0.01', hint: 'Weekly (×5) and monthly (×20) salaries recalculate automatically.' } },
  ];

  const openBulk = (key: BulkKey, config: BulkFieldConfig, rows: Employee[]) => {
    if (rows.length === 0) return;
    setBulkField({ key, config });
    setBulkRows(rows);
  };
  const closeBulk = () => { setBulkField(null); setBulkRows([]); };

  const applyBulk = (value: string | number) => {
    if (!bulkField) return;
    const { key, config } = bulkField;
    const count = bulkRows.length;

    if (key === 'active') {
      const makeActive = value === 'active';
      const prev = bulkRows.map((e) => ({ id: e.id, patch: { active: isEmployeeActive(e) } as Partial<Employee> }));
      bulkRows.forEach((e) => setActive(e.id, makeActive));
      setUndoSnapshot({ message: `Set status to ${makeActive ? 'Active' : 'Inactive'} for ${count} employee${count !== 1 ? 's' : ''}.`, prev });
    } else if (key === 'dailyRate') {
      // Snapshot the fields updateEmployee recomputes, so undo fully restores them.
      const prev = bulkRows.map((e) => ({ id: e.id, patch: { dailyRate: e.dailyRate } as Partial<Employee> }));
      bulkRows.forEach((e) => updateEmployee(e.id, { dailyRate: Number(value) }));
      setUndoSnapshot({ message: `Set daily rate to ${formatPHP(Number(value))} for ${count} employee${count !== 1 ? 's' : ''}.`, prev });
    } else {
      const prev = bulkRows.map((e) => ({ id: e.id, patch: { [key]: e[key] } as Partial<Employee> }));
      bulkRows.forEach((e) => updateEmployee(e.id, { [key]: value } as Partial<Employee>));
      setUndoSnapshot({ message: `Set ${config.label.toLowerCase()} to "${value}" for ${count} employee${count !== 1 ? 's' : ''}.`, prev });
    }

    toast.success(`Updated ${config.label.toLowerCase()} for ${count} employee${count !== 1 ? 's' : ''}`);
    closeBulk();
  };

  const undoBulk = () => {
    if (!undoSnapshot) return;
    undoSnapshot.prev.forEach(({ id, patch }) => {
      if ('active' in patch) setActive(id, patch.active !== false);
      else updateEmployee(id, patch);
    });
    setUndoSnapshot(null);
  };

  const columns: Column<Employee>[] = [
    { key: 'name', header: 'Name', accessor: (e) => <span className="font-medium text-gray-900">{e.name}</span>, sortValue: (e) => e.name },
    { key: 'position', header: 'Position', accessor: (e) => e.position, sortValue: (e) => e.position },
    { key: 'employeeType', header: 'Type', accessor: (e) => <Badge label={e.employeeType} variant={typeVariant(e.employeeType)} />, sortValue: (e) => e.employeeType },
    { key: 'laborType', header: 'Labor', accessor: (e) => e.laborType ? <span className="text-xs font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">{e.laborType}</span> : <span className="text-gray-300">—</span>, sortValue: (e) => e.laborType ?? '' },
    { key: 'accountingClassification', header: 'Accounting', accessor: (e) => e.accountingClassification ? <span className="text-xs font-medium text-berry-700 bg-berry-50 px-2 py-0.5 rounded-full">{e.accountingClassification}</span> : <span className="text-gray-300">—</span>, sortValue: (e) => e.accountingClassification ?? '' },
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
            className="inline-flex items-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary-500 rounded-full"
          >
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                active ? 'bg-leaf-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  active ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </span>
            <span className={`text-xs font-medium ${active ? 'text-leaf-700' : 'text-gray-500'}`}>
              {active ? 'Active' : 'Inactive'}
            </span>
          </button>
        );
      },
      sortValue: (e) => (isEmployeeActive(e) ? 1 : 0),
    },
    { key: 'dailyRate', header: 'Daily Rate', accessor: (e) => formatPHP(e.dailyRate), sortValue: (e) => e.dailyRate },
    { key: 'weeklyRate', header: 'Weekly Rate', accessor: (e) => formatPHP(e.weeklyRate), sortValue: (e) => e.weeklyRate },
    { key: 'monthlySalary', header: 'Monthly Salary', accessor: (e) => <span className="font-semibold text-leaf-700">{formatPHP(e.monthlySalary)}</span>, sortValue: (e) => e.monthlySalary },
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
        <StatCard title="Total Employees" value={employees.length} subtitle={`${activeCount} active · ${inactiveCount} inactive`} icon={UserCheck} iconColor="text-berry-600" iconBg="bg-berry-50" />
        <StatCard title="Monthly Salary Commitment" value={formatPHP(monthlyCommitment)} subtitle="Sum of all monthly salaries" icon={Banknote} iconColor="text-primary-600" iconBg="bg-primary-50" />
        <StatCard title="On Commission" value={commissionedCount} subtitle="Employees with a commission %" icon={Users} iconColor="text-gold-600" iconBg="bg-gold-50" />
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
            className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
          />
          Show inactive ({inactiveCount})
        </label>
      )}

      {undoSnapshot && (
        <UndoBar
          message={undoSnapshot.message}
          onUndo={undoBulk}
          onDismiss={() => setUndoSnapshot(null)}
        />
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
            (e.laborType ?? '').toLowerCase().includes(q) ||
            (e.accountingClassification ?? '').toLowerCase().includes(q) ||
            e.notes.toLowerCase().includes(q)
          }
          searchPlaceholder="Search employees…"
          bulkActions={{
            noun: 'employee',
            actions: bulkFields.map(({ key, config }) => ({
              label: `Set ${config.label}`,
              onClick: (rows: Employee[]) => openBulk(key, config, rows),
            })),
            onDelete: (rows) => rows.forEach((e) => deleteEmployee(e.id)),
          }}
          actions={(e) => <RowActions onEdit={() => crud.openEdit(e)} onDelete={() => crud.requestDelete(e)} />}
          onCellEdit={(e, key, value) => updateEmployee(e.id, { [key]: value })}
          persistKey="employees"
          defaultSort={{ key: 'name', dir: 'asc' }}
          getRecency={(e) => e.createdAt}
          focusId={focusId}
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

      {/* Bulk-edit one field across the selected employees (undoable) */}
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
