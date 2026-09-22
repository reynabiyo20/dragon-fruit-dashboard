import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, PlayCircle, AlertTriangle } from 'lucide-react';
import { format, parseISO, addDays } from 'date-fns';
import toast from 'react-hot-toast';
import { useEmployeeStore, isEmployeeActive } from '../../store/employeeStore';
import { useTimesheetStore } from '../../store/timesheetStore';
import { useCommissionStore } from '../../store/commissionStore';
import { usePayrollStore, isEmptyPayrollLine } from '../../store/payrollStore';
import type { PayrollEntry, WorkedDay } from '../../types';
import { SectionCard } from '../../components/ui/SectionCard';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatPHP } from '../../utils/format';
import { weekStart as toWeekStart, weekEnd, sumWorkedDays } from '../../utils/payroll';

/**
 * Run Payroll: pick a week, multiselect employees, and generate one draft
 * payroll entry each — days pulled from the timesheet, rate from the employee,
 * commission auto-summed from their sales in the period. Bonus/deductions are
 * editable per draft before saving the whole batch.
 */

const todayISO = () => format(new Date(), 'yyyy-MM-dd');

interface Draft {
  employeeId: string;
  employeeName: string;
  // Bookkeeping snapshot taken from the employee at generate time, so the saved
  // entry can be broken down by labor type / accounting classification.
  laborType?: string;
  accountingClassification?: string;
  workedDays: WorkedDay[];
  daysWorked: number;
  rate: number;
  commissionAmount: number;
  bonus: number;
  deductions: number;
  alreadyExists: boolean;
}

interface RunPayrollTabProps {
  onDone: () => void;
}

