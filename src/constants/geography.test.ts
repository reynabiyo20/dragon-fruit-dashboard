import { describe, it, expect } from 'vitest';
import {
  PROVINCES,
  PROVINCE_MUNICIPALITIES,
  PROVINCE_OPTIONS,
  PROVINCE_REGION,
  municipalityOptions,
  isValidLocation,
  regionOf,
} from './geography';

describe('geography dataset', () => {
  it('exposes every province from the dataset', () => {
    expect(PROVINCES).toHaveLength(48);
    expect(PROVINCES).toContain('Bulacan');
    expect(PROVINCES).toContain('Metro Manila');
    expect(PROVINCES).toContain('Samar');
  });

  it('sorts province options alphabetically (case-insensitive)', () => {
    const labels = PROVINCE_OPTIONS.map((o) => o.label);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    expect(labels).toEqual(sorted);
  });

  it('maps each province to exactly its municipalities', () => {
    expect(PROVINCE_MUNICIPALITIES['Bulacan']).toEqual(['Santa Maria']);
    expect(PROVINCE_MUNICIPALITIES['Metro Manila']).toEqual(['Pateros']);
    expect(PROVINCE_MUNICIPALITIES['Palawan']).toEqual(['El Nido']);
  });
});

describe('municipalityOptions', () => {
  it('returns the municipalities for a known province', () => {
    expect(municipalityOptions('Cavite').map((o) => o.value)).toEqual(['Silang']);
  });

  it('returns an empty list for a blank or unknown province (cascading gate)', () => {
    expect(municipalityOptions('')).toEqual([]);
    expect(municipalityOptions('Atlantis')).toEqual([]);
  });
});

describe('isValidLocation', () => {
  it('accepts a municipality that belongs to the province', () => {
    expect(isValidLocation('Rizal', 'Cainta')).toBe(true);
  });

  it('rejects a mismatched province/municipality pair', () => {
    expect(isValidLocation('Rizal', 'Silang')).toBe(false);
    expect(isValidLocation('', 'Cainta')).toBe(false);
    expect(isValidLocation('Rizal', '')).toBe(false);
  });
});

describe('regionOf', () => {
  it('derives the region from the province', () => {
    expect(regionOf('Bulacan')).toBe('Region III (Central Luzon)');
    expect(regionOf('Cavite')).toBe('Region IV-A (CALABARZON)');
    expect(regionOf('Metro Manila')).toBe('NCR');
  });

  it('returns an empty string for a blank or unknown province', () => {
    expect(regionOf('')).toBe('');
    expect(regionOf('Atlantis')).toBe('');
  });

  it('maps every province to a region', () => {
    PROVINCES.forEach((p) => {
      expect(PROVINCE_REGION[p]).toBeTruthy();
    });
  });
});
