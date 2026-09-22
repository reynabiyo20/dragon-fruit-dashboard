/**
 * Philippine geographic dataset for location tracking.
 *
 * Customers and Vendors carry a required { province, municipality } location.
 * This module is the single source of truth for the cascading selectors: every
 * province maps to its municipalities, and independent-city labels are
 * intentionally excluded so the two-level Province → Municipality drill-down
 * stays consistent everywhere it's used (forms + dashboard aggregation).
 */
import { toOptions, type Option } from './index';
import type { Location } from '../types';

/**
 * Province → municipalities map. Ordered as provided so the source listing stays
 * auditable; the option builders sort for display.
 */
export const PROVINCE_MUNICIPALITIES: Record<string, readonly string[]> = {
  'Metro Manila': ['Pateros'],
  'Ilocos Norte': ['Bangui'],
  'Ilocos Sur': ['Bantay'],
  'La Union': ['Bauang'],
  'Pangasinan': ['Lingayen'],
  'Batanes': ['Basco'],
  'Cagayan': ['Aparri'],
  'Isabela': ['Tumauini'],
  'Nueva Vizcaya': ['Bayombong'],
  'Quirino': ['Cabarroguis'],
  'Aurora': ['Baler'],
  'Bataan': ['Mariveles'],
  'Bulacan': ['Santa Maria'],
  'Nueva Ecija': ['Guimba'],
  'Pampanga': ['Lubao'],
  'Tarlac': ['Concepcion'],
  'Zambales': ['Iba'],
  'Batangas': ['Nasugbu'],
  'Cavite': ['Silang'],
  'Laguna': ['Santa Cruz'],
  'Rizal': ['Cainta'],
  'Quezon': ['Sariaya'],
  'Marinduque': ['Boac'],
  'Occidental Mindoro': ['Mamburao'],
  'Oriental Mindoro': ['Pinamalayan'],
  'Palawan': ['El Nido'],
  'Romblon': ['Romblon'],
  'Albay': ['Daraga'],
  'Camarines Norte': ['Daet'],
  'Camarines Sur': ['Pili'],
  'Catanduanes': ['Virac'],
  'Masbate': ['Aroroy'],
  'Sorsogon': ['Bulan'],
  'Aklan': ['Kalibo'],
  'Antique': ['San Jose de Buenavista'],
  'Capiz': ['Panay'],
  'Guimaras': ['Jordan'],
  'Iloilo': ['Oton'],
  'Negros Occidental': ['Binalbagan'],
  'Bohol': ['Tubigon'],
  'Cebu': ['Consolacion'],
  'Negros Oriental': ['Sibulan'],
  'Siquijor': ['Siquijor'],
  'Biliran': ['Naval'],
  'Eastern Samar': ['Guiuan'],
  'Leyte': ['Hilongos'],
  'Northern Samar': ['Catarman'],
  'Samar': ['Basey'],
};

/**
 * Province → region lookup. Region is NOT stored on any record (the persisted
 * location stays strictly province + municipality); it's derived here so the
 * dashboard can roll province-level figures up to a regional view. Metro Manila
 * is the NCR — kept as a "province" label in the dataset for the selectors, but
 * mapped to its region here.
 */
export const PROVINCE_REGION: Record<string, string> = {
  'Metro Manila': 'NCR',
  'Ilocos Norte': 'Region I (Ilocos Region)',
  'Ilocos Sur': 'Region I (Ilocos Region)',
  'La Union': 'Region I (Ilocos Region)',
  'Pangasinan': 'Region I (Ilocos Region)',
  'Batanes': 'Region II (Cagayan Valley)',
  'Cagayan': 'Region II (Cagayan Valley)',
  'Isabela': 'Region II (Cagayan Valley)',
  'Nueva Vizcaya': 'Region II (Cagayan Valley)',
  'Quirino': 'Region II (Cagayan Valley)',
  'Aurora': 'Region III (Central Luzon)',
  'Bataan': 'Region III (Central Luzon)',
  'Bulacan': 'Region III (Central Luzon)',
  'Nueva Ecija': 'Region III (Central Luzon)',
  'Pampanga': 'Region III (Central Luzon)',
  'Tarlac': 'Region III (Central Luzon)',
  'Zambales': 'Region III (Central Luzon)',
  'Batangas': 'Region IV-A (CALABARZON)',
  'Cavite': 'Region IV-A (CALABARZON)',
  'Laguna': 'Region IV-A (CALABARZON)',
  'Rizal': 'Region IV-A (CALABARZON)',
  'Quezon': 'Region IV-A (CALABARZON)',
  'Marinduque': 'Region IV-B (MIMAROPA)',
  'Occidental Mindoro': 'Region IV-B (MIMAROPA)',
  'Oriental Mindoro': 'Region IV-B (MIMAROPA)',
  'Palawan': 'Region IV-B (MIMAROPA)',
  'Romblon': 'Region IV-B (MIMAROPA)',
  'Albay': 'Region V (Bicol Region)',
  'Camarines Norte': 'Region V (Bicol Region)',
  'Camarines Sur': 'Region V (Bicol Region)',
  'Catanduanes': 'Region V (Bicol Region)',
  'Masbate': 'Region V (Bicol Region)',
  'Sorsogon': 'Region V (Bicol Region)',
  'Aklan': 'Region VI (Western Visayas)',
  'Antique': 'Region VI (Western Visayas)',
  'Capiz': 'Region VI (Western Visayas)',
  'Guimaras': 'Region VI (Western Visayas)',
  'Iloilo': 'Region VI (Western Visayas)',
  'Negros Occidental': 'Region VI (Western Visayas)',
  'Bohol': 'Region VII (Central Visayas)',
  'Cebu': 'Region VII (Central Visayas)',
  'Negros Oriental': 'Region VII (Central Visayas)',
  'Siquijor': 'Region VII (Central Visayas)',
  'Biliran': 'Region VIII (Eastern Visayas)',
  'Eastern Samar': 'Region VIII (Eastern Visayas)',
  'Leyte': 'Region VIII (Eastern Visayas)',
  'Northern Samar': 'Region VIII (Eastern Visayas)',
  'Samar': 'Region VIII (Eastern Visayas)',
};

