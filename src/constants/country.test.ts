import { describe, it, expect } from 'vitest';
import { countryOf, isInternationalLocation, PHILIPPINES } from './geography';

/**
 * Country helpers. A missing/blank country is treated as the Philippines (local),
 * so legacy records without a country stay local.
 */
describe('country helpers', () => {
  it('defaults a missing country to the Philippines', () => {
    expect(countryOf(undefined)).toBe(PHILIPPINES);
    expect(countryOf({ province: '', municipality: '' })).toBe(PHILIPPINES);
    expect(countryOf({ country: '', province: '', municipality: '' })).toBe(PHILIPPINES);
    expect(countryOf({ country: '  ', province: '', municipality: '' })).toBe(PHILIPPINES);
  });

  it('reads an explicit country', () => {
    expect(countryOf({ country: 'United States', province: '', municipality: '' })).toBe('United States');
  });

  it('flags non-Philippine locations as international', () => {
    expect(isInternationalLocation({ country: PHILIPPINES, province: 'Bulacan', municipality: '' })).toBe(false);
    expect(isInternationalLocation(undefined)).toBe(false);
    expect(isInternationalLocation({ country: 'Singapore', province: '', municipality: '' })).toBe(true);
  });
});
