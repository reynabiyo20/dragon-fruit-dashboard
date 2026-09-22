/**
 * Centralized user-facing copy — toasts, validation messages, and recurring
 * field microcopy.
 *
 * WHY THIS EXISTS
 * Before this module, every form hardcoded its own strings inline, which drifted
 * over time: "Sale recorded" vs "Expense added" vs "Harvest logged" for the same
 * create action; "Price / Unit (₱)" vs "Unit Cost (₱)" vs "Price" for the same
 * field; "Date is required" vs "Harvest date is required" for the same rule.
 *
 * Route ALL new user-facing copy through here so identical fields and operations
 * read and behave identically everywhere. This module contains copy only — no
 * business or data logic.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. TOAST / NOTIFICATION TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical CRUD actions, phrased as the past participle used in the success
 * template ("[Entity] successfully [action]"). Keep the set small and shared so
 * every store speaks the same language.
 */
export type CrudAction =
  | 'created'
  | 'updated'
  | 'saved'
  | 'deleted'
  | 'restored'
  | 'added'
  | 'removed';

/** Present-tense verb for the error template ("Failed to [action] [entity]."). */
const ERROR_VERB: Record<CrudAction, string> = {
  created: 'create',
  updated: 'update',
  saved: 'save',
  deleted: 'delete',
  restored: 'restore',
  added: 'add',
  removed: 'remove',
};

/**
 * Success toast text: "[Entity] successfully [action]".
 * @example toastSuccess('Batch', 'created') → "Batch successfully created"
 */
export function toastSuccess(entity: string, action: CrudAction): string {
  return `${entity} successfully ${action}`;
}

/**
 * Error toast text: "Failed to [action] [entity]. Please try again.".
 * @example toastError('batch', 'created') → "Failed to create batch. Please try again."
 */
export function toastError(entity: string, action: CrudAction): string {
  return `Failed to ${ERROR_VERB[action]} ${entity}. Please try again.`;
}

/**
 * "Saved [entity] successfully" convenience for create-or-update flows where the
 * form doesn't distinguish the two in copy. Prefer the explicit created/updated
 * variants when the distinction is meaningful to the user.
 */
export function toastSaved(entity: string, isEdit: boolean): string {
  return toastSuccess(entity, isEdit ? 'updated' : 'created');
}

/** Canonical entity display names, so toasts across modules stay consistent. */
export const ENTITY = {
  sale: 'Sale',
  expense: 'Expense',
  serviceExpense: 'Service expense',
  batch: 'Batch',
  employee: 'Employee',
  customer: 'Customer',
  vendor: 'Vendor',
  product: 'Product',
  productionEntry: 'Production entry',
  inventoryItem: 'Inventory item',
  farmSection: 'Section',
  standingPlants: 'Standing plants',
  business: 'Business information',
  backup: 'Backup',
  payrollEntry: 'Payroll entry',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 2. VALIDATION MESSAGES
// ─────────────────────────────────────────────────────────────────────────────

/** "[Field] is required" — the single canonical required-field message. */
export function requiredMsg(field: string): string {
  return `${field} is required`;
}

/** "[Field] must be greater than 0" — canonical positive-number message. */
export function positiveMsg(field: string): string {
  return `${field} must be greater than 0`;
}

/** "[Field] must be at least [min]" — canonical minimum message. */
export function minMsg(field: string, min: number): string {
  return `${field} must be at least ${min}`;
}

/** Common ready-made validation messages for recurring fields. */
export const VALIDATION = {
  dateRequired: 'Date is required',
  categoryRequired: 'Category is required',
  subcategoryRequired: 'Subcategory is required',
  unitRequired: 'Unit is required',
  quantityRequired: 'Quantity is required',
  priceRequired: 'Price is required',
  amountPositive: 'Amount must be greater than 0',
  paymentMethodRequired: 'Payment method is required',
  customerRequired: 'Customer is required',
  vendorRequired: 'Vendor is required',
  varietyRequired: 'Variety is required',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 3. RECURRING FIELD MICROCOPY (label / placeholder / hint)
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldCopy {
  label: string;
  placeholder?: string;
  hint?: string;
}

/**
 * One definition per recurring field. Forms should spread or reference these so
 * a given concept (a price, a quantity, a category) reads identically everywhere.
 * Context-specific fields (e.g. "Harvest Date") intentionally live in their form.
 */
export const FIELD = {
  date: { label: 'Date' },
  quantity: { label: 'Quantity', placeholder: 'e.g. 5' },
  unit: { label: 'Unit', placeholder: 'Select or add…' },
  unitPrice: { label: 'Unit Price (₱)', placeholder: 'e.g. 250' },
  unitCost: { label: 'Unit Cost (₱)', placeholder: 'e.g. 250' },
  amount: { label: 'Amount (₱)' },
  category: { label: 'Category', placeholder: 'Select category…' },
  subcategory: { label: 'Subcategory', placeholder: 'Select or add…' },
  paymentMethod: { label: 'Payment Method' },
  paymentDetails: { label: 'Payment Details' },
  notes: { label: 'Notes' },
  invoice: { label: 'Invoice #', placeholder: 'Auto or manual' },
  vendor: { label: 'Vendor' },
  vendorName: { label: 'Vendor Name', placeholder: 'Type vendor name…' },
  customer: { label: 'Customer' },
  customerName: { label: 'Customer Name', placeholder: 'Type customer name…' },
  variety: { label: 'Variety', placeholder: 'Select variety…' },
} as const satisfies Record<string, FieldCopy>;

// ─── Shared "create new…" microcopy for CreatableSelect ────────────────────────
/**
 * Consistent create-new affordance copy. Use these so every creatable dropdown
 * offers the same "+ Add new …" phrasing rather than a mix of "Create"/"Add".
 */
export function createNewLabel(noun: string): string {
  return `+ Add new ${noun.toLowerCase()}…`;
}

export function newFieldLabel(noun: string): string {
  return `New ${noun}`;
}

// ─── Shared search placeholder ─────────────────────────────────────────────────
/** "Search [things]…" — uniform search box placeholder. */
export function searchPlaceholder(things: string): string {
  return `Search ${things}…`;
}
