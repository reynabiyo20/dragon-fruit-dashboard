import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useInventoryStore } from './inventoryStore';
import { useSaleStore } from './saleStore';
import { useProductStore } from './productStore';
import { generateId, now } from '../utils/id';
import { CUTTINGS_PRODUCT_TYPE } from '../constants';

/**
 * Reproduces the real UI flow for Option B: a cuttings sale is created PENDING,
 * then flipped to "Received by Customer" from the table (updateSale toggle).
 * Receiving must deduct packed + availableForSale (Ready for Sale) + endingQty.
 */
describe('cuttings sale: receiving deducts packed + ready-for-sale + ending', () => {
  let productId = '';

  beforeEach(() => {
    useSaleStore.setState({ sales: [] });
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
          endingQty: 30,
          unitCost: 0,
          packed: 30,
          needsPacking: 0,
          breedingStock: 0,
          availableForSale: 30,
          produced: 0,
          harvested: 0,
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
      costPHP: 0, sellingPricePHP: 300, costUSD: 0, sellingPriceUSD: 0,
      unit: 'piece', notes: '',
    });
    productId = product.id;
  });

  const row = () => useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, 'Thai White')!;

  it('a pending cuttings sale does not move inventory until received', () => {
    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Cuttings – Thai White', quantity: 10, unitPrice: 300, surcharge: 0, total: 3000 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: false, delivered: false,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    expect(row().endingQty).toBe(30);

    // Flip to received — the exact call the table checkbox makes.
    useSaleStore.getState().updateSale(sale.id, { delivered: true });
    const r = row();
    expect(r.sold).toBe(10);
    expect(r.packed).toBe(20);
    expect(r.availableForSale).toBe(20);
    expect(r.endingQty).toBe(20);
  });

  it('deducts packed/ready-for-sale even when the category casing differs', () => {
    // Product + inventory row stored with a non-canonical casing ("cuttings").
    // The match must stay tolerant so packed/availableForSale/ending still move.
    useInventoryStore.setState({
      items: [
        {
          id: generateId(), category: 'cuttings', subcategory: 'Thai White', unit: 'piece',
          beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 30, unitCost: 0,
          packed: 30, needsPacking: 0, breedingStock: 0, availableForSale: 30, produced: 0,
          harvested: 0, notes: '', createdAt: now(), updatedAt: now(),
        },
      ],
      _seeded: 999,
    });
    const product = useProductStore.getState().addProduct({
      category: 'cuttings', subcategory: 'Thai White',
      costPHP: 0, sellingPricePHP: 300, costUSD: 0, sellingPriceUSD: 0, unit: 'piece', notes: '',
    });
    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId: product.id, productName: 'cuttings – Thai White', quantity: 10, unitPrice: 300, surcharge: 0, total: 3000 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: false, delivered: false,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    useSaleStore.getState().updateSale(sale.id, { delivered: true });
    const r = useInventoryStore.getState().findByCategorySub('cuttings', 'Thai White')!;
    expect(r.sold).toBe(10);
    expect(r.packed).toBe(20);         // was skipped before the tolerant-match fix
    expect(r.availableForSale).toBe(20);
    expect(r.endingQty).toBe(20);
  });
});
