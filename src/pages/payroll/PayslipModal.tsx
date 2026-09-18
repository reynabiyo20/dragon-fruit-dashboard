import { useState, useEffect, useMemo } from 'react';
import { Printer, Check } from 'lucide-react';
import type { PayrollEntry } from '../../types';
import { usePayrollStore } from '../../store/payrollStore';
import { useBusinessStore } from '../../store/businessStore';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { InputField } from '../../components/forms/FormField';
import { formatPHP, formatDate, formatPayPeriod } from '../../utils/format';
import { todayISO } from '../../utils/date';
import { payoutDate, sumWorkedDays } from '../../utils/payroll';

/**
 * Combined payslip for one employee across one or more (unpaid) pay periods.
 * The user picks which periods to include; the slip prints a per-week breakdown
 * plus a grand total. Marking it paid flips every included entry to paid.
 */

interface PayslipModalProps {
  employeeName: string;
  /** Entries to offer for this employee (typically their unpaid ones). */
  entries: PayrollEntry[];
  onClose: () => void;
}

/** Describe an entry's worked days, e.g. "5 days (incl. 1 half-day)". */
function daysLabel(e: PayrollEntry): string {
  const total = e.workedDays && e.workedDays.length ? sumWorkedDays(e.workedDays) : e.daysWorked;
  const halves = (e.workedDays ?? []).filter((d) => d.fraction === 0.5).length;
  const base = `${total} day${total !== 1 ? 's' : ''}`;
  return halves > 0 ? `${base} (incl. ${halves} half-day${halves !== 1 ? 's' : ''})` : base;
}

export function PayslipModal({ employeeName, entries, onClose }: PayslipModalProps) {
  const { markManyPaid } = usePayrollStore();
  const business = useBusinessStore((s) => s.info);

  // Default: include every offered (unpaid) period.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(entries.map((e) => e.id)));
  const [payDate, setPayDate] = useState('');

  useEffect(() => {
    // Default the payout date to the Saturday of the latest included period.
    const included = entries.filter((e) => selected.has(e.id));
    const latest = included.reduce<string>((max, e) => (e.payPeriodStart > max ? e.payPeriodStart : max), '');
    setPayDate(latest ? payoutDate(latest) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const included = useMemo(
    () => entries.filter((e) => selected.has(e.id)).sort((a, b) => a.payPeriodStart.localeCompare(b.payPeriodStart)),
    [entries, selected]
  );

  const totals = useMemo(() => {
    return included.reduce(
      (acc, e) => ({
        gross: acc.gross + e.grossPay,
        commission: acc.commission + (e.commissionAmount ?? 0),
        bonus: acc.bonus + (e.bonus ?? 0),
        deductions: acc.deductions + e.deductions,
        net: acc.net + e.netPay,
      }),
      { gross: 0, commission: 0, bonus: 0, deductions: 0, net: 0 }
    );
  }, [included]);

  const handlePrint = () => {
    document.body.classList.add('payslip-printing');
    const cleanup = () => {
      document.body.classList.remove('payslip-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  const markPaid = () => {
    if (included.length === 0) return;
    markManyPaid(included.map((e) => e.id), payDate || undefined);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Payslip — ${employeeName}`} size="2xl">
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500">No unpaid periods for this employee.</p>
      ) : (
        <div className="space-y-4">
          {/* Period selector (hidden when printing) */}
          <div className="print:hidden">
            <p className="text-xs font-medium text-gray-500 mb-2">Include periods</p>
            <div className="flex flex-wrap gap-2">
              {entries
                .slice()
                .sort((a, b) => a.payPeriodStart.localeCompare(b.payPeriodStart))
                .map((e) => (
                  <label key={e.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-gray-200 text-xs cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                      className="w-3.5 h-3.5 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    {formatPayPeriod(e.payPeriodStart, e.payPeriodEnd)} · {formatPHP(e.netPay)}
                  </label>
                ))}
            </div>
          </div>

          {/* Printable payslip */}
          <div id="payslip-print" className="rounded-lg border border-gray-200 p-5 bg-white">
            {/* Header */}
            <div className="flex justify-between items-start border-b border-gray-200 pb-3 mb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{business.businessName}</h3>
                <p className="text-xs text-gray-500">{business.farmAddress}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">PAYSLIP</p>
                <p className="text-xs text-gray-500">Issued {formatDate(todayISO())}</p>
              </div>
            </div>

            {/* Employee + summary line */}
            <div className="flex justify-between text-sm mb-3">
              <div>
                <p className="text-gray-500 text-xs">Employee</p>
                <p className="font-medium text-gray-900">{employeeName}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-500 text-xs">Periods</p>
                <p className="font-medium text-gray-900">{included.length}</p>
              </div>
            </div>

            {/* Per-period breakdown */}
            <table className="w-full text-sm mb-3">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 text-left">
                  <th className="py-1.5 pr-2 font-medium">Pay Period</th>
                  <th className="py-1.5 pr-2 font-medium">Days</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Rate</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Commission</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Bonus</th>
                  <th className="py-1.5 pr-2 font-medium text-right">Deductions</th>
                  <th className="py-1.5 font-medium text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {included.map((e) => (
                  <tr key={e.id} className="payslip-block">
                    <td className="py-1.5 pr-2 text-gray-700">{formatPayPeriod(e.payPeriodStart, e.payPeriodEnd)}</td>
                    <td className="py-1.5 pr-2 text-gray-600">{daysLabel(e)}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-600">{formatPHP(e.rate)}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-600">{(e.commissionAmount ?? 0) > 0 ? formatPHP(e.commissionAmount) : '—'}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-600">{(e.bonus ?? 0) > 0 ? formatPHP(e.bonus) : '—'}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-600">{e.deductions > 0 ? formatPHP(e.deductions) : '—'}</td>
                    <td className="py-1.5 text-right font-medium text-gray-900">{formatPHP(e.netPay)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 font-semibold">
                  <td className="py-2 pr-2 text-gray-900" colSpan={3}>TOTAL</td>
                  <td className="py-2 pr-2 text-right text-gray-700">{totals.commission > 0 ? formatPHP(totals.commission) : '—'}</td>
                  <td className="py-2 pr-2 text-right text-gray-700">{totals.bonus > 0 ? formatPHP(totals.bonus) : '—'}</td>
                  <td className="py-2 pr-2 text-right text-gray-700">{totals.deductions > 0 ? formatPHP(totals.deductions) : '—'}</td>
                  <td className="py-2 text-right text-leaf-700">{formatPHP(totals.net)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="flex justify-between items-center bg-leaf-50 rounded-lg px-4 py-3">
              <span className="text-sm font-medium text-gray-700">Total Net Pay</span>
              <span className="text-xl font-bold text-leaf-700">{formatPHP(totals.net)}</span>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-8 text-xs text-gray-500">
              <div>
                <div className="border-t border-gray-300 pt-1">Received by (employee signature)</div>
              </div>
              <div>
                <div className="border-t border-gray-300 pt-1">Prepared by</div>
              </div>
            </div>
          </div>

          {/* Actions (hidden when printing) */}
          <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
            <div className="w-44">
              <InputField
                label="Payment date"
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                hint="Used when marking paid"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" type="button" icon={<Printer className="w-4 h-4" />} onClick={handlePrint}>
                Print
              </Button>
              <Button
                type="button"
                icon={<Check className="w-4 h-4" />}
                onClick={markPaid}
                disabled={included.length === 0}
              >
                Mark {included.length} paid
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
