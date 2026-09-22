/**
 * Entity display-name cascades.
 *
 * Child records snapshot a parent entity's DISPLAY NAME alongside the linking id
 * (e.g. a Sale stores `customerId` + `customerName`; a PayrollEntry stores
 * `employeeId` + `employeeName`). The id is the source of truth for the link;
 * the name is a denormalized copy kept for display/reporting without a join.
 *
 * When a parent is renamed, these helpers rewrite every child's stored name so
 * the app stays consistent everywhere the name is shown. They match on the
 * linking id (never on the old name), so a rename can't miss a record or touch
 * an unrelated one.
 *
 * Design notes:
 *  - Cross-store access is lazy (`useXStore.getState()`) to avoid import cycles,
 *    matching the pattern used by optionStores / productUnitCascade / inventoryLink.
 *  - Each child is updated through its own `updateX` action so the store's
 *    recompute + persistence run as normal.
 *  - Writes are skipped when the stored name already matches, so a no-op rename
 *    (or a non-name edit) never churns child stores or triggers redundant writes.
 *  - A blank new name is ignored — we never wipe a child's name to empty.
 */
import { useSaleStore } from './saleStore';
import { useCuttingStore } from './cuttingStore';
import { useExpenseStore } from './expenseStore';
import { usePayrollStore } from './payrollStore';
import { useCommissionStore } from './commissionStore';
import { useProductionStore } from './productionStore';
import { categoryLabel } from '../utils/format';

/**
 * Propagate a customer's renamed identity to every record that snapshots it:
 *  - Sale.customerName        (linked by Sale.customerId)
 *  - CuttingBatch.customerName (linked by CuttingBatch.customerId)
 */
export function cascadeCustomerName(customerId: string, newName: string): void {
  const name = newName.trim();
  if (!customerId || !name) return;

  const sales = useSaleStore.getState();
  sales.sales
    .filter((s) => s.customerId === customerId && s.customerName !== name)
    .forEach((s) => sales.updateSale(s.id, { customerName: name }));

  const cuttings = useCuttingStore.getState();
  cuttings.batches
    .filter((b) => b.customerId === customerId && b.customerName !== name)
    .forEach((b) => cuttings.updateBatch(b.id, { customerName: name }));
}

/**
 * Propagate a vendor's renamed name to every record that snapshots it:
 *  - Expense.vendorName (linked by Expense.vendorId)
 */
export function cascadeVendorName(vendorId: string, newName: string): void {
  const name = newName.trim();
  if (!vendorId || !name) return;

  const expenses = useExpenseStore.getState();
  expenses.expenses
    .filter((e) => e.vendorId === vendorId && e.vendorName !== name)
    .forEach((e) => expenses.updateExpense(e.id, { vendorName: name }));
}

/**
 * Propagate an employee's renamed name to every record that snapshots it:
 *  - PayrollEntry.employeeName    (linked by PayrollEntry.employeeId)
 *  - CommissionEntry.employeeName (linked by CommissionEntry.employeeId)
 *  - Sale.soldByName              (linked by Sale.soldByEmployeeId)
 *  - ProductionEntry.harvestedByName (linked by ProductionEntry.harvestedById)
 *
 * Timesheets are keyed by employeeId only (they store no name), so they need no
 * cascade.
 */
export function cascadeEmployeeName(employeeId: string, newName: string): void {
  const name = newName.trim();
  if (!employeeId || !name) return;

  const payroll = usePayrollStore.getState();
  payroll.entries
    .filter((e) => e.employeeId === employeeId && e.employeeName !== name)
    .forEach((e) => payroll.updateEntry(e.id, { employeeName: name }));

  const commissions = useCommissionStore.getState();
  commissions.entries
    .filter((e) => e.employeeId === employeeId && e.employeeName !== name)
    .forEach((e) => commissions.updateEntry(e.id, { employeeName: name }));

  const sales = useSaleStore.getState();
  sales.sales
    .filter((s) => s.soldByEmployeeId === employeeId && s.soldByName !== name)
    .forEach((s) => sales.updateSale(s.id, { soldByName: name }));

  const production = useProductionStore.getState();
  production.entries
    .filter((e) => e.harvestedById === employeeId && e.harvestedByName !== name)
    .forEach((e) => production.updateEntry(e.id, { harvestedByName: name }));
}

/**
 * Propagate a product's renamed identity to the denormalized name copies that
 * reference it by id:
 *  - SaleItem.productName  (a composed "Category – Subcategory" label)
 *  - ExpenseItem.name / category / subcategory
 *
 * Matches line items by `productId`, so only lines tied to the catalog product
 * are touched (ad-hoc lines with an empty productId are left alone). Price and
 * unit snapshots on the line are deliberately preserved — only the identity
 * label is refreshed.
 */
export function cascadeProductName(
  productId: string,
  category: string,
  subcategory: string,
): void {
  if (!productId) return;
  const cat = category.trim();
  const sub = subcategory.trim();
  const label = categoryLabel(cat, sub);

  // Sales line items carry a composed product label.
  const sales = useSaleStore.getState();
  sales.sales.forEach((s) => {
    const touched = (s.items ?? []).some(
      (it) => it.productId === productId && it.productName !== label,
    );
    if (!touched) return;
    const items = s.items.map((it) =>
      it.productId === productId ? { ...it, productName: label } : it,
    );
    sales.updateSale(s.id, { items });
  });

  // Expense line items carry name + category + subcategory snapshots.
  const expenses = useExpenseStore.getState();
  expenses.expenses.forEach((e) => {
    const items = e.items ?? [];
    const touched = items.some(
      (it) =>
        it.productId === productId &&
        (it.name !== label || it.category !== cat || it.subcategory !== sub),
    );
    if (!touched) return;
    const nextItems = items.map((it) =>
      it.productId === productId
        ? { ...it, name: label, category: cat, subcategory: sub }
        : it,
    );
    expenses.updateExpense(e.id, { items: nextItems });
  });
}
