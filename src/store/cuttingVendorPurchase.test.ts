import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useExpenseStore } from './expenseStore';
import { useInventoryStore } from './inventoryStore';
import { useCuttingStore } from './cuttingStore';
import { generateId, now } from '../utils/id';
import type { InventoryItem } from '../types';
import {
  CUTTINGS_PRODUCT_TYPE, CUTTING_SOURCE_PURCHASED, CUTTING_ALLOCATION_REPLANT,
  CUTTING_TYPE_UNROOTED,
} from '../constants';

/**
 * Buying cuttings via Expenses flagged "For replant (farm)" must:
 *  - create a Propagation batch (source: Purchased), pre-allocated For Replant,
 *  - credit ONLY breedingStock (never packed / needsPacking / availableForSale),
 *  - carry the vendor unit price as the batch cost basis and the cutting type,
 *  - stay in sync on edit and reverse cleanly on delete,
 *  - enter the plant → forecast lifecycle.
 */
function cuttingRow(subcategory: string): InventoryItem {
  return {
    id: generateId(), category: CUTTINGS_PRODUCT_TYPE, subcategory, unit: 'piece',
    beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 0, unitCost: 0,
    packed: 0, needsPacking: 0, breedingStock: 0, availableForSale: 0,
    produced: 0, harvested: 0, notes: '', createdAt: now(), updatedAt: now(),
  };
}

const rowOf = () =>
  useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'American Beauty');
const purchasedBatch = () =>
  useCuttingStore.getState().batches.find((b) => b.source === CUTTING_SOURCE_PURCHASED);

function replantExpense(over: Record<string, unknown> = {}) {
  return {
    date: '2026-09-20', vendorId: 'v1', vendorName: 'Tito Kris',
    category: CUTTINGS_PRODUCT_TYPE, subcategory: 'American Beauty', description: '',
    quantity: 500, unit: 'piece', unitPrice: 35, amount: 17500,
    // Pending, not paid: paid expenses are locked from edit/delete, so the
    // cascade fixtures use an unpaid (editable/deletable) expense.
    paymentMethod: 'Cash', paid: false, notes: '',
    cuttingState: 'replant' as const, cuttingType: CUTTING_TYPE_UNROOTED,
    ...over,
  };
}

