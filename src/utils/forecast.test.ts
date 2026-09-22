import { describe, it, expect } from 'vitest';
import { buildForecast, forecastTotals, fruitsPerCutting, harvestDays, type Deployment } from './forecast';
import {
  YIELD_FRUITS_GRAFTED, YIELD_FRUITS_UNROOTED, HARVEST_DAYS_GRAFTED, HARVEST_DAYS_UNROOTED,
  CUTTING_TYPE_GRAFTED, CUTTING_TYPE_UNROOTED,
} from '../constants';

describe('forecast yield/timeline helpers', () => {
  it('fruitsPerCutting falls back to the constants by type', () => {
    expect(fruitsPerCutting(CUTTING_TYPE_GRAFTED)).toBe(YIELD_FRUITS_GRAFTED);
    expect(fruitsPerCutting(CUTTING_TYPE_UNROOTED)).toBe(YIELD_FRUITS_UNROOTED);
  });

  it('fruitsPerCutting honors overridden assumptions', () => {
    expect(fruitsPerCutting(CUTTING_TYPE_GRAFTED, { yieldFruitsGrafted: 40 })).toBe(40);
    expect(fruitsPerCutting(CUTTING_TYPE_UNROOTED, { yieldFruitsUnrooted: 9 })).toBe(9);
  });

  it('harvestDays falls back to the constants by type', () => {
    expect(harvestDays(CUTTING_TYPE_GRAFTED)).toBe(HARVEST_DAYS_GRAFTED);
    expect(harvestDays(CUTTING_TYPE_UNROOTED)).toBe(HARVEST_DAYS_UNROOTED);
  });
});

describe('buildForecast farm pool', () => {
  const farmDeployment = (over: Partial<Deployment> = {}): Deployment => ({
    pool: 'farm',
    cuttingType: CUTTING_TYPE_GRAFTED,
    quantity: 10,
    deploymentDate: '2026-06-01',
    variety: 'Thai White',
    ...over,
  });

  it('aggregates a farm-pool deployment into the farm bucket, using fruitsPerUnit', () => {
    const windows = buildForecast(
      [farmDeployment({ quantity: 10, fruitsPerUnit: 30 })],
      { fruitWeightKg: 0.5 },
    );
    expect(windows).toHaveLength(1);
    const w = windows[0];
    expect(w.farm.pieces).toBe(300); // 10 plants × 30 fruits
    expect(w.farm.kg).toBeCloseTo(150); // 300 × 0.5
    expect(w.farm.cuttings).toBe(10);
    // internal/partner untouched; totals include the farm bucket.
    expect(w.internal.kg).toBe(0);
    expect(w.partner.kg).toBe(0);
    expect(w.totalKg).toBeCloseTo(150);
  });

  it('separates farm, internal and partner pools within the same window', () => {
    const date = '2026-06-01';
    const windows = buildForecast(
      [
        farmDeployment({ deploymentDate: date, quantity: 10, fruitsPerUnit: 30 }),
        { pool: 'internal', cuttingType: CUTTING_TYPE_GRAFTED, quantity: 5, deploymentDate: date, variety: 'Thai White' },
        { pool: 'partner', cuttingType: CUTTING_TYPE_GRAFTED, quantity: 2, deploymentDate: date, variety: 'Thai White' },
      ],
      { fruitWeightKg: 1, yieldFruitsGrafted: 10 },
    );
    // All three land in the same harvest window (same deploy date + type).
    expect(windows).toHaveLength(1);
    const w = windows[0];
    expect(w.farm.pieces).toBe(300);   // 10 × 30 (override)
    expect(w.internal.pieces).toBe(50); // 5 × 10 (assumption)
    expect(w.partner.pieces).toBe(20);  // 2 × 10
    expect(w.totalPieces).toBe(370);
  });

  it('forecastTotals reports farmKg + rolls it into totalKg', () => {
    const windows = buildForecast(
      [farmDeployment({ quantity: 4, fruitsPerUnit: 25 })],
      { fruitWeightKg: 1 },
    );
    const totals = forecastTotals(windows);
    expect(totals.farmKg).toBeCloseTo(100); // 4 × 25 × 1
    expect(totals.internalKg).toBe(0);
    expect(totals.partnerKg).toBe(0);
    expect(totals.totalKg).toBeCloseTo(100);
  });

  it('skips zero-quantity deployments', () => {
    expect(buildForecast([farmDeployment({ quantity: 0 })])).toHaveLength(0);
  });
});
