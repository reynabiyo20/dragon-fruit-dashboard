import { useState, useMemo } from 'react';
import { Trash2, Banknote, Filter, CalendarDays, PlayCircle, Check, Undo2, Printer, AlertTriangle } from 'lucide-react';
import { usePayrollStore, isPayrollEntryStale, isEmptyPayrollLine } from '../../store/payrollStore';
import type { PayrollEntry } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { InputField } from '../../components/forms/FormField';
import { formatPHP, formatDate } from '../../utils/format';
import { payoutDate } from '../../utils/payroll';
import { TimesheetTab } from './TimesheetTab';
import { RunPayrollTab } from './RunPayrollTab';
import { PayslipModal } from './PayslipModal';

type PayrollView = 'entries' | 'timesheet' | 'run';
type PaidFilter = 'all' | 'unpaid' | 'paid';

export function PayrollPage() {
  const { entries, deleteEntry, totalPayroll, totalByEmployee, markPaid, markUnpaid, unpaidForEmployee } = usePayrollStore();
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
    return entries.filter((e) => {
      if (isEmptyPayrollLine(e)) return false;
      const start = e.payPeriodStart;
      const afterStart  = filterStart ? start >= filterStart : true;
      const beforeEnd   = filterEnd   ? start <= filterEnd   : true;
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

  // Per-employee totals for the filtered view
  const filteredByEmployee = useMemo(() =>
    filteredEntries.reduce<Record<string, number>>((acc, e) => {
      acc[e.employeeName] = (acc[e.employeeName] ?? 0) + e.netPay;
      return acc;
    }, {}),
    [filteredEntries]
  );

  const isFiltered = !!(filterStart || filterEnd || paidFilter !== 'all');

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
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          </span>
        ) : (
          e.daysWorked
        ),
      sortValue: (e) => e.daysWorked,
    },
    { key: 'rate',         header: 'Rate',         accessor: (e) => formatPHP(e.rate),                                                sortValue: (e) => e.rate },
    { key: 'commission',   header: 'Commission',   accessor: (e) => e.commissionAmount > 0 ? <span className="text-blue-700 font-medium">{formatPHP(e.commissionAmount)}</span> : '—', sortValue: (e) => e.commissionAmount ?? 0 },
    { key: 'bonus',        header: 'Bonus',        accessor: (e) => (e.bonus ?? 0) > 0 ? <span className="text-purple-700 font-medium">{formatPHP(e.bonus)}</span> : '—', sortValue: (e) => e.bonus ?? 0 },
    { key: 'grossPay',     header: 'Gross Pay',    accessor: (e) => formatPHP(e.grossPay),                                            sortValue: (e) => e.grossPay },
    { key: 'deductions',   header: 'Deductions',   accessor: (e) => e.deductions > 0 ? formatPHP(e.deductions) : '—',                 sortValue: (e) => e.deductions },
    { key: 'netPay',       header: 'Net Pay',      accessor: (e) => <span className="font-semibold text-green-700">{formatPHP(e.netPay)}</span>, sortValue: (e) => e.netPay },
    {
      key: 'status',
      header: 'Status',
      accessor: (e) =>
        e.paid ? (
          <div className="flex flex-col items-start">
            <button
              type="button"
              onClick={() => markUnpaid(e.id)}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-green-500"
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
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 hover:bg-yellow-200 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-green-500"
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
                ? 'border-green-600 text-green-700'
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
        <StatCard title="Total Net Payroll"      value={formatPHP(totalPayroll())}  icon={Banknote} iconColor="text-green-600" iconBg="bg-green-50" />
        <StatCard title="Outstanding (unpaid)"   value={formatPHP(outstanding)} icon={Banknote} iconColor={outstanding > 0 ? 'text-amber-600' : 'text-gray-400'} iconBg={outstanding > 0 ? 'bg-amber-50' : 'bg-gray-50'} />
        <StatCard title="Total Commissions Paid" value={formatPHP(entries.reduce((s, e) => s + (e.commissionAmount ?? 0), 0))} icon={Banknote} iconColor="text-blue-600"  iconBg="bg-blue-50" />
        <StatCard title="Total Bonuses Paid"     value={formatPHP(entries.reduce((s, e) => s + (e.bonus ?? 0), 0))} icon={Banknote} iconColor="text-purple-600" iconBg="bg-purple-50" />
      </div>

      {/* Pay period filter */}
      <SectionCard title="Filter by Pay Period" actions={
        isFiltered && (
          <Button variant="ghost" size="xs" onClick={() => { setFilterStart(''); setFilterEnd(''); setPaidFilter('all'); }}>
            Clear Filter
          </Button>
        )
      }>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">From</label>
            <input
              type="date"
              value={filterStart}
              onChange={(e) => setFilterStart(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">To</label>
            <input
              type="date"
              value={filterEnd}
              onChange={(e) => setFilterEnd(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Status</label>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {(['all', 'unpaid', 'paid'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPaidFilter(f)}
                  className={[
                    'px-3 py-1 text-sm rounded-md capitalize transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400',
                    paidFilter === f ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          {isFiltered && (
            <div className="flex gap-3 text-sm text-gray-600">
              <span><Filter className="w-4 h-4 inline mr-1 text-green-600" />{filteredEntries.length} entries</span>
              <span>Gross: <strong>{formatPHP(filteredGross)}</strong></span>
              <span>Net: <strong className="text-green-700">{formatPHP(filteredTotal)}</strong></span>
              {filteredCommissions > 0 && <span>Commissions: <strong className="text-blue-700">{formatPHP(filteredCommissions)}</strong></span>}
            </div>
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
                <Button variant="ghost" size="xs" icon={<Check className="w-3.5 h-3.5" />} onClick={() => openPay(e)} className="text-green-700 hover:bg-green-50">
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
        />
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
            <span className="font-semibold text-green-700">{formatPHP(payTarget?.netPay ?? 0)}</span> as paid.
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
