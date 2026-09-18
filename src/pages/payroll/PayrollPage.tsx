import { useState, useMemo } from 'react';
import { Trash2, Banknote, Filter, CalendarDays, PlayCircle, Check, Undo2, Printer, AlertTriangle, CircleDashed } from 'lucide-react';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { usePayrollStore, isPayrollEntryStale, isEmptyPayrollLine } from '../../store/payrollStore';
import { useTimesheetStore } from '../../store/timesheetStore';
import { useEmployeeStore } from '../../store/employeeStore';
import { useSaleStore } from '../../store/saleStore';
import { useCommissionStore } from '../../store/commissionStore';
import { useProductionStore } from '../../store/productionStore';
import type { PayrollEntry } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { InputField } from '../../components/forms/FormField';
import { UndoBar } from '../../components/ui/UndoBar';
import { PeriodFilter } from '../../components/ui/PeriodFilter';
import {
  type PeriodFilter as Period, ALL_PERIODS, availableYears,
} from '../../utils/period';
import { formatPHP, formatDate } from '../../utils/format';
import { payoutDate } from '../../utils/payroll';
import { BRAND, PIE_COLORS } from '../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../constants/chartTheme';
import { TimesheetTab } from './TimesheetTab';
import { RunPayrollTab } from './RunPayrollTab';
import { PayslipModal } from './PayslipModal';

type PayrollView = 'entries' | 'timesheet' | 'run';
type PaidFilter = 'all' | 'unpaid' | 'paid';

