import { describe, it, expect, beforeEach } from 'vitest';
import { useFarmStore } from './farmStore';

const store = () => useFarmStore.getState();

beforeEach(() => {
  useFarmStore.setState({ sections: [], plantings: [], _seeded: 999 });
});

describe('farmStore standing plants', () => {
  it('adds a planting and rolls it up by variety', () => {
    const sec = store().addSection({
      sectionType: 'Post', area: 0, unit: 'Sqm', currentPlantCapacity: 0, plantSubcategory: '', pic: '', notes: '',
    });
    store().addPlanting({ sectionId: sec.id, subcategory: 'Thai White', plantCount: 400 });
    store().addPlanting({ sectionId: sec.id, subcategory: 'Thai White', plantCount: 100 });
    store().addPlanting({ sectionId: sec.id, subcategory: 'Thai Red', plantCount: 50 });

    expect(store().plantsForVariety('Thai White')).toBe(500);
    expect(store().standingByVariety()).toEqual({ 'Thai White': 500, 'Thai Red': 50 });
    expect(store().plantingsForSection(sec.id)).toHaveLength(3);
  });

  it('updates and deletes a planting', () => {
    const sec = store().addSection({
      sectionType: 'Greenhouse', area: 0, unit: 'Sqm', currentPlantCapacity: 0, plantSubcategory: '', pic: '', notes: '',
    });
    const p = store().addPlanting({ sectionId: sec.id, subcategory: 'Thai White', plantCount: 100 });
    store().updatePlanting(p.id, { plantCount: 250 });
    expect(store().plantsForVariety('Thai White')).toBe(250);
    store().deletePlanting(p.id);
    expect(store().plantings).toHaveLength(0);
  });

  it('deleting a section cascades away its plantings', () => {
    const a = store().addSection({ sectionType: 'Post', area: 0, unit: 'Sqm', currentPlantCapacity: 0, plantSubcategory: '', pic: '', notes: '' });
    const b = store().addSection({ sectionType: 'Trellis', area: 0, unit: 'Sqm', currentPlantCapacity: 0, plantSubcategory: '', pic: '', notes: '' });
    store().addPlanting({ sectionId: a.id, subcategory: 'Thai White', plantCount: 100 });
    store().addPlanting({ sectionId: b.id, subcategory: 'Thai Red', plantCount: 50 });
    store().deleteSection(a.id);
    expect(store().plantings).toHaveLength(1);
    expect(store().plantings[0].sectionId).toBe(b.id);
  });

  it('upsertFromBatch graduates a batch into standing plants exactly once (dedupe by sourceBatchId)', () => {
    const sec = store().addSection({ sectionType: 'Post', area: 0, unit: 'Sqm', currentPlantCapacity: 0, plantSubcategory: '', pic: '', notes: '' });
    store().upsertFromBatch({ sourceBatchId: 'batch-1', sectionId: sec.id, subcategory: 'Thai White', plantCount: 200 });
    // A second upsert for the same batch updates the SAME planting (no duplicate).
    store().upsertFromBatch({ sourceBatchId: 'batch-1', sectionId: sec.id, subcategory: 'Thai White', plantCount: 180 });
    const fromBatch = store().plantings.filter((p) => p.sourceBatchId === 'batch-1');
    expect(fromBatch).toHaveLength(1);
    expect(fromBatch[0].plantCount).toBe(180);

    store().removeForBatch('batch-1');
    expect(store().plantings.filter((p) => p.sourceBatchId === 'batch-1')).toHaveLength(0);
  });
});

describe('farmStore section-scoped selectors (harvest cascade source)', () => {
  it('varietiesForSection lists distinct varieties planted in that section only', () => {
    const a = store().addSection({ sectionType: 'Post', area: 0, unit: 'Sqm', currentPlantCapacity: 0, plantSubcategory: '', pic: '', notes: '' });
    const b = store().addSection({ sectionType: 'Trellis', area: 0, unit: 'Sqm', currentPlantCapacity: 0, plantSubcategory: '', pic: '', notes: '' });
    store().addPlanting({ sectionId: a.id, subcategory: 'Thai White', plantCount: 400 });
    store().addPlanting({ sectionId: a.id, subcategory: 'Thai White', plantCount: 100 }); // dup variety, same section
    store().addPlanting({ sectionId: a.id, subcategory: 'Thai Red', plantCount: 50 });
    store().addPlanting({ sectionId: b.id, subcategory: 'Sugar Dragon', plantCount: 30 });

    expect(store().varietiesForSection(a.id)).toEqual(['Thai Red', 'Thai White']); // distinct + sorted
    expect(store().varietiesForSection(b.id)).toEqual(['Sugar Dragon']);
    expect(store().varietiesForSection('nope')).toEqual([]);
  });

  it('plantsForSectionVariety sums the living count for one (section, variety) pair', () => {
    const a = store().addSection({ sectionType: 'Post', area: 0, unit: 'Sqm', currentPlantCapacity: 0, plantSubcategory: '', pic: '', notes: '' });
    const b = store().addSection({ sectionType: 'Trellis', area: 0, unit: 'Sqm', currentPlantCapacity: 0, plantSubcategory: '', pic: '', notes: '' });
    store().addPlanting({ sectionId: a.id, subcategory: 'Thai White', plantCount: 400 });
    store().addPlanting({ sectionId: a.id, subcategory: 'Thai White', plantCount: 100 });
    store().addPlanting({ sectionId: b.id, subcategory: 'Thai White', plantCount: 999 }); // different section — excluded

    expect(store().plantsForSectionVariety(a.id, 'Thai White')).toBe(500);
    expect(store().plantsForSectionVariety(a.id, 'thai white')).toBe(500); // case-insensitive
    expect(store().plantsForSectionVariety(a.id, 'Thai Red')).toBe(0);
  });
});
