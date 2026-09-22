import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useCustomerStore } from './customerStore';
import { useVendorStore } from './vendorStore';
import { useEmployeeStore } from './employeeStore';
import { useProductStore } from './productStore';
import { useSaleStore } from './saleStore';
import { useExpenseStore } from './expenseStore';
import { usePayrollStore } from './payrollStore';
import { useCommissionStore } from './commissionStore';
import { useProductionStore } from './productionStore';
import { useCuttingStore } from './cuttingStore';
import type { PayrollEntry, ProductionEntry } from '../types';

beforeEach(() => {
  useCustomerStore.setState({ customers: [], _seeded: 999 });
  useVendorStore.setState({ vendors: [], _seeded: 999 });
  useEmployeeStore.setState({ employees: [], _seeded: 999 });
  useProductStore.setState({ products: [], _seeded: 999 });
  useSaleStore.setState({ sales: [], invoiceCounters: {} });
  useExpenseStore.setState({ expenses: [] });
  usePayrollStore.setState({ entries: [] });
  useCommissionStore.setState({ entries: [] });
  useProductionStore.setState({ entries: [] });
  useCuttingStore.setState({ batches: [] });
});

describe('customer rename cascades', () => {
  it('rewrites Sale.customerName for the linked customer only', () => {
    const cust = useCustomerStore.getState().addCustomer({
      customerName: 'Old Name', contactPerson: '', phone: '', fbMessengerName: '',
      email: '', address: '', farmPartner: false, farmPartnerCategory: '',
      farmPartnerSubcategory: '', notes: '',
    });
    const linked = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: cust.id, customerName: 'Old Name',
      saleType: '', items: [], paymentMethod: 'Cash', paymentDetails: '', paid: false,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    const other = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: 'someone-else', customerName: 'Keep',
      saleType: '', items: [], paymentMethod: 'Cash', paymentDetails: '', paid: false,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });

    useCustomerStore.getState().updateCustomer(cust.id, { customerName: 'New Name' });

    expect(useSaleStore.getState().getSale(linked.id)!.customerName).toBe('New Name');
    expect(useSaleStore.getState().getSale(other.id)!.customerName).toBe('Keep');
  });

  it('rewrites CuttingBatch.customerName for the linked customer', () => {
    const cust = useCustomerStore.getState().addCustomer({
      customerName: 'Buyer A', contactPerson: '', phone: '', fbMessengerName: '',
      email: '', address: '', farmPartner: false, farmPartnerCategory: '',
      farmPartnerSubcategory: '', notes: '',
    });
    useCuttingStore.setState({
      batches: [{
        id: 'b1', subcategory: 'Thai White', source: 'Customer',
        customerId: cust.id, customerName: 'Buyer A', saleId: 's1',
        dateSourced: '2026-01-01', dateGrafted: '', quantitySourced: 10,
        sourceCostPerCutting: 0, graftCostPerCutting: 0, rootWeeks: 3,
        readyDate: '', estimatedReadyDate: '', totalCost: 0, quantityAvailable: 10,
        status: 'To Graft / Plant', notes: '', createdAt: '', updatedAt: '',
      }],
    });

    useCustomerStore.getState().updateCustomer(cust.id, { customerName: 'Buyer B' });

    expect(useCuttingStore.getState().getBatch('b1')!.customerName).toBe('Buyer B');
  });
});

describe('vendor rename cascades', () => {
  it('rewrites Expense.vendorName for the linked vendor only', () => {
    const vendor = useVendorStore.getState().addVendor({
      vendor: 'Acme Old', contact: '', phone: '', supplies: [], notes: '',
    });
    const linked = useExpenseStore.getState().addExpense({
      date: '2026-01-01', vendorId: vendor.id, vendorName: 'Acme Old',
      category: 'Fertilizer', subcategory: '', description: '', quantity: 0, unit: '',
      unitPrice: 0, amount: 0, paymentMethod: 'Cash', paid: false, notes: '',
    });
    const other = useExpenseStore.getState().addExpense({
      date: '2026-01-01', vendorId: 'other', vendorName: 'Keep Co',
      category: 'Fertilizer', subcategory: '', description: '', quantity: 0, unit: '',
      unitPrice: 0, amount: 0, paymentMethod: 'Cash', paid: false, notes: '',
    });

    useVendorStore.getState().updateVendor(vendor.id, { vendor: 'Acme New' });

    expect(useExpenseStore.getState().getExpense(linked.id)!.vendorName).toBe('Acme New');
    expect(useExpenseStore.getState().getExpense(other.id)!.vendorName).toBe('Keep Co');
  });
});