// ─── Country (international support) ─────────────────────────────────────────
/**
 * The home country. A location in the Philippines uses the Province →
 * Municipality drill-down below; any other country is "international" and skips
 * those Philippine-only fields. Sales/expenses for international customers &
 * vendors are recorded in USD (kept strictly separate from PHP — never converted).
 */
export const PHILIPPINES = 'Philippines';

/**
 * A curated list of countries for the Country selector. Philippines is first
 * (the default/home country); the rest are common trading partners. "Other" is
 * a catch-all so any country can be recorded without maintaining a full ISO list.
 */
export const COUNTRIES = [
  PHILIPPINES,
  'United States',
  'Canada',
  'Australia',
  'United Kingdom',
  'Singapore',
  'Malaysia',
  'Japan',
  'South Korea',
  'China',
  'Hong Kong',
  'United Arab Emirates',
  'Saudi Arabia',
  'Qatar',
  'Germany',
  'Netherlands',
  'New Zealand',
  'Other',
] as const;

/** Options for the Country select, Philippines pinned first then the rest sorted. */
export const COUNTRY_OPTIONS: Option[] = [
  { value: PHILIPPINES, label: PHILIPPINES },
  ...toOptions(COUNTRIES.filter((c) => c !== PHILIPPINES)),
];

/**
 * Normalize a possibly-missing country to the effective value. Legacy records
 * with no country are treated as Philippines (local).
 */
export function countryOf(location: Location | undefined): string {
  const c = location?.country?.trim();
  return c && c.length > 0 ? c : PHILIPPINES;
}

/** True when a location is outside the Philippines (an international record). */
export function isInternationalLocation(location: Location | undefined): boolean {
  return countryOf(location) !== PHILIPPINES;
}

/** All provinces, for the first-level (Province) dropdown. */
export const PROVINCES = Object.keys(PROVINCE_MUNICIPALITIES);

/** Options for the Province select, sorted alphabetically. */
export const PROVINCE_OPTIONS: Option[] = toOptions(PROVINCES);

/**
 * Municipalities available for a given province, as select options. Returns an
 * empty list for an unknown/blank province so the dependent dropdown reveals
 * choices only after a province is chosen (cascading behavior).
 */
export function municipalityOptions(province: string): Option[] {
  return toOptions(PROVINCE_MUNICIPALITIES[province] ?? []);
}

/** True when the municipality genuinely belongs to the province. */
export function isValidLocation(province: string, municipality: string): boolean {
  const municipalities = PROVINCE_MUNICIPALITIES[province];
  return !!municipalities && municipalities.includes(municipality);
}

/** The region a province belongs to, or '' for a blank/unknown province. */
export function regionOf(province: string): string {
  return PROVINCE_REGION[province] ?? '';
}

/**
 * A short, human-readable label for a location, suited to a table cell:
 *  - International (non-Philippine) records show the country.
 *  - Philippine records show the province (the municipality is more granular
 *    than a single column needs).
 * Returns '' when there's nothing meaningful to show yet (a local record with no
 * province recorded), so callers can render a placeholder dash.
 */
export function locationLabel(location: Location | undefined): string {
  if (isInternationalLocation(location)) return countryOf(location);
  return location?.province?.trim() ?? '';
}
