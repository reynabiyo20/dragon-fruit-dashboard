import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SaleItem } from '../types';

/**
 * In-progress "New Sale" draft persistence.
 *
 * Mirrors `expenseDraftStore`: the New Sale modal is a lazy route subtree that
 * fully unmounts when closed or navigated away, so anything typed into a NEW
 * (not-yet-saved) sale would be lost. This store keeps that half-filled draft
 * alive (behind `persist`, so it also survives reloads) until the user either
 * saves the sale (draft cleared) or explicitly discards it.
 *
 * Only NEW sales are drafted. Editing an existing sale never touches this store.
 *
 * The draft is loosely typed to stay decoupled from the SaleForm's RHF schema;
 * the form seeds its own defaults from it.
 */

/** A sale line with its stable editor key (SaleForm's EditableItem shape). */
export type SaleDraftItem = SaleItem & { _key: string };

/** RHF field values for the Sale form, partial. */
export interface SaleDraftFields {
  date?: string;
  invoiceNumber?: string;
  customerId?: string;
  customerName?: string;
  country?: string;
  saleType?: string;
  customerPhone?: string;
  customerFbMessenger?: string;
  customerAddress?: string;
  paymentMethod?: string;
  paymentDetails?: string;
  paid?: boolean;
  soldByEmployeeId?: string;
  notes?: string;
}

/** Non-RHF UI state that's part of an in-progress sale. */
export interface SaleDraftExtras {
  items?: SaleDraftItem[];
  /** Lines whose surcharge the user manually overrode, keyed by item _key. */
  surchargeOverridden?: Record<string, boolean>;
  /** Lines whose quantity the user actually entered, keyed by item _key. */
  quantityEntered?: Record<string, boolean>;
  isPaid?: boolean;
  isDelivered?: boolean;
}

export type SaleDraft = SaleDraftFields & SaleDraftExtras;

interface SaleDraftState {
  /** In-progress sale. */
  draft: SaleDraft;

  /** Merge a partial update into the draft. */
  patch: (partial: SaleDraft) => void;
  /** Wipe the draft — called after a successful save or an explicit discard. */
  clear: () => void;
}

const EMPTY: SaleDraft = {};

const hasText = (v: string | undefined): boolean => !!v && v.trim().length > 0;

/**
 * Whether a sale draft holds any USER-entered content — i.e. something worth
 * restoring. Ignores fields that carry a non-empty DEFAULT on a fresh form
 * (date = today, paymentMethod = 'Cash', country, paid/isPaid) so an untouched
 * form is NOT treated as a draft. Clearing the meaningful fields makes this
 * return false again, hiding the "unsaved draft" banner.
 */
export function saleDraftHasContent(d: SaleDraft): boolean {
  return (
    hasText(d.customerId) ||
    hasText(d.customerName) ||
    hasText(d.saleType) ||
    hasText(d.customerPhone) ||
    hasText(d.customerFbMessenger) ||
    hasText(d.customerAddress) ||
    hasText(d.soldByEmployeeId) ||
    hasText(d.notes) ||
    (d.items?.length ?? 0) > 0
  );
}

export const useSaleDraftStore = create<SaleDraftState>()(
  persist(
    (set) => ({
      draft: EMPTY,
      patch: (partial) => set((state) => ({ draft: { ...state.draft, ...partial } })),
      clear: () => set({ draft: EMPTY }),
    }),
    { name: 'dfd-sale-draft', version: 1 },
  ),
);

/**
 * Reactive selector: whether the in-progress sale draft has any user-entered
 * content — drives the "unsaved draft" banner. Appears once real content is
 * typed and disappears again when everything is cleared.
 */
export function useSaleDraftHasContent(): boolean {
  return useSaleDraftStore((s) => saleDraftHasContent(s.draft));
}
