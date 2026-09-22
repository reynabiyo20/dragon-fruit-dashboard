import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useCuttingStore } from './cuttingStore';
import { useInventoryStore } from './inventoryStore';
import { useSaleStore } from './saleStore';
import { useProductStore } from './productStore';
import { generateId, now } from '../utils/id';
import { CUTTINGS_PRODUCT_TYPE } from '../constants';

/**
 * Cuttings inventory model:
 *   endingQty = beginning + purchased − used − sold + packed
 * Packing a rooted batch adds `packed` (finished sellable stock); a cutting sale
 * only affects inventory when it is DELIVERED (then + sold, − availableForSale).
 * A non-delivered cutting sale must leave inventory untouched.
 */
describe('cuttings inventory: packed feeds endingQty; delivery drives sold', () => {
  let productId = '';

  beforeEach(() => {
    useCuttingStore.setState({ batches: [] });
    useSaleStore.setState({ sales: [] });
    // One clean Cuttings inventory row + matching product for "Thai White".
    useInventoryStore.setState({
      items: [
        {
          id: generateId(),
          category: CUTTINGS_PRODUCT_TYPE,
          subcategory: 'Thai White',
          unit: 'piece',
          beginningQty: 0,
          purchased: 0,
          used: 0,
          sold: 0,
          endingQty: 0,
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
      category: CUTTINGS_PRODUCT_TYPE,
      subcategory: 'Thai White',
      costPHP: 0,
      sellingPricePHP: 300,
      costUSD: 0,
      sellingPriceUSD: 0,
      unit: 'piece',
      notes: '',
    });
    productId = product.id;
  });

  const row = () => useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Thai White')!;

  function addPackedBatch(qty: number) {
    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const b = useCuttingStore.getState().addBatch({
      subcategory: 'Thai White',
      cuttingType: 'Grafted with Roots',
      harvestDate: longAgo,
      dateSourced: longAgo,
      dateGrafted: '',
      quantitySourced: qty,
      sourceCostPerCutting: 0,
      graftCostPerCutting: 0,
      rootWeeks: 3,
      notes: '',
    });
    useCuttingStore.getState().markPacked(b.id);
    return b;
  }

  it('packing adds to packed, availableForSale, and endingQty', () => {
    addPackedBatch(30);
    const r = row();
    expect(r.packed).toBe(30);
    expect(r.availableForSale).toBe(30);
    expect(r.endingQty).toBe(30);
    expect(r.sold).toBe(0);
  });

  it('a NON-delivered cutting sale leaves inventory untouched', () => {
    addPackedBatch(30);
    useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Cuttings – Thai White', quantity: 10, unitPrice: 300, surcharge: 0, total: 3000 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: false, delivered: false,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    const r = row();
    expect(r.sold).toBe(0);            // untouched — not delivered
    expect(r.availableForSale).toBe(30);
    expect(r.endingQty).toBe(30);
  });

  it('a DELIVERED cutting sale increments sold and reduces packed, available + endingQty', () => {
    addPackedBatch(30);
    useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Cuttings – Thai White', quantity: 10, unitPrice: 300, surcharge: 0, total: 3000 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: true, delivered: true,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    const r = row();
    expect(r.sold).toBe(10);           // lifetime sold counter
    expect(r.packed).toBe(20);         // packed pool drawn down by the sale
    expect(r.availableForSale).toBe(20);
    // For cuttings the departure is captured by -packed, so `sold` is not
    // double-subtracted: 0 + 0 - 0 + 20 (packed) = 20.
    expect(r.endingQty).toBe(20);
  });

  it('reversing a DELIVERED cutting sale restores packed + endingQty', () => {
    addPackedBatch(30);
    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Cuttings – Thai White', quantity: 10, unitPrice: 300, surcharge: 0, total: 3000 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: true, delivered: true,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    useSaleStore.getState().updateSale(sale.id, { delivered: false });
    const r = row();
    expect(r.sold).toBe(0);
    expect(r.packed).toBe(30);         // packed restored
    expect(r.availableForSale).toBe(30);
    expect(r.endingQty).toBe(30);
  });
});
