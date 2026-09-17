import { createOptionListStore } from './optionListStore';
import { SALE_TYPES, INVENTORY_CATEGORIES, UNIT_VALUES, EMPLOYEE_TYPES, EMPLOYEE_POSITIONS, DRAGON_FRUIT_VARIETIES } from '../constants';
import { useSaleStore } from './saleStore';
import { useProductStore } from './productStore';
import { useInventoryStore } from './inventoryStore';
import { useExpenseStore } from './expenseStore';
import { useEmployeeStore } from './employeeStore';
import { useVendorProductStore } from './vendorProductStore';

/**
 * Tolerant equality for cascade matching: case- and whitespace-insensitive.
 * A rename of "Kg"→"kg" should still update a record stored as "Kg" (or " KG ").
 * Without this, casing drift between the seed data and the option list would
 * silently skip records during a rename cascade.
 */
const sameOption = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * User-editable option lists, seeded from the static constants. New values added
 * via a "create new…" dropdown persist here and reappear in future dropdowns.
 *
 * Each list passes an `onRename` cascade so renaming an option in Settings also
 * updates the records that stored the old value (non-destructive — deletes only
 * remove the future option; existing records keep their value).
 */

/** Rename cascade: how a sale happened is stored on each Sale. */
export const useSaleTypeStore = createOptionListStore(
  'dfd-sale-types',
  SALE_TYPES,
  (from, to) => {
    const { sales, updateSale } = useSaleStore.getState();
    sales.filter((s) => sameOption(s.saleType, from)).forEach((s) => updateSale(s.id, { saleType: to }));
  },
);

/**
 * Rename cascade: inventory items store their category.
 * seedVersion 1 forces existing users' list to reset to the product-aligned
 * categories (Root Stock→Cuttings, Dragon Fruit→Fruit) added in this change.
 */
export const useInventoryCategoryStore = createOptionListStore(
  'dfd-inventory-categories',
  INVENTORY_CATEGORIES,
  (from, to) => {
    const { items, updateItem } = useInventoryStore.getState();
    items.filter((i) => sameOption(i.category, from)).forEach((i) => updateItem(i.id, { category: to }));
  },
  1,
);

/** Rename cascade: units are shared by products, inventory items, and expenses. */
export const useUnitStore = createOptionListStore(
  'dfd-units',
  UNIT_VALUES,
  (from, to) => {
    const products = useProductStore.getState();
    products.products.filter((p) => sameOption(p.unit, from)).forEach((p) => products.updateProduct(p.id, { unit: to }));
    const inventory = useInventoryStore.getState();
    inventory.items.filter((i) => sameOption(i.unit, from)).forEach((i) => inventory.updateItem(i.id, { unit: to }));
    const expenses = useExpenseStore.getState();
    expenses.expenses.forEach((e) => {
      const flatMatch = sameOption(e.unit, from);
      const itemMatch = (e.items ?? []).some((it) => sameOption(it.unit, from));
      if (!flatMatch && !itemMatch) return;
      expenses.updateExpense(e.id, {
        unit: flatMatch ? to : e.unit,
        items: itemMatch
          ? (e.items ?? []).map((it) => (sameOption(it.unit, from) ? { ...it, unit: to } : it))
          : e.items,
      });
    });
    // Vendor-product catalog units share the same list.
    const vp = useVendorProductStore.getState();
    vp.products.filter((p) => sameOption(p.unit, from)).forEach((p) => vp.updateProduct(p.id, { unit: to }));
  },
);

/** Rename cascade: employees store their employment type. */
export const useEmployeeTypeStore = createOptionListStore(
  'dfd-employee-types',
  EMPLOYEE_TYPES,
  (from, to) => {
    const { employees, updateEmployee } = useEmployeeStore.getState();
    employees.filter((e) => sameOption(e.employeeType, from)).forEach((e) => updateEmployee(e.id, { employeeType: to }));
  },
);

/** Rename cascade: employees store their position/role. */
export const useEmployeePositionStore = createOptionListStore(
  'dfd-employee-positions',
  EMPLOYEE_POSITIONS,
  (from, to) => {
    const { employees, updateEmployee } = useEmployeeStore.getState();
    employees.filter((e) => sameOption(e.position, from)).forEach((e) => updateEmployee(e.id, { position: to }));
  },
);

// Legacy flat category list — no longer wired to any form (categories live in
// productCategoryStore now). Kept only to avoid breaking its persist key.
export const useProductTypeStore = createOptionListStore('dfd-product-types', DRAGON_FRUIT_VARIETIES);
