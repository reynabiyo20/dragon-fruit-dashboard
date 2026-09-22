import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ExpenseItem, VendorSupply, CuttingPurchaseState } from '../types';

/**
 * In-progress "Add Expense" draft persistence.
 *
 * The Add Expense modal is a lazy route subtree that fully unmounts when the
 * user closes it or navigates away — so anything typed into a NEW (not-yet-saved)
 * expense would normally be lost. This store keeps that half-filled draft alive
 * (behind `persist`, so it also survives reloads) until the user either saves the
 * expense (draft cleared) or explicitly discards it.
 *
 * Only NEW expenses are drafted. Editing an existing expense never touches this
 * store — its data already lives in the expense record.
 *
 * The draft is intentionally loosely typed: it mirrors the two Add-Expense forms
 * (ExpenseForm's product fields + ServiceExpenseForm's service fields), each of
 * which owns its own react-hook-form schema. Storing plain records keeps this
 * store decoupled from those schemas; the forms seed their own defaults from it.
 */

/** RHF field values for the Product/Material form (ExpenseForm), partial. */
export interface ProductDraftFields {
  mode?: 'single' | 'itemized';
  date?: string;
  vendorId?: string;
  vendorName?: string;
  category?: string;
  subcategory?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  deliveryFrom?: string;
  deliveryTo?: string;
  amount?: number;
  description?: string;
  paymentMethod?: string;
  paymentDetails?: string;
  paid?: boolean;
  accountingClassification?: string;
  expenseType?: string;
  notes?: string;
}

/** Non-RHF UI state that's part of an in-progress product expense. */
export interface ProductDraftExtras {
  isPaid?: boolean;
  isResell?: boolean;
  cuttingState?: CuttingPurchaseState;
  cuttingType?: string;
  items?: ExpenseItem[];
  newVendorSupplies?: VendorSupply[];
}

export type ProductDraft = ProductDraftFields & ProductDraftExtras;

/** RHF field values for the Service form (ServiceExpenseForm), partial. */
export interface ServiceDraftFields {
  date?: string;
  category?: string;
  subcategory?: string;
  vendorId?: string;
  vendorName?: string;
  amount?: number;
  paymentMethod?: string;
  paymentDetails?: string;
  paid?: boolean;
  accountingClassification?: string;
  expenseType?: string;
  description?: string;
  notes?: string;
}

/** Non-RHF UI state that's part of an in-progress service expense. */
export interface ServiceDraftExtras {
  isPaid?: boolean;
}

export type ServiceDraft = ServiceDraftFields & ServiceDraftExtras;

interface ExpenseDraftState {
  /** Which top-level form the user last had open ('product' | 'service'). */
  kind: 'product' | 'service';
  /** In-progress Product/Material expense (single or itemized). */
  product: ProductDraft;
  /** In-progress Service expense. */
  service: ServiceDraft;

  /** Remember the Product/Service toggle. */
  setKind: (kind: 'product' | 'service') => void;
  /** Merge a partial update into the product draft. */
  patchProduct: (partial: ProductDraft) => void;
  /** Merge a partial update into the service draft. */
  patchService: (partial: ServiceDraft) => void;
  /** Wipe the draft — called after a successful save or an explicit discard. */
  clear: () => void;
}

const EMPTY_PRODUCT: ProductDraft = {};
const EMPTY_SERVICE: ServiceDraft = {};

const hasText = (v: string | undefined): boolean => !!v && v.trim().length > 0;
const hasPositive = (v: number | undefined): boolean => !!v && v > 0;

/**
 * Whether a product draft holds any USER-entered content — i.e. something worth
 * restoring. Deliberately ignores fields that carry a non-empty DEFAULT on a
 * fresh form (date = today, paymentMethod = 'Cash', mode, paid/isPaid, resell,
 * cuttingState) so an untouched form is NOT treated as a draft. Clearing the
 * meaningful fields makes this return false again, hiding the "unsaved draft"
 * banner.
 */
export function productDraftHasContent(d: ProductDraft): boolean {
  return (
    hasText(d.category) ||
    hasText(d.subcategory) ||
    hasText(d.vendorId) ||
    hasText(d.vendorName) ||
    hasText(d.description) ||
    hasText(d.notes) ||
    hasText(d.deliveryFrom) ||
    hasText(d.deliveryTo) ||
    hasText(d.accountingClassification) ||
    hasText(d.expenseType) ||
    hasPositive(d.quantity) ||
    hasPositive(d.unitPrice) ||
    hasPositive(d.amount) ||
    (d.items?.length ?? 0) > 0 ||
    (d.newVendorSupplies?.length ?? 0) > 0
  );
}

/** Whether a service draft holds any user-entered content (see above). */
export function serviceDraftHasContent(d: ServiceDraft): boolean {
  return (
    hasText(d.category) ||
    hasText(d.subcategory) ||
    hasText(d.vendorId) ||
    hasText(d.vendorName) ||
    hasText(d.description) ||
    hasText(d.notes) ||
    hasText(d.accountingClassification) ||
    hasText(d.expenseType) ||
    hasPositive(d.amount)
  );
}

export const useExpenseDraftStore = create<ExpenseDraftState>()(
  persist(
    (set) => ({
      kind: 'product',
      product: EMPTY_PRODUCT,
      service: EMPTY_SERVICE,

      setKind: (kind) => set({ kind }),
      patchProduct: (partial) =>
        set((state) => ({ product: { ...state.product, ...partial } })),
      patchService: (partial) =>
        set((state) => ({ service: { ...state.service, ...partial } })),
      clear: () =>
        set({ kind: 'product', product: EMPTY_PRODUCT, service: EMPTY_SERVICE }),
    }),
    { name: 'dfd-expense-draft', version: 1 },
  ),
);

/**
 * Reactive selector: whether the CURRENTLY-OPEN form (per `kind`) has any
 * user-entered content — drives the "unsaved draft" banner. Recomputed as the
 * draft changes, so it appears once real content is typed and disappears again
 * when everything is cleared.
 */
export function useExpenseDraftHasContent(): boolean {
  return useExpenseDraftStore((s) =>
    s.kind === 'service' ? serviceDraftHasContent(s.service) : productDraftHasContent(s.product),
  );
}
