/**
 * Farm-area normalization.
 *
 * Farm sections store `area` in mixed units (Sqm, Hectare, Acre, or TBD — see
 * FARM_AREA_UNITS). To compute a single "total cultivated area" and a
 * "yield per area" efficiency benchmark, we normalize everything to hectares
 * (the common agricultural unit here) before summing.
 *
 * TBD / unknown units contribute 0 area (they have no measurable footprint yet).
 */

/** Square meters per hectare. */
const SQM_PER_HECTARE = 10_000;
/** Hectares per acre. */
const HECTARE_PER_ACRE = 0.404686;

/** Convert a single area value in the given unit to hectares. */
export function toHectares(area: number, unit: string): number {
  const value = Number(area) || 0;
  if (value <= 0) return 0;
  switch ((unit || '').toLowerCase()) {
    case 'hectare':
    case 'hectares':
    case 'ha':
      return value;
    case 'acre':
    case 'acres':
      return value * HECTARE_PER_ACRE;
    case 'sqm':
    case 'sq m':
    case 'square meter':
    case 'square meters':
    case 'm2':
      return value / SQM_PER_HECTARE;
    // 'TBD' and anything unrecognized: no measurable area.
    default:
      return 0;
  }
}

/** Sum a list of {area, unit} sections into a single hectare total. */
export function totalHectares(sections: { area: number; unit: string }[]): number {
  return sections.reduce((sum, s) => sum + toHectares(s.area, s.unit), 0);
}

/** Format a hectare figure for display (e.g. "1.24 ha"). */
export function formatHectares(ha: number): string {
  return `${ha.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
}
