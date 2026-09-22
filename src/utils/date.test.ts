import { describe, it, expect } from 'vitest';
import { format, addDays, subDays } from 'date-fns';
import { todayISO, isFutureDate, sectionHarvestWindow } from './date';
import {
  FARM_STAGE_FLOWERING, FARM_STAGE_FRUITING, FARM_STAGE_MIXED, FRUIT_DAYS_FLOWER_TO_HARVEST,
} from '../constants';

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

describe('isFutureDate', () => {
  it('is false for today', () => {
    expect(isFutureDate(todayISO())).toBe(false);
  });

  it('is false for a past date', () => {
    expect(isFutureDate(iso(subDays(new Date(), 1)))).toBe(false);
  });

  it('is true for a future date', () => {
    expect(isFutureDate(iso(addDays(new Date(), 1)))).toBe(true);
  });

  it('is false for an empty string', () => {
    expect(isFutureDate('')).toBe(false);
  });
});

describe('sectionHarvestWindow', () => {
  const flowerDate = '2026-06-01';

  it('estimates ~30 days out only when the section is Flowering with a stage date', () => {
    const w = sectionHarvestWindow({ lifecycleStage: FARM_STAGE_FLOWERING, stageDate: flowerDate });
    expect(w).not.toBeNull();
    // Flowering + FRUIT_DAYS_FLOWER_TO_HARVEST → the expected fruiting date.
    const expected = iso(addDays(new Date(`${flowerDate}T00:00:00`), FRUIT_DAYS_FLOWER_TO_HARVEST));
    expect(iso(new Date(w!.date))).toBe(expected);
  });

  it('returns null for a non-flowering stage (no estimate implied)', () => {
    expect(sectionHarvestWindow({ lifecycleStage: FARM_STAGE_FRUITING, stageDate: flowerDate })).toBeNull();
    expect(sectionHarvestWindow({ lifecycleStage: FARM_STAGE_MIXED, stageDate: flowerDate })).toBeNull();
  });

  it('returns null when flowering but no stage date, or when untagged/undefined', () => {
    expect(sectionHarvestWindow({ lifecycleStage: FARM_STAGE_FLOWERING })).toBeNull();
    expect(sectionHarvestWindow({})).toBeNull();
    expect(sectionHarvestWindow(undefined)).toBeNull();
  });
});