describe('employee rename cascades', () => {
  it('rewrites payroll, commission, sale-salesperson and production-harvester names', () => {
    const emp = useEmployeeStore.getState().addEmployee({
      name: 'Jose', position: 'Farmer', employeeType: 'Full Time',
      laborType: 'Direct', accountingClassification: 'COGS',
      dailyRate: 500, commission: 0, notes: '',
    });

    const payroll: PayrollEntry = {
      id: 'p1', payPeriodStart: '2026-01-01', payPeriodEnd: '2026-01-07',
      employeeId: emp.id, employeeName: 'Jose', daysWorked: 5, rate: 500,
      grossPay: 2500, deductions: 0, netPay: 2500, commissionAmount: 0, bonus: 0,
      paid: false, notes: '', createdAt: '', updatedAt: '',
    };
    usePayrollStore.setState({ entries: [payroll] });

    useCommissionStore.getState().addEntry({
      date: '2026-01-01', employeeId: emp.id, employeeName: 'Jose', saleId: 's1',
      saleAmount: 1000, commissionPct: 3, notes: '',
    });

    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'C',
      saleType: '', items: [], paymentMethod: 'Cash', paymentDetails: '', paid: false,
      soldByEmployeeId: emp.id, soldByName: 'Jose', notes: '',
    });

    const prod: ProductionEntry = {
      id: 'pr1', date: '2026-01-01', farmBlock: 'A', harvestedById: emp.id,
      harvestedByName: 'Jose', plants: 0, fruitsHarvested: 10, goodFruits: 10,
      damaged: 0, weightKg: 5, notes: '', createdAt: '', updatedAt: '',
    };
    useProductionStore.setState({ entries: [prod] });

    useEmployeeStore.getState().updateEmployee(emp.id, { name: 'José Cruz' });

    expect(usePayrollStore.getState().getEntry('p1')!.employeeName).toBe('José Cruz');
    expect(useCommissionStore.getState().entries[0].employeeName).toBe('José Cruz');
    expect(useSaleStore.getState().getSale(sale.id)!.soldByName).toBe('José Cruz');
    expect(useProductionStore.getState().getEntry('pr1')!.harvestedByName).toBe('José Cruz');
  });
});

describe('product identity rename cascades', () => {
  it('rewrites SaleItem.productName and ExpenseItem name/category/subcategory by productId', () => {
    const product = useProductStore.getState().addProduct({
      category: 'Fruit', subcategory: 'Red', unit: 'Kg',
      costPHP: 0, sellingPricePHP: 0, costUSD: 0, sellingPriceUSD: 0, notes: '',
    });

    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'C', saleType: '',
      items: [{ productId: product.id, productName: 'Fruit – Red', quantity: 1, unitPrice: 100, surcharge: 0, total: 100 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: false,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });

    const expense = useExpenseStore.getState().addExpense({
      date: '2026-01-01', vendorId: 'v1', vendorName: 'Acme',
      category: 'Fruit', subcategory: 'Red', description: '', quantity: 0, unit: '',
      unitPrice: 0, amount: 0, paymentMethod: 'Cash', paid: false, notes: '',
      items: [{ productId: product.id, name: 'Fruit – Red', category: 'Fruit', subcategory: 'Red', quantity: 1, unit: 'Kg', unitPrice: 100, total: 100 }],
    });

    useProductStore.getState().updateProduct(product.id, { subcategory: 'Crimson' });

    expect(useSaleStore.getState().getSale(sale.id)!.items[0].productName).toBe('Fruit – Crimson');
    const item = useExpenseStore.getState().getExpense(expense.id)!.items![0];
    expect(item.name).toBe('Fruit – Crimson');
    expect(item.subcategory).toBe('Crimson');
  });
});
