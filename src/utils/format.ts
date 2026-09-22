import { format, parseISO } from 'date-fns';

/** Format a PHP peso amount */
export function formatPHP(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Format a USD amount */
export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Format a plain number with commas */
export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format a quantity for display: whole numbers show with no decimals ("9"),
 * fractional values keep up to 2 significant decimals with trailing zeros
 * trimmed ("2.5", "2.25"). Avoids the confusing "9.00 bottle" phrasing while
 * still supporting fractional units like kilograms.
 */
export function formatQty(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Format an ISO date string to a readable date */
export function formatDate(isoString: string, fmt = 'MMM d, yyyy'): string {
  if (!isoString) return '—';
  try {
    return format(parseISO(isoString), fmt);
  } catch {
    return isoString;
  }
}

/** Format a pay period range */
export function formatPayPeriod(start: string, end: string): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/**
 * Canonical combined display label for the shared two-level taxonomy.
 * Returns "Category – Subcategory" when a subcategory exists, else just the
 * category. This is a DERIVED label only — never store it as an identity field.
 */
export function categoryLabel(category: string, subcategory: string): string {
  return subcategory ? `${category} – ${subcategory}` : category;
}
