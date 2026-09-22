/**
 * Late-binding invoice numbering.
 *
 * A sale's invoice number is assigned in two stages:
 *   1. DRAFT — while the sale is pending (unpaid) it carries a temporary,
 *      throwaway id like "DRAFT-9812". Drafts can be deleted freely; they never
 *      consume a slot in the official sequence.
 *   2. OFFICIAL — the moment the sale is finalized (marked paid), it is stamped
 *      with the next sequential official number like "INV-2026-1004". Official
 *      numbers are permanent: once assigned they are never reissued or reused,
 *      even if the sale is later set back to unpaid.
 */

export const DRAFT_PREFIX = 'DRAFT-';
export const OFFICIAL_PREFIX = 'INV-';

/** Official sequences start here, so the first finalized invoice of a year is 1001. */
export const INVOICE_SEQ_START = 1000;

/** Whether an invoice number is an official (finalized) one. */
export function isOfficialInvoice(invoiceNumber: string | undefined): boolean {
  return !!invoiceNumber && invoiceNumber.startsWith(OFFICIAL_PREFIX);
}

/** Whether an invoice number is a temporary draft id. */
export function isDraftInvoice(invoiceNumber: string | undefined): boolean {
  return !!invoiceNumber && invoiceNumber.startsWith(DRAFT_PREFIX);
}

/** Generate a temporary draft id, e.g. "DRAFT-9812" (random 4-digit suffix). */
export function generateDraftNumber(): string {
  const suffix = Math.floor(1000 + Math.random() * 9000); // 1000–9999
  return `${DRAFT_PREFIX}${suffix}`;
}

/** The 4-digit year used to scope the official sequence, from an ISO date (falls back to now). */
export function invoiceYearOf(dateISO: string | undefined): string {
  const year = dateISO ? new Date(dateISO).getFullYear() : NaN;
  return String(Number.isFinite(year) ? year : new Date().getFullYear());
}

/**
 * Format an official invoice number from a year + sequence, e.g.
 * formatOfficialNumber('2026', 1004) → "INV-2026-1004".
 */
export function formatOfficialNumber(year: string, seq: number): string {
  return `${OFFICIAL_PREFIX}${year}-${seq}`;
}
