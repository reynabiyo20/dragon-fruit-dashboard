import { useMemo } from 'react';
import { Percent, TrendingUp, Users } from 'lucide-react';
import { format, parseISO, startOfMonth } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useCommissionStore } from '../../store/commissionStore';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { Table, type Column } from '../../components/ui/Table';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatPHP, formatDate } from '../../utils/format';
import type { CommissionEntry } from '../../types';
import { BRAND, PIE_COLORS } from '../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
} from '../../constants/chartTheme';

export function CommissionsPage() {
  const { entries, totalCommissions, totalByEmployee } = useCommissionStore();

  const total = useMemo(() => totalCommissions(), [entries]);
  const byEmployee = useMemo(() => totalByEmployee(), [entries]);
  const employeeCount = Object.keys(byEmployee).length;

  /** Commission total per salesperson, descending. */
  const commissionByEmployee = useMemo(() =>
    Object.entries(byEmployee)
      .map(([name, value]) => ({ name, value: Number(Number(value).toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value),
    [byEmployee]
  );

  /**
   * Commission per employee, grouped by month: one row per calendar month, with
   * a numeric column per employee. Bars are grouped (no stackId) so each
   * salesperson reads side by side. Limited to the top 5 employees by total
   * commission to keep the legend + bar clusters readable.
   */
  const monthlyByEmployee = useMemo(() => {
    // Distinct top employees by total commission.
    const topEmployees = Object.entries(byEmployee)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 5)
      .map(([name]) => name);
    const topSet = new Set(topEmployees);

    // month key (sortable) → { month label, per-employee sums }.
    const byMonth = new Map<string, { key: string; month: string; sums: Record<string, number> }>();
    for (const e of entries) {
      if (!e.date || !topSet.has(e.employeeName)) continue;
      let key: string;
      let month: string;
      try {
        const start = startOfMonth(parseISO(e.date));
        key = format(start, 'yyyy-MM');
        month = format(start, 'MMM yyyy');
      } catch {
        continue;
      }
      let row = byMonth.get(key);
      if (!row) {
        row = { key, month, sums: {} };
        byMonth.set(key, row);
      }
      row.sums[e.employeeName] = (row.sums[e.employeeName] ?? 0) + e.commissionAmount;
    }

    const data = Array.from(byMonth.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row) => {
        const out: Record<string, number | string> = { month: row.month };
        for (const name of topEmployees) {
          out[name] = Number((row.sums[name] ?? 0).toFixed(2));
        }
        return out;
      });

    return { data, employees: topEmployees };
  }, [entries, byEmployee]);

  const columns: Column<CommissionEntry>[] = [
    { key: 'date',          header: 'Sale Date',   accessor: (e) => formatDate(e.date),                                              sortValue: (e) => e.date },
    { key: 'employeeName',  header: 'Salesperson', accessor: (e) => <span className="font-medium text-gray-900">{e.employeeName}</span>, sortValue: (e) => e.employeeName },
    { key: 'saleAmount',    header: 'Sale Amount', accessor: (e) => formatPHP(e.saleAmount),                                         sortValue: (e) => e.saleAmount },
    { key: 'commissionPct', header: 'Rate',        accessor: (e) => `${e.commissionPct}%`,                                           sortValue: (e) => e.commissionPct },
    { key: 'commissionAmount', header: 'Commission', accessor: (e) => <span className="font-semibold text-primary-700">{formatPHP(e.commissionAmount)}</span>, sortValue: (e) => e.commissionAmount },
    { key: 'notes',         header: 'Source',      accessor: (e) => <span className="text-xs text-gray-400">{e.notes || '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commissions"
        subtitle="Auto-tracked from sales. Fed into payroll for each pay period."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Commissions"  value={formatPHP(total)}   icon={Percent}    iconColor="text-primary-600"  iconBg="bg-primary-50" />
        <StatCard title="Commissioned Sales" value={entries.length}     icon={TrendingUp} iconColor="text-berry-600" iconBg="bg-berry-50" />
        <StatCard title="Salespeople"        value={employeeCount}      icon={Users}      iconColor="text-gold-600" iconBg="bg-gold-50" />
      </div>

      {/* Analytics charts */}
      {entries.length > 0 && (
        <CollapsibleSection title="Analytics" subtitle="Charts" storageKey="commissions.analytics.collapsed">
      {/* Commission by salesperson chart */}
      {commissionByEmployee.length > 0 && (
        <SectionCard title="Commission by Salesperson" subtitle="Total commission earned per salesperson">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={commissionByEmployee} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
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
              <Bar dataKey="value" name="Commission" fill={BRAND.gold} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      )}

      {/* Commission per employee by month (grouped) */}
      {(
        <SectionCard title="Commission per Employee by Month" subtitle="Monthly commission per salesperson (top 5)">
          {monthlyByEmployee.data.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyByEmployee.data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="month" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `₱${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  formatter={(v) => formatPHP(Number(v))}
                  cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                />
                <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                {monthlyByEmployee.employees.map((name, i) => (
                  <Bar key={name} dataKey={name} name={name} fill={PIE_COLORS[i % PIE_COLORS.length]} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">No commissions yet.</div>
          )}
        </SectionCard>
      )}
        </CollapsibleSection>
      )}

      {/* Per-employee totals */}
      {employeeCount > 0 && (
        <SectionCard title="Commissions by Salesperson">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(byEmployee).map(([name, amount]) => (
              <div key={name} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                <p className="text-xs font-medium text-gray-600 truncate">{name}</p>
                <p className="text-base font-bold text-primary-700 mt-0.5">{formatPHP(amount)}</p>
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
