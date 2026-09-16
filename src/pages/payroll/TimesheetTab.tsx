import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { format, parseISO, addDays } from 'date-fns';
import { useEmployeeStore, isEmployeeActive } from '../../store/employeeStore';
import { useTimesheetStore } from '../../store/timesheetStore';
import { SectionCard } from '../../components/ui/SectionCard';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { weekStart as toWeekStart, weekDays, weekEnd, sumWorkedDays } from '../../utils/payroll';

/**
 * Weekly timesheet: for the selected Monday-start week, each employee gets a row
 * of 7 day cells. Clicking a cell cycles none → full → half. The captured days
 * feed the "Run Payroll" step.
 */

const todayISO = () => format(new Date(), 'yyyy-MM-dd');

interface DayCellProps {
  state: 0.5 | 1 | undefined;
  label: string;      // weekday label, e.g. "Mon"
  dateLabel: string;  // day-of-month, e.g. "6"
  onClick: () => void;
  ariaLabel: string;
}

function DayCell({ state, label, dateLabel, onClick, ariaLabel }: DayCellProps) {
  const base = 'flex flex-col items-center justify-center w-11 h-12 rounded-lg border text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400';
  const style =
    state === 1
      ? 'bg-green-600 border-green-600 text-white'
      : state === 0.5
        ? 'bg-green-100 border-green-300 text-green-800'
        : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-50';
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} aria-pressed={state !== undefined} className={[base, style].join(' ')}>
      <span className="font-medium">{label}</span>
      <span>{dateLabel}</span>
      {state === 0.5 && <span className="text-[10px] leading-none">½</span>}
      {state === 1 && <span className="text-[10px] leading-none">1</span>}
    </button>
  );
}

export function TimesheetTab() {
  // Subscribe to the raw array (stable ref) and derive active list here — calling
  // activeEmployees() inside the selector returns a new array each read and
  // crashes zustand's snapshot check.
  const allEmployees = useEmployeeStore((s) => s.employees);
  const employees = useMemo(() => allEmployees.filter(isEmployeeActive), [allEmployees]);
  const { getDay, cycleDay, getWorkedDays, clearWeek } = useTimesheetStore();

  const [anchor, setAnchor] = useState<string>(() => toWeekStart(todayISO()));
  const start = toWeekStart(anchor);
  const end = weekEnd(anchor);
  const days = weekDays(anchor);

  const shiftWeek = (deltaWeeks: number) => {
    setAnchor(format(addDays(parseISO(start), deltaWeeks * 7), 'yyyy-MM-dd'));
  };

  return (
    <SectionCard
      title="Weekly Timesheet"
      subtitle="Click a day to cycle: not worked → full day → half day. Fills the days used when you run payroll."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" icon={<ChevronLeft className="w-4 h-4" />} onClick={() => shiftWeek(-1)}>Prev</Button>
          <input
            type="date"
            value={anchor}
            onChange={(e) => e.target.value && setAnchor(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Pick a week"
          />
          <Button variant="ghost" size="xs" onClick={() => shiftWeek(1)}>Next<ChevronRight className="w-4 h-4" /></Button>
        </div>
      }
    >
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <CalendarDays className="w-4 h-4 text-green-600" />
        Week of {format(parseISO(start), 'MMM d')} – {format(parseISO(end), 'MMM d, yyyy')} (Mon–Sun)
      </div>

      {employees.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No employees yet" description="Add employees first to record their worked days." />
      ) : (
        <div className="space-y-3">
          {employees.map((emp) => {
            const total = sumWorkedDays(getWorkedDays(start, emp.id));
            return (
              <div key={emp.id} className="flex flex-col lg:flex-row lg:items-center gap-3 rounded-lg border border-gray-200 p-3">
                <div className="lg:w-48 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{emp.name}</p>
                  <p className="text-xs text-gray-400 truncate">{emp.position}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {days.map((d) => (
                    <DayCell
                      key={d}
                      state={getDay(start, emp.id, d)}
                      label={format(parseISO(d), 'EEE')}
                      dateLabel={format(parseISO(d), 'd')}
                      onClick={() => cycleDay(start, emp.id, d)}
                      ariaLabel={`${emp.name} ${format(parseISO(d), 'EEEE MMM d')}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-3 lg:ml-auto">
                  <span className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{total}</span> day{total !== 1 ? 's' : ''}
                  </span>
                  {total > 0 && (
                    <Button variant="ghost" size="xs" onClick={() => clearWeek(start, emp.id)}>Clear</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
