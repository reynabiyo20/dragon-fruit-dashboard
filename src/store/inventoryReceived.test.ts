import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useInventoryStore } from './inventoryStore';
import { useSaleStore } from './saleStore';
import { useProductStore } from './productStore';
import { generateId, now } from '../utils/id';
import { FRUIT_PRODUCT_TYPE, FERTILIZER_PRODUCT_TYPE } from '../constants';

/**
 * Generalized received-driven sold model (ANY sold product):
 *   endingQty = beginning + purchased − used − sold + packed
 * A sale only moves inventory `sold` when it is marked "Received by Customer".
 * A non-received sale leaves inventory untouched. When no inventory row exists
 * for a received product (e.g. a one-off "Other → Jacket"), the row is
 * auto-created so the sale is reflected in inventory. Unlike cuttings, non-
 * cutting products have no packed Available-Stock-for-Sale pool, so
 * `availableForSale` is not affected — only `sold`.
 */
describe('inventory received-driven sold for any sold product', () => {
  function seedRow(category: string, subcategory: string, purchased: number) {
    useInventoryStore.setState({
      items: [
        {
          id: generateId(),
          category,
          subcategory,
          unit: 'kg',
          beginningQty: 0,
          purchased,
          used: 0,
          sold: 0,
          endingQty: purchased,
          unitCost: 0,
          packed: 0,
          breedingStock: 0,
          availableForSale: 0,
          notes: '',
          createdAt: now(),
          updatedAt: now(),
        },
      ],
      _seeded: 999,
    });
    const product = useProductStore.getState().addProduct({
      category,
      subcategory,
      costPHP: 0,
      sellingPricePHP: 100,
      costUSD: 0,
      sellingPriceUSD: 0,
      unit: 'kg',
      notes: '',
    });
    return product.id;
  }

  const row = (category: string, subcategory: string) =>
    useInventoryStore.getState().findByCategorySub(category, subcategory)!;

  beforeEach(() => {
    useSaleStore.setState({ sales: [] });
  });

  it('a NON-received Fruit sale leaves inventory untouched', () => {
    const productId = seedRow(FRUIT_PRODUCT_TYPE, 'Palora Yellow', 88);
    useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Fruit – Palora Yellow', quantity: 10, unitPrice: 100, surcharge: 0, total: 1000 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: false, delivered: false,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    const r = row(FRUIT_PRODUCT_TYPE, 'Palora Yellow');
    expect(r.sold).toBe(0);           // untouched — not received
    expect(r.endingQty).toBe(88);
    expect(r.availableForSale).toBe(0); // fruit has no packed pool
  });

  it('a RECEIVED Fruit sale increments sold and reduces endingQty (no availableForSale change)', () => {
    const productId = seedRow(FRUIT_PRODUCT_TYPE, 'Palora Yellow', 88);
    useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Fruit – Palora Yellow', quantity: 10, unitPrice: 100, surcharge: 0, total: 1000 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: true, delivered: true,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    const r = row(FRUIT_PRODUCT_TYPE, 'Palora Yellow');
    expect(r.sold).toBe(10);
    expect(r.endingQty).toBe(78);       // 0 + 88 - 0 - 10 + 0
    expect(r.availableForSale).toBe(0); // unchanged for fruit
  });

  it('toggling a Fruit sale received off returns sold', () => {
    const productId = seedRow(FRUIT_PRODUCT_TYPE, 'Palora Yellow', 88);
    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Fruit – Palora Yellow', quantity: 10, unitPrice: 100, surcharge: 0, total: 1000 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: true, delivered: true,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    expect(row(FRUIT_PRODUCT_TYPE, 'Palora Yellow').sold).toBe(10);
    useSaleStore.getState().updateSale(sale.id, { delivered: false });
    const r = row(FRUIT_PRODUCT_TYPE, 'Palora Yellow');
    expect(r.sold).toBe(0);
    expect(r.endingQty).toBe(88);
  });

  it('a RECEIVED Fertilizer sale increments sold', () => {
    const productId = seedRow(FERTILIZER_PRODUCT_TYPE, 'Neem Oil', 50);
    useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Fertilizer – Neem Oil', quantity: 5, unitPrice: 100, surcharge: 0, total: 500 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: true, delivered: true,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    const r = row(FERTILIZER_PRODUCT_TYPE, 'Neem Oil');
    expect(r.sold).toBe(5);
    expect(r.endingQty).toBe(45);
  });

  it('a RECEIVED "Other" sale auto-creates an inventory row and records sold', () => {
    // No pre-seeded row — mimics selling a one-off "Other → Jacket".
    useInventoryStore.setState({ items: [], _seeded: 999 });
    const product = useProductStore.getState().addProduct({
      category: 'Other', subcategory: 'Jacket',
      costPHP: 0, sellingPricePHP: 500, costUSD: 0, sellingPriceUSD: 0,
      unit: 'piece', notes: '',
    });
    useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId: product.id, productName: 'Other – Jacket', quantity: 3, unitPrice: 500, surcharge: 0, total: 1500 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: true, delivered: true,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    const r = useInventoryStore.getState().findByCategorySub('Other', 'Jacket');
    expect(r).toBeDefined();
    expect(r!.sold).toBe(3);
    expect(r!.endingQty).toBe(-3); // 0 + 0 - 0 - 3 + 0 (nothing purchased yet)
    expect(r!.unit).toBe('piece'); // seeded from the product
  });

  it('a NON-received "Other" sale does NOT create an inventory row', () => {
    useInventoryStore.setState({ items: [], _seeded: 999 });
    const product = useProductStore.getState().addProduct({
      category: 'Other', subcategory: 'Jacket',
      costPHP: 0, sellingPricePHP: 500, costUSD: 0, sellingPriceUSD: 0,
      unit: 'piece', notes: '',
    });
    useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId: product.id, productName: 'Other – Jacket', quantity: 3, unitPrice: 500, surcharge: 0, total: 1500 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: false, delivered: false,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    expect(useInventoryStore.getState().findByCategorySub('Other', 'Jacket')).toBeUndefined();
  });

  it('deleting a received Fruit sale returns sold', () => {
    const productId = seedRow(FRUIT_PRODUCT_TYPE, 'Palora Yellow', 88);
    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Fruit – Palora Yellow', quantity: 10, unitPrice: 100, surcharge: 0, total: 1000 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: true, delivered: true,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    expect(row(FRUIT_PRODUCT_TYPE, 'Palora Yellow').sold).toBe(10);
    useSaleStore.getState().deleteSale(sale.id);
    expect(row(FRUIT_PRODUCT_TYPE, 'Palora Yellow').sold).toBe(0);
  });
});