describe('expense → propagation replant cascade', () => {
  beforeEach(() => {
    useExpenseStore.setState({ expenses: [] });
    useCuttingStore.setState({ batches: [] });
    useInventoryStore.setState({ items: [cuttingRow('American Beauty')], _seeded: 999 });
  });

  it('creates a Purchased batch reserved for replant, crediting only breedingStock', () => {
    useExpenseStore.getState().addExpense(replantExpense());

    const batch = purchasedBatch();
    expect(batch).toBeTruthy();
    expect(batch!.source).toBe(CUTTING_SOURCE_PURCHASED);
    expect(batch!.allocation).toBe(CUTTING_ALLOCATION_REPLANT);
    expect(batch!.quantitySourced).toBe(500);
    // Cost basis + cutting type carried from the expense.
    expect(batch!.sourceCostPerCutting).toBe(35);
    expect(batch!.cuttingType).toBe(CUTTING_TYPE_UNROOTED);
    expect(batch!.vendorName).toBe('Tito Kris');

    // No double-count: the batch owns breedingStock; sellable pools stay at 0.
    const row = rowOf()!;
    expect(row.breedingStock).toBe(500);
    expect(row.packed ?? 0).toBe(0);
    expect(row.needsPacking ?? 0).toBe(0);
    expect(row.availableForSale ?? 0).toBe(0);
    // breedingStock is tracking-only → does NOT inflate endingQty.
    expect(row.endingQty).toBe(0);
  });

  it('markPlanted moves it out of breedingStock and stamps a deployment date', () => {
    useExpenseStore.getState().addExpense(replantExpense());
    const batch = purchasedBatch()!;

    useCuttingStore.getState().markPlanted(batch.id);
    const planted = useCuttingStore.getState().getBatch(batch.id)!;
    expect(planted.planted).toBe(true);
    expect(planted.deploymentDate).toBeTruthy();
    expect(rowOf()!.breedingStock).toBe(0);
  });

  it('a planted purchased batch is eligible for the wholesale forecast', () => {
    useExpenseStore.getState().addExpense(replantExpense());
    const batch = purchasedBatch()!;
    useCuttingStore.getState().markPlanted(batch.id);

    // The forecast counts internal-pool deployments: allocation REPLANT + planted
    // + a deployment date. Assert the batch now satisfies that condition.
    const planted = useCuttingStore.getState().getBatch(batch.id)!;
    const eligible =
      planted.allocation === CUTTING_ALLOCATION_REPLANT &&
      !!planted.planted &&
      !!planted.deploymentDate;
    expect(eligible).toBe(true);
  });

  it('editing the expense quantity keeps breedingStock in sync', () => {
    const e = useExpenseStore.getState().addExpense(replantExpense());
    expect(rowOf()!.breedingStock).toBe(500);

    useExpenseStore.getState().updateExpense(e.id, { quantity: 300, amount: 10500 });
    expect(rowOf()!.breedingStock).toBe(300);
    expect(purchasedBatch()!.quantitySourced).toBe(300);
  });

  it('deleting the expense reverses breedingStock and removes the batch', () => {
    const e = useExpenseStore.getState().addExpense(replantExpense());
    expect(purchasedBatch()).toBeTruthy();

    useExpenseStore.getState().deleteExpense(e.id);
    expect(purchasedBatch()).toBeUndefined();
    expect(rowOf()!.breedingStock).toBe(0);
  });

  it('changing a replant line to packed removes the batch and credits sellable stock', () => {
    const e = useExpenseStore.getState().addExpense(replantExpense());
    expect(rowOf()!.breedingStock).toBe(500);

    useExpenseStore.getState().updateExpense(e.id, { cuttingState: 'packed' });
    // Batch gone, breeding stock reversed; now it's sellable packed stock.
    expect(purchasedBatch()).toBeUndefined();
    const row = rowOf()!;
    expect(row.breedingStock).toBe(0);
    expect(row.packed).toBe(500);
    expect(row.availableForSale).toBe(500);
  });

  it('a fresh purchased batch is "To Graft / Plant" until a graft date is set', () => {
    useExpenseStore.getState().addExpense(replantExpense());
    const batch = purchasedBatch()!;
    // No graft date yet → rooting clock not started → To Graft / Plant, and never
    // callusing (callusing is for own-farm harvested cuttings only).
    expect(batch.status).toBe('To Graft / Plant');
    expect(batch.harvestDate ?? '').toBe('');

    // Setting a RECENT graft date starts the clock → Rooting (not yet ready).
    useCuttingStore.getState().updateBatch(batch.id, { dateGrafted: '2026-09-20' });
    expect(useCuttingStore.getState().getBatch(batch.id)!.status).toBe('Rooting');
  });

  it('the graft date drives readiness: a backdated graft date → Rooted & Ready', () => {
    useExpenseStore.getState().addExpense(replantExpense());
    const batch = purchasedBatch()!;

    // Graft date well in the past (> rootWeeks ago) → past the ready date →
    // Rooted & Ready to Pack. (Regression: previously the status ignored the
    // graft date and used the acquisition-date estimate, so it stayed "Rooting".)
    useCuttingStore.getState().updateBatch(batch.id, { dateGrafted: '2025-07-03' });
    expect(useCuttingStore.getState().getBatch(batch.id)!.status).toBe('Rooted & Ready to Pack/Plant');
  });

  it('an itemized replant line creates a Purchased batch (no double-count)', () => {
    useExpenseStore.getState().addExpense(replantExpense({
      quantity: 0, unit: '', unitPrice: 0, cuttingState: undefined, cuttingType: undefined,
      amount: 3500,
      items: [
        {
          productId: '', name: 'American Beauty', category: CUTTINGS_PRODUCT_TYPE,
          subcategory: 'American Beauty', quantity: 100, unit: 'piece', unitPrice: 35, total: 3500,
          cuttingState: 'replant', cuttingType: CUTTING_TYPE_UNROOTED,
        },
      ],
    }));
    const batch = purchasedBatch()!;
    expect(batch.quantitySourced).toBe(100);
    expect(batch.cuttingType).toBe(CUTTING_TYPE_UNROOTED);
    const row = rowOf()!;
    expect(row.breedingStock).toBe(100);
    expect(row.packed ?? 0).toBe(0);
  });

  it('two same-variety replant lines sum into ONE batch (no overwrite)', () => {
    useExpenseStore.getState().addExpense(replantExpense({
      quantity: 0, unit: '', unitPrice: 0, cuttingState: undefined, cuttingType: undefined,
      amount: 7000,
      items: [
        {
          productId: '', name: 'American Beauty', category: CUTTINGS_PRODUCT_TYPE,
          subcategory: 'American Beauty', quantity: 100, unit: 'piece', unitPrice: 35, total: 3500,
          cuttingState: 'replant', cuttingType: CUTTING_TYPE_UNROOTED,
        },
        {
          productId: '', name: 'American Beauty', category: CUTTINGS_PRODUCT_TYPE,
          subcategory: 'American Beauty', quantity: 100, unit: 'piece', unitPrice: 35, total: 3500,
          cuttingState: 'replant', cuttingType: CUTTING_TYPE_UNROOTED,
        },
      ],
    }));
    // Exactly one Purchased batch, summing both lines.
    const purchased = useCuttingStore.getState().batches.filter((b) => b.source === CUTTING_SOURCE_PURCHASED);
    expect(purchased).toHaveLength(1);
    expect(purchased[0].quantitySourced).toBe(200);
    expect(rowOf()!.breedingStock).toBe(200);
  });
});
