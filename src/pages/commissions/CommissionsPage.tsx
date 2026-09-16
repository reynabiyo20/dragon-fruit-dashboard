import { useMemo } from 'react';
import { Percent, TrendingUp, Users } from 'lucide-react';
import { useCommissionStore } from '../../store/commissionStore';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { Table, type Column } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatPHP, formatDate } from '../../utils/format';
import type { CommissionEntry } from '../../types';

export function CommissionsPage() {
  const { entries, totalCommissions, totalByEmployee } = useCommissionStore();

  const total = useMemo(() => totalCommissions(), [entries]);
  const byEmployee = useMemo(() => totalByEmployee(), [entries]);
  const employeeCount = Object.keys(byEmployee).length;

  const columns: Column<CommissionEntry>[] = [
    { key: 'date',          header: 'Sale Date',   accessor: (e) => formatDate(e.date),                                              sortValue: (e) => e.date },
    { key: 'employeeName',  header: 'Salesperson', accessor: (e) => <span className="font-medium text-gray-900">{e.employeeName}</span>, sortValue: (e) => e.employeeName },
    { key: 'saleAmount',    header: 'Sale Amount', accessor: (e) => formatPHP(e.saleAmount),                                         sortValue: (e) => e.saleAmount },
    { key: 'commissionPct', header: 'Rate',        accessor: (e) => `${e.commissionPct}%`,                                           sortValue: (e) => e.commissionPct },
    { key: 'commissionAmount', header: 'Commission', accessor: (e) => <span className="font-semibold text-blue-700">{formatPHP(e.commissionAmount)}</span>, sortValue: (e) => e.commissionAmount },
    { key: 'notes',         header: 'Source',      accessor: (e) => <span className="text-xs text-gray-400">{e.notes || '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commissions"
        subtitle="Auto-tracked from sales. Fed into payroll for each pay period."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Commissions"  value={formatPHP(total)}   icon={Percent}    iconColor="text-blue-600"  iconBg="bg-blue-50" />
        <StatCard title="Commissioned Sales" value={entries.length}     icon={TrendingUp} iconColor="text-green-600" iconBg="bg-green-50" />
        <StatCard title="Salespeople"        value={employeeCount}      icon={Users}      iconColor="text-purple-600" iconBg="bg-purple-50" />
      </div>

      {/* Per-employee totals */}
      {employeeCount > 0 && (
        <SectionCard title="Commissions by Salesperson">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(byEmployee).map(([name, amount]) => (
              <div key={name} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                <p className="text-xs font-medium text-gray-600 truncate">{name}</p>
                <p className="text-base font-bold text-blue-700 mt-0.5">{formatPHP(amount)}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={Percent}
          title="No commissions yet"
          description={'Record a sale and set a "Sold By" salesperson (an employee with a commission %) to start tracking commissions here.'}
        />
      ) : (
        <Table
          data={entries}
          columns={columns}
          keyExtractor={(e) => e.id}
          searchFilter={(e, q) => e.employeeName.toLowerCase().includes(q) || e.date.includes(q)}
          searchPlaceholder="Search by salesperson or date…"
        />
      )}
    </div>
  );
}