export function RunPayrollTab({ onDone }: RunPayrollTabProps) {
  // Subscribe to the raw array (stable ref) and derive active list via memo —
  // calling activeEmployees() in the selector returns a fresh array each read
  // and crashes zustand's snapshot check (blank screen).
  const allEmployees = useEmployeeStore((s) => s.employees);
  const employees = useMemo(() => allEmployees.filter(isEmployeeActive), [allEmployees]);
  const { getWorkedDays } = useTimesheetStore();
  const { forEmployeeInRange } = useCommissionStore();
  const { addBatch, hasEntryForPeriod } = usePayrollStore();

  const [anchor, setAnchor] = useState<string>(() => toWeekStart(todayISO()));
  const start = toWeekStart(anchor);
  const end = weekEnd(anchor);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Per-employee editable overrides for the generated drafts, keyed by employeeId
  const [drafts, setDrafts] = useState<Record<string, Draft> | null>(null);

  const shiftWeek = (deltaWeeks: number) => {
    setAnchor(format(addDays(parseISO(start), deltaWeeks * 7), 'yyyy-MM-dd'));
    setDrafts(null); // week changed → drafts stale
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setDrafts(null);
  };

  const allSelected = employees.length > 0 && selected.size === employees.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(employees.map((e) => e.id)));
    setDrafts(null);
  };

  const generate = () => {
    if (selected.size === 0) {
      toast.error('Select at least one employee');
      return;
    }
    const next: Record<string, Draft> = {};
    employees
      .filter((e) => selected.has(e.id))
      .forEach((emp) => {
        const workedDays = getWorkedDays(start, emp.id);
        const daysWorked = sumWorkedDays(workedDays);
        const commissionAmount = forEmployeeInRange(emp.id, start, end).reduce((s, c) => s + c.commissionAmount, 0);
        next[emp.id] = {
          employeeId: emp.id,
          employeeName: emp.name,
          laborType: emp.laborType,
          accountingClassification: emp.accountingClassification,
          workedDays,
          daysWorked,
          rate: emp.dailyRate,
          commissionAmount,
          bonus: 0,
          deductions: 0,
          alreadyExists: hasEntryForPeriod(emp.id, start),
        };
      });
    setDrafts(next);
  };

  const patchDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => (prev ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
  };

  const draftList = drafts ? Object.values(drafts) : [];
  // Cheap sum over a handful of drafts; no memo needed (drafts is a new array each render).
  const netOf = (d: Draft) => d.daysWorked * d.rate + d.commissionAmount + d.bonus - d.deductions;
  const grandTotal = draftList
    .filter((d) => !d.alreadyExists)
    .reduce((sum, d) => sum + netOf(d), 0);

  const save = () => {
    // Skip entries that already exist, and empty ones (no days, no
    // commission/bonus/deductions) — nothing owed, so no point generating them.
    const toSave = draftList.filter((d) => !d.alreadyExists && !isEmptyPayrollLine(d));
    if (toSave.length === 0) {
      toast.error('Nothing to generate — selected employees have no worked days or already have an entry for this week.');
      return;
    }
    const rows: Omit<PayrollEntry, 'id' | 'grossPay' | 'netPay' | 'createdAt' | 'updatedAt'>[] = toSave.map((d) => ({
      payPeriodStart: start,
      payPeriodEnd: end,
      employeeId: d.employeeId,
      employeeName: d.employeeName,
      laborType: d.laborType,
      accountingClassification: d.accountingClassification,
      daysWorked: d.daysWorked,
      workedDays: d.workedDays,
      rate: d.rate,
      deductions: d.deductions,
      commissionAmount: d.commissionAmount,
      bonus: d.bonus,
      paid: false,
      notes: '',
    }));
    addBatch(rows);
    const skipped = draftList.length - toSave.length;
    toast.success(`Generated ${toSave.length} payroll entr${toSave.length !== 1 ? 'ies' : 'y'}${skipped ? ` (${skipped} skipped — already existed or nothing owed)` : ''}`);
    onDone();
  };

  return (
    <SectionCard
      title="Run Payroll"
      subtitle="Pick a week, select employees, and generate their payroll entries in one go."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" icon={<ChevronLeft className="w-4 h-4" />} onClick={() => shiftWeek(-1)}>Prev</Button>
          <input
            type="date"
            value={anchor}
            onChange={(e) => { if (e.target.value) { setAnchor(e.target.value); setDrafts(null); } }}
            className="px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            aria-label="Pick a week"
          />
          <Button variant="ghost" size="xs" onClick={() => shiftWeek(1)}>Next<ChevronRight className="w-4 h-4" /></Button>
        </div>
      }
    >
      <p className="text-sm text-gray-500 mb-4">
        Week of {format(parseISO(start), 'MMM d')} – {format(parseISO(end), 'MMM d, yyyy')}
      </p>

      {employees.length === 0 ? (
        <EmptyState icon={PlayCircle} title="No employees yet" description="Add employees before running payroll." />
      ) : !drafts ? (
        <>
          {/* Employee multiselect */}
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
            <label className="flex items-center gap-2 px-3 py-2 cursor-pointer bg-gray-50">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500" />
              <span className="text-sm font-medium text-gray-700">Select all ({employees.length})</span>
            </label>
            {employees.map((emp) => {
              const days = sumWorkedDays(getWorkedDays(start, emp.id));
              return (
                <label key={emp.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={selected.has(emp.id)} onChange={() => toggle(emp.id)} className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500" />
                  <span className="flex-1 text-sm text-gray-700">{emp.name} <span className="text-gray-400">· {emp.position}</span></span>
                  <span className="text-xs text-gray-400">{days} day{days !== 1 ? 's' : ''} on timesheet</span>
                </label>
              );
            })}
          </div>
          <div className="flex justify-end mt-4">
            <Button icon={<PlayCircle className="w-4 h-4" />} onClick={generate}>Generate {selected.size > 0 ? `(${selected.size})` : ''}</Button>
          </div>
        </>
      ) : (
        <>
          {/* Editable draft review */}
          <div className="space-y-2">
            <div className="hidden sm:grid grid-cols-12 gap-2 px-1 text-xs font-medium text-gray-400">
              <span className="col-span-3">Employee</span>
              <span className="col-span-1">Days</span>
              <span className="col-span-2">Rate</span>
              <span className="col-span-2">Commission</span>
              <span className="col-span-1">Bonus</span>
              <span className="col-span-1">Deduct</span>
              <span className="col-span-2 text-right">Net</span>
            </div>
            {draftList.map((d) => {
              const net = netOf(d);
              return (
                <div key={d.employeeId} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-12 sm:col-span-3 min-w-0">
                    <span className="text-sm text-gray-700 truncate block">{d.employeeName}</span>
                    {d.alreadyExists && (
                      <span className="inline-flex items-center gap-1 text-xs text-gold-600">
                        <AlertTriangle className="w-3 h-3" /> already has an entry — will skip
                      </span>
                    )}
                  </div>
                  <span className="col-span-3 sm:col-span-1 text-sm text-gray-700">{d.daysWorked}</span>
                  <input type="number" step="0.01" aria-label={`Rate for ${d.employeeName}`} value={d.rate}
                    onChange={(e) => patchDraft(d.employeeId, { rate: Number(e.target.value) || 0 })}
                    className="col-span-3 sm:col-span-2 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <input type="number" step="0.01" aria-label={`Commission for ${d.employeeName}`} value={d.commissionAmount}
                    onChange={(e) => patchDraft(d.employeeId, { commissionAmount: Number(e.target.value) || 0 })}
                    className="col-span-3 sm:col-span-2 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <input type="number" step="0.01" aria-label={`Bonus for ${d.employeeName}`} value={d.bonus}
                    onChange={(e) => patchDraft(d.employeeId, { bonus: Number(e.target.value) || 0 })}
                    className="col-span-3 sm:col-span-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <input type="number" step="0.01" aria-label={`Deductions for ${d.employeeName}`} value={d.deductions}
                    onChange={(e) => patchDraft(d.employeeId, { deductions: Number(e.target.value) || 0 })}
                    className="col-span-3 sm:col-span-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <span className={`col-span-6 sm:col-span-2 text-sm text-right font-semibold ${d.alreadyExists ? 'text-gray-300 line-through' : 'text-leaf-700'}`}>
                    {formatPHP(net)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-200">
            <span className="text-sm font-semibold text-gray-900">Total net: {formatPHP(grandTotal)}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDrafts(null)}>Back</Button>
              <Button icon={<PlayCircle className="w-4 h-4" />} onClick={save}>Save entries</Button>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  );
}