export function PayrollPage() {
  const { entries, deleteEntry, totalPayroll, totalByEmployee, markPaid, markUnpaid, markManyPaid, updateEntry, unpaidForEmployee } = usePayrollStore();
  const timesheetDays = useTimesheetStore((s) => s.days);
  const employees = useEmployeeStore((s) => s.employees);
  const sales = useSaleStore((s) => s.sales);
  const commissionByEmployee = useCommissionStore((s) => s.totalByEmployee);
  const productionEntries = useProductionStore((s) => s.entries);
  const [view, setView]                 = useState<PayrollView>('entries');
  const [deleteTarget, setDeleteTarget] = useState<PayrollEntry | null>(null);

  // ── Mark-paid flow: the entry being paid + the chosen pay date ──────────────
  const [payTarget, setPayTarget] = useState<PayrollEntry | null>(null);
  const [payDate, setPayDate]     = useState('');

  // ── Payslip flow: the employee whose combined payslip we're viewing ─────────
  const [payslipFor, setPayslipFor] = useState<{ id: string; name: string } | null>(null);

  // ── Pay period filter ──────────────────────────────────────────────────────
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd,   setFilterEnd]   = useState('');
  const [paidFilter,  setPaidFilter]  = useState<PaidFilter>('all');

  // ── Year+Month quick preset ─────────────────────────────────────────────────
  // A shortcut that just drives the existing filterStart/filterEnd date range so
  // we don't maintain a second, parallel filter. Picking a year+month narrows to
  // that month; year-only spans the whole year; 'all' clears the dates.
  const [period, setPeriod] = useState<Period>(ALL_PERIODS);
  const periodYears = useMemo(() => availableYears(entries.map((e) => e.payPeriodStart)), [entries]);

  const applyPeriodPreset = (next: Period) => {
    setPeriod(next);
    if (next.year === 'all') {
      setFilterStart('');
      setFilterEnd('');
      return;
    }
    if (next.month === 'all') {
      setFilterStart(`${next.year}-01-01`);
      setFilterEnd(`${next.year}-12-31`);
      return;
    }
    // Specific month: derive first/last day via date-fns to handle month lengths.
    const anchor = new Date(next.year, next.month - 1, 1);
    setFilterStart(format(startOfMonth(anchor), 'yyyy-MM-dd'));
    setFilterEnd(format(endOfMonth(anchor), 'yyyy-MM-dd'));
  };

  // ── Bulk status edit + undo ─────────────────────────────────────────────────
  // Snapshot each affected entry's previous paid state + pay date so a bulk
  // paid/unpaid change can be reverted in one click. The Undo bar shows only
  // while a snapshot exists.
  const [undoSnapshot, setUndoSnapshot] = useState<{ message: string; prev: { id: string; paid: boolean; paidDate?: string }[] } | null>(null);

  const bulkMarkPaid = (rows: PayrollEntry[]) => {
    if (rows.length === 0) return;
    const prev = rows.map((e) => ({ id: e.id, paid: !!e.paid, paidDate: e.paidDate }));
    markManyPaid(rows.map((e) => e.id));
    setUndoSnapshot({
      message: `Marked ${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'} as paid.`,
      prev,
    });
  };

  const bulkMarkUnpaid = (rows: PayrollEntry[]) => {
    if (rows.length === 0) return;
    const prev = rows.map((e) => ({ id: e.id, paid: !!e.paid, paidDate: e.paidDate }));
    rows.forEach((e) => markUnpaid(e.id));
    setUndoSnapshot({
      message: `Marked ${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'} as unpaid.`,
      prev,
    });
  };

  const undoBulk = () => {
    if (!undoSnapshot) return;
    // Restore the exact previous paid flag + pay date for each entry.
    undoSnapshot.prev.forEach(({ id, paid, paidDate }) => updateEntry(id, { paid, paidDate }));
    setUndoSnapshot(null);
  };

  const openPay = (e: PayrollEntry) => {
    setPayTarget(e);
    // Default to the pay week's Saturday, but the user can pick earlier (emergency)
    setPayDate(e.paidDate || payoutDate(e.payPeriodStart));
  };
  const confirmPay = () => {
    if (payTarget) markPaid(payTarget.id, payDate || undefined);
    setPayTarget(null);
  };

  /** Entries filtered by the optional date range + paid status.
   *  Empty entries (0 days, no commission/bonus/deductions → ₱0 net) are hidden
   *  as a backstop; Run Payroll already avoids creating them. */
  const filteredEntries = useMemo(() => {
    // Ignore an invalid end date (earlier than start) so the list still reflects
    // the valid part of the range; the UI shows a validation message alongside.
    const invalidRange = !!(filterStart && filterEnd && filterEnd < filterStart);
    const effectiveEnd = invalidRange ? '' : filterEnd;
    return entries.filter((e) => {
      if (isEmptyPayrollLine(e)) return false;
      const start = e.payPeriodStart;
      const afterStart  = filterStart  ? start >= filterStart  : true;
      const beforeEnd   = effectiveEnd ? start <= effectiveEnd : true;
      const paidMatch =
        paidFilter === 'all' ? true : paidFilter === 'paid' ? !!e.paid : !e.paid;
      return afterStart && beforeEnd && paidMatch;
    });
  }, [entries, filterStart, filterEnd, paidFilter]);

  /** Count of meaningful (non-empty) entries — matches what the ledger shows. */
  const meaningfulCount = useMemo(() => entries.filter((e) => !isEmptyPayrollLine(e)).length, [entries]);

  /** Outstanding (unpaid) net across all entries — the money still owed. */
  const outstanding = useMemo(
    () => entries.filter((e) => !e.paid).reduce((s, e) => s + e.netPay, 0),
    [entries]
  );

  const filteredTotal        = useMemo(() => filteredEntries.reduce((s, e) => s + e.netPay,   0), [filteredEntries]);
  const filteredGross        = useMemo(() => filteredEntries.reduce((s, e) => s + e.grossPay, 0), [filteredEntries]);
  const filteredCommissions  = useMemo(() => filteredEntries.reduce((s, e) => s + (e.commissionAmount ?? 0), 0), [filteredEntries]);

  const byEmployee = useMemo(() => totalByEmployee(), [entries]);

  // ── Chart data ───────────────────────────────────────────────────────────────
  /** Net pay per employee, descending, top 8. */
  const netPayByEmployee = useMemo(() =>
    Object.entries(byEmployee)
      .map(([name, value]) => ({ name, value: Number(Number(value).toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
    [byEmployee]
  );

  /** Payroll composition: base pay vs commission vs bonus across all entries. */
  const payrollComposition = useMemo(() => {
    let base = 0, commission = 0, bonus = 0;
    for (const e of entries) {
      base += (e.grossPay ?? 0) - (e.commissionAmount ?? 0) - (e.bonus ?? 0);
      commission += e.commissionAmount ?? 0;
      bonus += e.bonus ?? 0;
    }
    return [
      { name: 'Base Pay', value: Number(base.toFixed(2)) },
      { name: 'Commission', value: Number(commission.toFixed(2)) },
      { name: 'Bonus', value: Number(bonus.toFixed(2)) },
    ].filter((d) => d.value > 0);
  }, [entries]);

  // Per-employee totals for the filtered view
  const filteredByEmployee = useMemo(() =>
    filteredEntries.reduce<Record<string, number>>((acc, e) => {
      acc[e.employeeName] = (acc[e.employeeName] ?? 0) + e.netPay;
      return acc;
    }, {}),
    [filteredEntries]
  );

  // ── Attendance: total days worked per employee (from the timesheet store) ────
  // Day-map keys are `${weekStart}|${employeeId}`; sum every fraction across all
  // weeks whose key belongs to the employee. There's no "expected days" baseline,
  // so we show days worked (not a %).
  const hasTimesheetData = useMemo(
    () => Object.values(timesheetDays).some((week) => Object.keys(week).length > 0),
    [timesheetDays],
  );

  const attendanceByEmployee = useMemo(() => {
    return employees
      .map((emp) => {
        let days = 0;
        for (const [k, week] of Object.entries(timesheetDays)) {
          if (!k.endsWith(`|${emp.id}`)) continue;
          for (const fraction of Object.values(week)) days += fraction;
        }
        return { name: emp.name, value: Number(days.toFixed(1)) };
      })
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [employees, timesheetDays]);

  // ── Performance: sales revenue attributed to each salesperson ────────────────
  // Only sales tagged with a salesperson (soldByEmployeeId) count.
  const hasAttributedSales = useMemo(
    () => sales.some((s) => !!s.soldByEmployeeId),
    [sales],
  );

  const salesBySalesperson = useMemo(() => {
    const byName = new Map<string, number>();
    for (const s of sales) {
      if (!s.soldByEmployeeId) continue;
      const name = s.soldByName?.trim();
      if (!name) continue;
      byName.set(name, (byName.get(name) ?? 0) + s.subtotal);
    }
    return Array.from(byName.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [sales]);

  // ── Performance: harvest output attributed to each worker ────────────────────
  // Production entries now carry harvestedById/Name, so good-fruit output can be
  // credited to the worker who picked it.
  const hasAttributedHarvest = useMemo(
    () => productionEntries.some((e) => !!e.harvestedById),
    [productionEntries],
  );

  const harvestByWorker = useMemo(() => {
    const byName = new Map<string, number>();
    for (const e of productionEntries) {
      if (!e.harvestedById) continue;
      const name = e.harvestedByName?.trim();
      if (!name) continue;
      byName.set(name, (byName.get(name) ?? 0) + e.goodFruits);
    }
    return Array.from(byName.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [productionEntries]);

  // Commission totals per employee — surfaced in the performance tooltip context.
  const commissionTotals = useMemo(() => commissionByEmployee(), [commissionByEmployee, entries]);

  const isFiltered = !!(filterStart || filterEnd || paidFilter !== 'all');

  // Invalid when both dates are set and the end is earlier than the start.
  const dateRangeInvalid = !!(filterStart && filterEnd && filterEnd < filterStart);

  const columns: Column<PayrollEntry>[] = [
    { key: 'period',       header: 'Pay Period',   accessor: (e) => `${formatDate(e.payPeriodStart)} – ${formatDate(e.payPeriodEnd)}`, sortValue: (e) => e.payPeriodStart },
    { key: 'employeeName', header: 'Employee',     accessor: (e) => <span className="font-medium">{e.employeeName}</span>,             sortValue: (e) => e.employeeName },
    {
      key: 'daysWorked',
      header: 'Days',
      accessor: (e) =>
        isPayrollEntryStale(e) ? (
          <span className="inline-flex items-center gap-1" title="The timesheet for this week changed after this entry was generated. Delete it and re-run payroll to refresh.">
            {e.daysWorked}
            <AlertTriangle className="w-3.5 h-3.5 text-gold-500" />
          </span>
        ) : (
          e.daysWorked
        ),
      sortValue: (e) => e.daysWorked,
    },
    { key: 'rate',         header: 'Rate',         accessor: (e) => formatPHP(e.rate),                                                sortValue: (e) => e.rate },
    { key: 'commission',   header: 'Commission',   accessor: (e) => e.commissionAmount > 0 ? <span className="text-primary-700 font-medium">{formatPHP(e.commissionAmount)}</span> : '—', sortValue: (e) => e.commissionAmount ?? 0 },
    { key: 'bonus',        header: 'Bonus',        accessor: (e) => (e.bonus ?? 0) > 0 ? <span className="text-berry-700 font-medium">{formatPHP(e.bonus)}</span> : '—', sortValue: (e) => e.bonus ?? 0 },
    { key: 'grossPay',     header: 'Gross Pay',    accessor: (e) => formatPHP(e.grossPay),                                            sortValue: (e) => e.grossPay },
    { key: 'deductions',   header: 'Deductions',   accessor: (e) => e.deductions > 0 ? formatPHP(e.deductions) : '—',                 sortValue: (e) => e.deductions },
    { key: 'netPay',       header: 'Net Pay',      accessor: (e) => <span className="font-semibold text-leaf-700">{formatPHP(e.netPay)}</span>, sortValue: (e) => e.netPay },
    {
      key: 'status',
      header: 'Status',
      accessor: (e) =>
        e.paid ? (
          <div className="flex flex-col items-start">
            <button
              type="button"
              onClick={() => markUnpaid(e.id)}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-leaf-100 text-leaf-700 hover:bg-leaf-200 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500"
              title="Mark as unpaid"
              aria-label="Payment status: Paid. Click to mark as unpaid."
            >
              Paid
            </button>
            {e.paidDate && <span className="text-xs text-gray-400 mt-0.5">{formatDate(e.paidDate)}</span>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openPay(e)}
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gold-100 text-gold-700 hover:bg-gold-200 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500"
            title="Mark as paid"
            aria-label="Payment status: Unpaid. Click to mark as paid."
          >
            Unpaid
          </button>
        ),
      sortValue: (e) => (e.paid ? 1 : 0),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        subtitle={`${meaningfulCount} entr${meaningfulCount !== 1 ? 'ies' : 'y'} total`}
        actions={view === 'entries' ? <Button icon={<PlayCircle className="w-4 h-4" />} onClick={() => setView('run')}>Run Payroll</Button> : undefined}
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          { id: 'entries',   label: 'Payroll Entries', icon: Banknote },
          { id: 'timesheet', label: 'Timesheet',       icon: CalendarDays },
          { id: 'run',       label: 'Run Payroll',     icon: PlayCircle },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={[
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              view === id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {view === 'timesheet' && <TimesheetTab />}
      {view === 'run' && <RunPayrollTab onDone={() => setView('entries')} />}

      {view === 'entries' && (
      <>
      {/* Overall KPIs (all time) */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Net Payroll"      value={formatPHP(totalPayroll())}  icon={Banknote} iconColor="text-leaf-600" iconBg="bg-leaf-50" />
        <StatCard title="Outstanding (unpaid)"   value={formatPHP(outstanding)} icon={Banknote} iconColor={outstanding > 0 ? 'text-gold-600' : 'text-gray-400'} iconBg={outstanding > 0 ? 'bg-gold-50' : 'bg-gray-50'} />
        <StatCard title="Total Commissions Paid" value={formatPHP(entries.reduce((s, e) => s + (e.commissionAmount ?? 0), 0))} icon={Banknote} iconColor="text-primary-600"  iconBg="bg-primary-50" />
        <StatCard title="Total Bonuses Paid"     value={formatPHP(entries.reduce((s, e) => s + (e.bonus ?? 0), 0))} icon={Banknote} iconColor="text-berry-600" iconBg="bg-berry-50" />
      </div>

      {/* Analytics charts */}
      {entries.length > 0 && (
        <CollapsibleSection title="Analytics" subtitle="Charts & performance" storageKey="payroll.analytics.collapsed">
        <div className="space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Net pay by employee */}
          <SectionCard title="Net Pay by Employee" subtitle="Total net pay per employee (top 8)">
            {netPayByEmployee.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={netPayByEmployee} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} tickFormatter={(v) => `₱${Math.round(Number(v) / 1000)}k`} />
                  <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={120} />
                  <Tooltip
                    formatter={(v) => formatPHP(Number(v))}
                    cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Bar dataKey="value" name="Net Pay" fill={BRAND.primary} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No payroll yet.</div>
            )}
          </SectionCard>

          {/* Payroll composition */}
          <SectionCard title="Payroll Composition" subtitle="Base pay vs commission vs bonus">
            {payrollComposition.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={payrollComposition}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy={PIE_CENTER_Y}
                    innerRadius={PIE_INNER_RADIUS}
                    outerRadius={PIE_OUTER_RADIUS}
                    paddingAngle={1}
                    label={renderPieValueLabel}
                    labelLine={false}
                  >
                    {payrollComposition.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => formatPHP(Number(v))}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">No payroll yet.</div>
            )}
          </SectionCard>
        </div>

      {/* Attendance + performance charts */}
      {(hasTimesheetData || hasAttributedSales || hasAttributedHarvest) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Attendance — days worked from the timesheet */}
          {hasTimesheetData && (
            <SectionCard title="Attendance — Days Worked" subtitle="Total days recorded per employee (top 8)">
              {attendanceByEmployee.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={attendanceByEmployee} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={40} />
                    <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={120} />
                    <Tooltip
                      formatter={(v) => `${Number(v)} day${Number(v) === 1 ? '' : 's'}`}
                      cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                    />
                    <Bar dataKey="value" name="Days Worked" fill={BRAND.primary} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-sm text-gray-400">No attendance yet.</div>
              )}
            </SectionCard>
          )}

          {/* Performance — sales revenue by salesperson */}
          {hasAttributedSales && (
            <SectionCard
              title="Performance — Sales by Salesperson"
              subtitle={`Revenue attributed to each salesperson (top 8) · ${
                formatPHP(Object.values(commissionTotals).reduce((s, v) => s + v, 0))
              } commissions earned`}
            >
              {salesBySalesperson.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={salesBySalesperson} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} tickFormatter={(v) => `₱${Math.round(Number(v) / 1000)}k`} />
                    <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={120} />
                    <Tooltip
                      formatter={(v) => formatPHP(Number(v))}
                      cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                    />
                    <Bar dataKey="value" name="Sales Generated" fill={BRAND.leaf} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-sm text-gray-400">No attributed sales yet.</div>
              )}
            </SectionCard>
          )}

          {/* Performance — harvest output by worker */}
          {hasAttributedHarvest && (
            <SectionCard
              title="Performance — Harvest Output by Worker"
              subtitle="Good fruits picked, credited to each harvester (top 8)"
            >
              {harvestByWorker.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={harvestByWorker} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={40} />
                    <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={120} />
                    <Tooltip
                      formatter={(v) => `${Number(v).toLocaleString('en-US')} good fruits`}
                      cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                    />
                    <Bar dataKey="value" name="Good Fruits Harvested" fill={BRAND.gold} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-sm text-gray-400">No attributed harvest yet.</div>
              )}
            </SectionCard>
          )}
        </div>
      )}
        </div>
        </CollapsibleSection>
      )}

      {/* Pay period filter */}
      <SectionCard title="Filter by Pay Period" actions={
        isFiltered && (
          <Button variant="ghost" size="xs" onClick={() => { setFilterStart(''); setFilterEnd(''); setPaidFilter('all'); setPeriod(ALL_PERIODS); }}>
            Clear All
          </Button>
        )
      }>
        <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-gray-100">
          <PeriodFilter value={period} onChange={applyPeriodPreset} years={periodYears} label="Quick period" />
          <span className="text-xs text-gray-400">Shortcut — sets the date range below.</span>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">From</label>
            <input
              type="date"
              value={filterStart}
              // Cap the start at the current end (if set) so it can't exceed it.
              max={filterEnd || undefined}
              onChange={(e) => setFilterStart(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">To</label>
            <input
              type="date"
              value={filterEnd}
              // The end can't be earlier than the start.
              min={filterStart || undefined}
              onChange={(e) => setFilterEnd(e.target.value)}
              className={`px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                dateRangeInvalid ? 'border-red-400' : 'border-gray-300'
              }`}
            />
          </div>
          {(filterStart || filterEnd) && (
            <button
              type="button"
              onClick={() => { setFilterStart(''); setFilterEnd(''); setPeriod(ALL_PERIODS); }}
              className="text-xs font-medium text-gray-500 hover:text-gray-800 underline underline-offset-2 pb-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded"
            >
              Clear dates
            </button>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Status</label>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {(['all', 'unpaid', 'paid'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPaidFilter(f)}
                  className={[
                    'px-3 py-1 text-sm rounded-md capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                    paidFilter === f ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          {isFiltered && !dateRangeInvalid && (
            <div className="flex gap-3 text-sm text-gray-600">
              <span><Filter className="w-4 h-4 inline mr-1 text-primary-600" />{filteredEntries.length} entries</span>
              <span>Gross: <strong>{formatPHP(filteredGross)}</strong></span>
              <span>Net: <strong className="text-leaf-700">{formatPHP(filteredTotal)}</strong></span>
              {filteredCommissions > 0 && <span>Commissions: <strong className="text-primary-700">{formatPHP(filteredCommissions)}</strong></span>}
            </div>
          )}
          {dateRangeInvalid && (
            <p className="w-full text-sm text-red-600">
              The “To” date can’t be earlier than the “From” date.
            </p>
          )}
        </div>
      </SectionCard>

      {/* By-employee summary */}
      {Object.keys(isFiltered ? filteredByEmployee : byEmployee).length > 0 && (
        <SectionCard title={isFiltered ? 'Net Pay by Employee (filtered)' : 'Net Pay by Employee (all time)'}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(isFiltered ? filteredByEmployee : byEmployee).map(([name, amount]) => (
              <div key={name} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                <p className="text-xs font-medium text-gray-600 truncate">{name}</p>
                <p className="text-base font-bold text-gray-900 mt-0.5">{formatPHP(amount)}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {meaningfulCount === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No payroll entries yet"
          description="Fill the Timesheet, then use Run Payroll to generate entries."
          action={<Button onClick={() => setView('run')} icon={<PlayCircle className="w-4 h-4" />}>Run Payroll</Button>}
        />
      ) : (
        <>
        {undoSnapshot && (
          <div className="mb-4">
            <UndoBar
              message={undoSnapshot.message}
              onUndo={undoBulk}
              onDismiss={() => setUndoSnapshot(null)}
            />
          </div>
        )}
        <Table
          data={filteredEntries}
          columns={columns}
          keyExtractor={(e) => e.id}
          searchFilter={(e, q) =>
            e.employeeName.toLowerCase().includes(q) ||
            e.payPeriodStart.includes(q) ||
            e.payPeriodEnd.includes(q)
          }
          searchPlaceholder="Search by employee or date…"
          emptyMessage={isFiltered ? 'No entries match the selected period.' : 'No payroll entries yet.'}
          bulkActions={{
            noun: 'entry',
            actions: [
              { label: 'Mark Paid', icon: <Check className="w-4 h-4" />, onClick: bulkMarkPaid },
              { label: 'Mark Unpaid', icon: <CircleDashed className="w-4 h-4" />, onClick: bulkMarkUnpaid },
            ],
            onDelete: (rows) => rows.forEach((e) => deleteEntry(e.id)),
          }}
          actions={(e) => (
            <div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="xs" icon={<Printer className="w-3.5 h-3.5" />} onClick={() => setPayslipFor({ id: e.employeeId, name: e.employeeName })}>
                Payslip
              </Button>
              {e.paid ? (
                <Button variant="ghost" size="xs" icon={<Undo2 className="w-3.5 h-3.5" />} onClick={() => markUnpaid(e.id)}>
                  Unpay
                </Button>
              ) : (
                <Button variant="ghost" size="xs" icon={<Check className="w-3.5 h-3.5" />} onClick={() => openPay(e)} className="text-leaf-700 hover:bg-leaf-50">
                  Mark Paid
                </Button>
              )}
              <Button
                variant="ghost"
                size="xs"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => setDeleteTarget(e)}
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
              >
                Delete
              </Button>
            </div>
          )}
          defaultSort={{ key: 'period', dir: 'asc' }}
          getRecency={(e) => e.createdAt}
        />
        </>
      )}
      </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) { deleteEntry(deleteTarget.id); setDeleteTarget(null); } }}
        message={`Delete payroll entry for "${deleteTarget?.employeeName}"? This cannot be undone.`}
      />

      {/* Mark-paid with an editable date (defaults to the pay week's Saturday; earlier for emergencies) */}
      <Modal open={!!payTarget} onClose={() => setPayTarget(null)} title="Mark payroll paid" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Marking <span className="font-medium text-gray-900">{payTarget?.employeeName}</span>'s pay of{' '}
            <span className="font-semibold text-leaf-700">{formatPHP(payTarget?.netPay ?? 0)}</span> as paid.
          </p>
          <InputField
            label="Payment date"
            type="date"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
            hint="Defaults to the pay week's Saturday — set an earlier date if paying ahead."
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setPayTarget(null)}>Cancel</Button>
            <Button type="button" icon={<Check className="w-4 h-4" />} onClick={confirmPay}>Mark Paid</Button>
          </div>
        </div>
      </Modal>

      {payslipFor && (
        <PayslipModal
          employeeName={payslipFor.name}
          entries={unpaidForEmployee(payslipFor.id)}
          onClose={() => setPayslipFor(null)}
        />
      )}
    </div>
  );
}
