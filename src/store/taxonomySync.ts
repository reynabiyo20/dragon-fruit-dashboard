/**
 * Taxonomy sync — keep the two category/subcategory taxonomies in step.
 *
 * The app has two managed taxonomies that drive different dropdowns:
 *   - productCategoryStore → Products & Sales
 *   - expenseCategoryStore → Expenses (and vendor supplies)
 *
 * A category/subcategory created in ANY module (Products, Inventory, Expenses,
 * Vendors, Customers…) should appear everywhere it's applicable. Rather than
 * mirror the write in each form, call `syncTaxonomy` from every create-new entry
 * point. Both stores' `addEntry` dedupe internally, so repeated calls are safe.
 */
import { useProductCategoryStore } from './productCategoryStore';
import { useExpenseCategoryStore } from './expenseCategoryStore';

/**
 * Register a (category, subcategory) in BOTH taxonomies so it's selectable across
 * Products, Sales, Expenses, Inventory and Vendors. `subcategory` may be '' to
 * register a top-level category alone.
 */
export function syncTaxonomy(category: string, subcategory = ''): void {
  const cat = category.trim();
  if (!cat) return;
  const sub = subcategory.trim();
  useProductCategoryStore.getState().addEntry(cat, sub);
  useExpenseCategoryStore.getState().addEntry(cat, sub);
}
