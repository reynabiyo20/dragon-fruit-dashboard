/**
 * P&L Summary — monthly profit & loss (moved here from the former Reports page).
 *
 * PHP and USD are reported in SEPARATE tables and never summed or converted.
 * Payroll is local wages only, so it appears solely in the ₱ table; the $ table
 * omits the Payroll column entirely. The $ table renders only when there is
 * international activity.
 */
import { SectionCard } from '../../../components/ui/SectionCard';
import { Badge } from '../../../components/ui/Badge';
import { formatPHP, formatUSD } from '../../../utils/format';
import type { MonthlyPnL } from '../useDashboardData';

interface PnLSummarySectionProps {
  // ₱ (local) series
  monthlyPnLPHP: MonthlyPnL[];
  revenuePHP: number;
  expensesPHP: number;
  payrollPHP: number;
  netProfitPHP: number;
  marginPHP: number;
  // $ (international) series — no payroll
  monthlyPnLUSD: MonthlyPnL[];
  revenueUSD: number;
  expensesUSD: number;
  netProfitUSD: number;
  marginUSD: number;
  hasUsdPnL: boolean;
}

/** Margin badge color: green ≥20%, yellow ≥0%, red below. */
function marginVariant(pct: number): 'green' | 'yellow' | 'red' {
  if (pct >= 20) return 'green';
  if (pct >= 0) return 'yellow';
  return 'red';
}

interface PnLTableProps {
  rows: MonthlyPnL[];
  money: (n: number) => string;
  /** Whether to include the Payroll column (₱ only). */
  withPayroll: boolean;
  totalRevenue: number;
  totalExpenses: number;
  totalPayroll: number;
  netProfit: number;
  marginPct: number;
}

function PnLTable({
  rows, money, withPayroll, totalRevenue, totalExpenses, totalPayroll, netProfit, marginPct,
}: PnLTableProps) {
  const headers = withPayroll
    ? ['Month', 'Revenue', 'Expenses', 'Payroll', 'Total Cost', 'Net Profit', 'Margin']
    : ['Month', 'Revenue', 'Expenses', 'Total Cost', 'Net Profit', 'Margin'];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-primary-50">
            {headers.map((h) => (
              <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => {
            const totalCost = row.expenses + row.payroll;
            const margin = row.revenue > 0 ? (row.profit / row.revenue) * 100 : 0;
            return (
              <tr key={row.month} className="hover:bg-primary-50/50">
                <td className="px-4 py-2.5 font-medium text-gray-900">{row.month}</td>
                <td className="px-4 py-2.5 text-leaf-700 font-medium">{money(row.revenue)}</td>
                <td className="px-4 py-2.5 text-red-600">{money(row.expenses)}</td>
                {withPayroll && <td className="px-4 py-2.5 text-gold-600">{money(row.payroll)}</td>}
                <td className="px-4 py-2.5 text-gray-700">{money(totalCost)}</td>
                <td className={`px-4 py-2.5 font-bold ${row.profit >= 0 ? 'text-leaf-700' : 'text-red-600'}`}>
                  {money(row.profit)}
                </td>
                <td className="px-4 py-2.5">
                  <Badge label={`${margin.toFixed(1)}%`} variant={marginVariant(margin)} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-primary-50 font-bold">
            <td className="px-4 py-2.5 text-gray-900">TOTAL</td>
            <td className="px-4 py-2.5 text-leaf-700">{money(totalRevenue)}</td>
            <td className="px-4 py-2.5 text-red-600">{money(totalExpenses)}</td>
            {withPayroll && <td className="px-4 py-2.5 text-gold-600">{money(totalPayroll)}</td>}
            <td className="px-4 py-2.5 text-gray-700">{money(totalExpenses + totalPayroll)}</td>
            <td className={`px-4 py-2.5 ${netProfit >= 0 ? 'text-leaf-700' : 'text-red-600'}`}>
              {money(netProfit)}
            </td>
            <td className="px-4 py-2.5">
              <Badge label={`${marginPct.toFixed(1)}%`} variant={marginVariant(marginPct)} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function PnLSummarySection({
  monthlyPnLPHP, revenuePHP, expensesPHP, payrollPHP, netProfitPHP, marginPHP,
  monthlyPnLUSD, revenueUSD, expensesUSD, netProfitUSD, marginUSD, hasUsdPnL,
}: PnLSummarySectionProps) {
  return (
    <div className="space-y-4">
      {/* Local (₱) — includes payroll */}
      <SectionCard title="P&L Summary (₱)" subtitle="Local monthly revenue, cost, and profit">
        {monthlyPnLPHP.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            No local data yet. Add ₱ sales and expenses to see your monthly P&amp;L.
          </p>
        ) : (
          <PnLTable
            rows={monthlyPnLPHP}
            money={formatPHP}
            withPayroll
            totalRevenue={revenuePHP}
            totalExpenses={expensesPHP}
            totalPayroll={payrollPHP}
            netProfit={netProfitPHP}
            marginPct={marginPHP}
          />
        )}
      </SectionCard>

      {/* International ($) — no payroll; shown only when there is USD activity */}
      {hasUsdPnL && (
        <SectionCard title="P&L Summary ($)" subtitle="International monthly revenue, cost, and profit — never converted from ₱">
          <PnLTable
            rows={monthlyPnLUSD}
            money={formatUSD}
            withPayroll={false}
            totalRevenue={revenueUSD}
            totalExpenses={expensesUSD}
            totalPayroll={0}
            netProfit={netProfitUSD}
            marginPct={marginUSD}
          />
        </SectionCard>
      )}
    </div>
  );
}
