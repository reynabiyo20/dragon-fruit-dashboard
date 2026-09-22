import { describe, it, expect, beforeEach } from 'vitest';
import { useEmployeeStore, isEmployeeActive } from './employeeStore';
import type { Employee } from '../types';

beforeEach(() => {
  useEmployeeStore.setState({ employees: [], _seeded: 999 });
});

const store = () => useEmployeeStore.getState();

type Input = Omit<Employee, 'id' | 'weeklyRate' | 'monthlySalary' | 'createdAt' | 'updatedAt'>;
function input(over: Partial<Input> = {}): Input {
  return {
    name: 'Alice',
    position: 'Farmer',
    employeeType: 'Full Time',
    dailyRate: 500,
    commission: 0,
    notes: '',
    ...over,
  };
}

describe('isEmployeeActive (back-compat)', () => {
  it('treats a missing active flag as active', () => {
    expect(isEmployeeActive({ active: undefined })).toBe(true);
    expect(isEmployeeActive({ active: true })).toBe(true);
    expect(isEmployeeActive({ active: false })).toBe(false);
  });
});

describe('employeeStore active status', () => {
  it('new employees default to active', () => {
    const e = store().addEmployee(input());
    expect(e.active).toBe(true);
  });

  it('setActive toggles status', () => {
    const e = store().addEmployee(input());
    store().setActive(e.id, false);
    expect(store().getEmployee(e.id)!.active).toBe(false);
    store().setActive(e.id, true);
    expect(store().getEmployee(e.id)!.active).toBe(true);
  });

  it('activeEmployees excludes inactive ones', () => {
    const a = store().addEmployee(input({ name: 'Alice' }));
    const b = store().addEmployee(input({ name: 'Bob' }));
    store().setActive(b.id, false);
    const active = store().activeEmployees();
    expect(active.map((e) => e.id)).toEqual([a.id]);
  });

  it('totalMonthlySalary and countByType count only active employees', () => {
    const a = store().addEmployee(input({ name: 'Alice', dailyRate: 500, employeeType: 'Full Time' })); // monthly 500*5*4 = 10000
    const b = store().addEmployee(input({ name: 'Bob', dailyRate: 400, employeeType: 'Part Time' }));    // monthly 8000
    store().setActive(b.id, false);

    expect(store().totalMonthlySalary()).toBe(a.monthlySalary);
    expect(store().countByType()).toEqual({ 'Full Time': 1 });
  });
});

describe('employeeStore labor bookkeeping', () => {
  it('defaults laborType + accountingClassification from the role (Farmer → Direct/COGS)', () => {
    const e = store().addEmployee(input({ position: 'Farmer' }));
    expect(e.laborType).toBe('Direct Labor');
    expect(e.accountingClassification).toBe('Cost of Goods Sold (COGS)');
  });

  it('maps Sales Person to Selling Labor / OpEx Sales & Marketing', () => {
    const e = store().addEmployee(input({ name: 'Jen', position: 'Sales Person' }));
    expect(e.laborType).toBe('Selling Labor');
    expect(e.accountingClassification).toBe('Operating Expense (OpEx) / Sales & Marketing');
  });

  it('respects an explicitly-provided laborType over the role default', () => {
    const e = store().addEmployee(input({ position: 'Farmer', laborType: 'Indirect Labor' }));
    expect(e.laborType).toBe('Indirect Labor');
  });

  it('countByLaborType groups active employees by labor type', () => {
    store().addEmployee(input({ name: 'Don', position: 'Farmer' }));      // Direct Labor
    store().addEmployee(input({ name: 'Aljun', position: 'Farmer' }));    // Direct Labor
    store().addEmployee(input({ name: 'Ping', position: 'Farm Manager' })); // Indirect Labor
    const inactive = store().addEmployee(input({ name: 'Kevin', position: 'Owner' })); // Administrative
    store().setActive(inactive.id, false);
    expect(store().countByLaborType()).toEqual({ 'Direct Labor': 2, 'Indirect Labor': 1 });
  });
});
