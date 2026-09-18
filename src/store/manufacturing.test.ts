import { describe, it, expect, beforeEach } from 'vitest';

import { useManufacturingStore } from './manufacturingStore';
import { useInventoryStore } from './inventoryStore';
import { generateId, now } from '../utils/id';
import type { InventoryItem } from '../types';

/**
 * Manufacturing / transformation: inventory inputs are consumed (via `used`,
 * lowering their ending qty) and staged into a run for a target product. The
 * Produce step credits the target's `produced` pool (raising its ending qty) and
 * closes the run. Staging is captured as a structured input list.
 */
function invRow(category: string, subcategory: string, over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: generateId(), category, subcategory, unit: 'kg',
    beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 0,
    unitCost: 0, packed: 0, needsPacking: 0, breedingStock: 0, availableForSale: 0, produced: 0,
    notes: '', createdAt: now(), updatedAt: now(), ...over,
  };
}

const row = (c: string, s: string) => useInventoryStore.getState().findByCategorySub(c, s);

beforeEach(() => {
  useManufacturingStore.setState({ runs: [], _seeded: 1 });
  // One fruit input with 10 on hand (beginning 10), and no drink row yet.
  useInventoryStore.setState({
    items: [invRow('Fruit', 'Calamansi', { beginningQty: 10, endingQty: 10, unit: 'kg' })],
    _seeded: 999,
  });
});

describe('produced pool feeds ending qty and defaults to 0', () => {
  it('adjustProduced raises ending qty', () => {
    const r = row('Fruit', 'Calamansi')!;
    useInventoryStore.getState().adjustProduced(r.id, 5);
    const after = row('Fruit', 'Calamansi')!;
    expect(after.produced).toBe(5);
    expect(after.endingQty).toBe(15); // 10 beginning + 5 produced
  });
});

describe('staging an input for production', () => {
  it('stages the input into an open run for the target', () => {
    useManufacturingStore.getState().stageInput({
      targetCategory: 'Drink', targetSubcategory: 'Calamansi', targetUnit: 'bottle',
      input: { category: 'Fruit', subcategory: 'Calamansi', quantity: 3, unit: 'kg' },
    });
    const run = useManufacturingStore.getState().openRunFor('Drink', 'Calamansi');
    expect(run).toBeDefined();
    expect(run!.status).toBe('staged');
    expect(run!.inputs).toHaveLength(1);
    expect(run!.inputs[0]).toMatchObject({ category: 'Fruit', subcategory: 'Calamansi', quantity: 3, unit: 'kg' });
  });

  it('accumulates multiple inputs into the same open run (multi-ingredient)', () => {
    const m = useManufacturingStore.getState();
    m.stageInput({ targetCategory: 'Fertilizer', targetSubcategory: 'OurBlend', targetUnit: 'sack',
      input: { category: 'Fertilizer', subcategory: 'Cocopeat', quantity: 2, unit: 'sack' } });
    m.stageInput({ targetCategory: 'Fertilizer', targetSubcategory: 'OurBlend', targetUnit: 'sack',
      input: { category: 'Fertilizer', subcategory: 'Neem Oil', quantity: 1, unit: 'bottle' } });
    const run = useManufacturingStore.getState().openRunFor('Fertilizer', 'OurBlend')!;
    expect(run.inputs).toHaveLength(2);
  });
});

describe('produce closes the run and credits finished stock', () => {
  it('produceRun marks produced and adjustProduced credits the target ending qty', () => {
    const m = useManufacturingStore.getState();
    // Stage 3 kg fruit for a drink + deduct it from the fruit row (as the UI does).
    m.stageInput({ targetCategory: 'Drink', targetSubcategory: 'Calamansi', targetUnit: 'bottle',
      input: { category: 'Fruit', subcategory: 'Calamansi', quantity: 3, unit: 'kg' } });
    const fruit = row('Fruit', 'Calamansi')!;
    useInventoryStore.getState().updateItem(fruit.id, { used: 3 });
    expect(row('Fruit', 'Calamansi')!.endingQty).toBe(7); // 10 - 3 used

    // Ensure a target row exists, then produce 12 bottles.
    const drink = useInventoryStore.getState().ensureRow('Drink', 'Calamansi', 'bottle');
    const run = m.openRunFor('Drink', 'Calamansi')!;
    const produced = m.produceRun(run.id, 12, 'bottle');
    useInventoryStore.getState().adjustProduced(drink.id, 12);

    expect(produced!.status).toBe('produced');
    expect(produced!.producedQty).toBe(12);
    expect(useManufacturingStore.getState().openRunFor('Drink', 'Calamansi')).toBeUndefined(); // run closed
    const drinkAfter = row('Drink', 'Calamansi')!;
    expect(drinkAfter.produced).toBe(12);
    expect(drinkAfter.endingQty).toBe(12); // finished goods now on hand
  });

  it('producing does not affect the consumed input row further', () => {
    const m = useManufacturingStore.getState();
    m.stageInput({ targetCategory: 'Drink', targetSubcategory: 'Calamansi', targetUnit: 'bottle',
      input: { category: 'Fruit', subcategory: 'Calamansi', quantity: 4, unit: 'kg' } });
    const fruit = row('Fruit', 'Calamansi')!;
    useInventoryStore.getState().updateItem(fruit.id, { used: 4 });
    const drink = useInventoryStore.getState().ensureRow('Drink', 'Calamansi', 'bottle');
    const run = m.openRunFor('Drink', 'Calamansi')!;
    m.produceRun(run.id, 10, 'bottle');
    useInventoryStore.getState().adjustProduced(drink.id, 10);
    expect(row('Fruit', 'Calamansi')!.endingQty).toBe(6); // still 10 - 4, untouched by produce
  });
});
