import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Employee } from '../types';
import { generateId, now } from '../utils/id';

/** Auto-calculate weekly and monthly rates from dailyRate */
function calcRates(dailyRate: number): Pick<Employee, 'weeklyRate' | 'monthlySalary'> {
  const weeklyRate = dailyRate * 5;
  const monthlySalary = weeklyRate * 4;
  return { weeklyRate, monthlySalary };
}

/** Treat a missing `active` flag as active (back-compat for pre-existing rows). */
export function isEmployeeActive(emp: Pick<Employee, 'active'>): boolean {
  return emp.active !== false;
}

interface EmployeeState {
  employees: Employee[];
  _seeded: number;
  addEmployee: (data: Omit<Employee, 'id' | 'weeklyRate' | 'monthlySalary' | 'createdAt' | 'updatedAt'>) => Employee;
  updateEmployee: (id: string, data: Partial<Omit<Employee, 'id' | 'createdAt'>>) => void;
  deleteEmployee: (id: string) => void;
  getEmployee: (id: string) => Employee | undefined;
  /** Toggle or set an employee's active status. */
  setActive: (id: string, active: boolean) => void;
  /** Only currently-active employees (used by timesheet + payroll run). */
  activeEmployees: () => Employee[];
  /** Total monthly salary commitment across ACTIVE employees */
  totalMonthlySalary: () => number;
  /** Count of ACTIVE employees grouped by employee type */
  countByType: () => Record<string, number>;
}

// v3: synced to the bookkeeping sheet — added Kevin (Owner), aligned commissions
const SEED_VERSION = 3;

/** Build an employee row cleanly */
function e(
  name: string,
  position: string,
  employeeType: Employee['employeeType'],
  dailyRate: number,
  commission: number,
  notes = ''
): Employee {
  return {
    id: generateId(),
    name,
    position,
    employeeType,
    dailyRate,
    ...calcRates(dailyRate),
    commission,
    notes,
    createdAt: now(),
    updatedAt: now(),
  };
}

const SEED_EMPLOYEES: Employee[] = [
  // Kevin: owner, 1% commission (0.01 in the sheet), no fixed daily rate.
  e('Kevin', 'Owner',        'Full Time',    0,  1, 'Owner. 1% commission on sales.'),
  e('Don',   'Farmer',       'Full Time', 1000,  0),
  e('Aljun', 'Farmer',       'Full Time',  630,  0),
  e('Tiboy', 'Farmer',       'Full Time',  750,  0),
  e('Peter', 'Farmer',       'Full Time',  540,  0, 'Rate: ₱540/day. Increasing to ₱2,900 starting 6/26/26'),
  e('Bong',  'Farmer',       'Full Time',  600,  0),
  // Emily: only weekly ₱3,000 listed in the sheet; daily back-calculated 3000/5 = 600.
  e('Emily', 'Farmer',       'Full Time',  600,  3, 'Weekly ₱3,000 (daily back-calculated). 3% commission.'),
  // Jen: daily ₱950, monthly salary ₱40,000 (override stored in notes).
  e('Jen',   'Sales Person', 'Full Time',  950,  0, 'Monthly salary: ₱40,000 (overrides daily rate calculation)'),
  e('Ping',  'Farm Manager', 'Full Time',    0,  0, 'Rate TBD'),
];

export const useEmployeeStore = create<EmployeeState>()(
  persist(
    (set, get) => ({
      employees: SEED_EMPLOYEES,
      _seeded: SEED_VERSION,

      addEmployee: (data) => {
        const employee: Employee = {
          ...data,
          active: data.active ?? true,
          ...calcRates(data.dailyRate),
          id: generateId(),
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ employees: [...state.employees, employee] }));
        return employee;
      },

      updateEmployee: (id, data) =>
        set((state) => ({
          employees: state.employees.map((emp) => {
            if (emp.id !== id) return emp;
            const updated = { ...emp, ...data, updatedAt: now() };
            if (data.dailyRate !== undefined) {
              Object.assign(updated, calcRates(data.dailyRate));
            }
            return updated;
          }),
        })),

      deleteEmployee: (id) =>
        set((state) => ({
          employees: state.employees.filter((emp) => emp.id !== id),
        })),

      getEmployee: (id) => get().employees.find((emp) => emp.id === id),

      setActive: (id, active) =>
        set((state) => ({
          employees: state.employees.map((emp) =>
            emp.id === id ? { ...emp, active, updatedAt: now() } : emp
          ),
        })),

      activeEmployees: () => get().employees.filter(isEmployeeActive),

      totalMonthlySalary: () =>
        get().employees.filter(isEmployeeActive).reduce((sum, emp) => sum + emp.monthlySalary, 0),

      countByType: () =>
        get().employees.filter(isEmployeeActive).reduce<Record<string, number>>((acc, emp) => {
          acc[emp.employeeType] = (acc[emp.employeeType] ?? 0) + 1;
          return acc;
        }, {}),
    }),
    {
      name: 'dfd-employees',
      onRehydrateStorage: () => (state) => {
        if (state && state._seeded < SEED_VERSION) {
          state.employees = SEED_EMPLOYEES;
          state._seeded = SEED_VERSION;
        }
      },
    }
  )
);
