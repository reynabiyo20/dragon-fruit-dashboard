import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useExpenseStore } from './expenseStore';
import { useInventoryStore } from './inventoryStore';
import { CUTTINGS_PRODUCT_TYPE } from '../constants';

/**
 * Buying cuttings FROM a customer/vendor via the Expense form routes into a
 * cutting pool by condition:
 *   - 'packed' → packed + availableForSale (Ready for Sale), sellable immediately.
 *   - 'bare'   → needsPacking, on hand (in endingQty) but not yet sellable.
 * Both feed endingQty. The Pack action moves needsPacking → packed/Ready-for-Sale
 * without changing endingQty. Reversing an expense unwinds the same pool.
 */
describe('cuttings purchase → inventory pool routing', () => {
  beforeEach(() => {
    useExpenseStore.setState({ expenses: [] });
    useInventoryStore.setState({ items: [], _seeded: 999 });
  });

  const row = (sub: string) => useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, sub);

  function cuttingExpense(over: Record<string, unknown>) {
    return {
      date: '2026-01-01', vendorId: 'v1', vendorName: 'Acme',
      category: CUTTINGS_PRODUCT_TYPE, subcategory: 'Thai White', description: '',
      quantity: 20, unit: 'piece', unitPrice: 35, amount: 700,
      paymentMethod: 'Cash', paid: true, notes: '',
      ...over,
    };
  }

  it("'already packed' cuttings land in packed + Ready for Sale (endingQty too)", () => {
    useExpenseStore.getState().addExpense(cuttingExpense({ cuttingState: 'packed' }));
    const r = row('Thai White')!;
    expect(r.packed).toBe(20);
    expect(r.availableForSale).toBe(20); // Ready for Sale
    expect(r.needsPacking ?? 0).toBe(0);
    expect(r.purchased).toBe(0);         // NOT the generic purchased pool
    expect(r.endingQty).toBe(20);        // packed feeds endingQty
  });

  it("'bare' cuttings land in Needs Packing (endingQty too), not Ready for Sale", () => {
    useExpenseStore.getState().addExpense(cuttingExpense({ cuttingState: 'bare' }));
    const r = row('Thai White')!;
    expect(r.needsPacking).toBe(20);
    expect(r.packed ?? 0).toBe(0);
    expect(r.availableForSale ?? 0).toBe(0);
    expect(r.endingQty).toBe(20);        // needsPacking feeds endingQty
  });

  it('defaults to packed when cuttingState is omitted', () => {
    useExpenseStore.getState().addExpense(cuttingExpense({}));
    const r = row('Thai White')!;
    expect(r.packed).toBe(20);
    expect(r.availableForSale).toBe(20);
  });

  it('packCuttings moves needsPacking → packed + Ready for Sale, endingQty unchanged', () => {
    useExpenseStore.getState().addExpense(cuttingExpense({ cuttingState: 'bare', quantity: 20 }));
    const before = row('Thai White')!;
    expect(before.needsPacking).toBe(20);
    expect(before.endingQty).toBe(20);

    const packed = useInventoryStore.getState().packCuttings(before.id, 12);
    expect(packed).toBe(12);
    const after = row('Thai White')!;
    expect(after.needsPacking).toBe(8);
    expect(after.packed).toBe(12);
    expect(after.availableForSale).toBe(12);
    expect(after.endingQty).toBe(20);    // unchanged: stock was already on hand
  });

  it('packCuttings clamps to available needsPacking', () => {
    useExpenseStore.getState().addExpense(cuttingExpense({ cuttingState: 'bare', quantity: 5 }));
    const r = row('Thai White')!;
    const packed = useInventoryStore.getState().packCuttings(r.id, 999);
    expect(packed).toBe(5); // only 5 were bare
    const after = row('Thai White')!;
    expect(after.needsPacking).toBe(0);
    expect(after.packed).toBe(5);
  });

  it('reversing a bare cuttings expense removes it from Needs Packing', () => {
    const e = useExpenseStore.getState().addExpense(cuttingExpense({ cuttingState: 'bare' }));
    expect(row('Thai White')?.needsPacking).toBe(20);
    useExpenseStore.getState().deleteExpense(e.id);
    expect(row('Thai White')?.needsPacking).toBe(0);
    expect(row('Thai White')?.endingQty).toBe(0);
  });

  it('reversing a packed cuttings expense removes it from packed + Ready for Sale', () => {
    const e = useExpenseStore.getState().addExpense(cuttingExpense({ cuttingState: 'packed' }));
    expect(row('Thai White')?.packed).toBe(20);
    useExpenseStore.getState().deleteExpense(e.id);
    expect(row('Thai White')?.packed).toBe(0);
    expect(row('Thai White')?.availableForSale).toBe(0);
    expect(row('Thai White')?.endingQty).toBe(0);
  });
});
