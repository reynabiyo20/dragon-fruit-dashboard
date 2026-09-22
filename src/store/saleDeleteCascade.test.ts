import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { useCuttingStore } from './cuttingStore';
import { useInventoryStore } from './inventoryStore';
import { useSaleStore } from './saleStore';
import { useProductStore } from './productStore';
import { useCommissionStore } from './commissionStore';
import { generateId, now } from '../utils/id';
import { CUTTINGS_PRODUCT_TYPE, CUTTING_SOURCE_CUSTOMER } from '../constants';

/**
 * Deleting a sale must fully revert every effect it had, in every store it fed:
 *   - the "Customer"-sourced cutting batch it created (Propagation),
 *   - inventory pools (via reverse* on sold/packed/available/endingQty), and
 *   - the salesperson commission entry it opened.
 * deleteSale is self-contained: it owns the whole reverse cascade, so any caller
 * (row action, bulk delete, or programmatic) gets the same atomic revert. A
 * completed (Paid + Received) sale is deletable too — deleting it returns its
 * stock and removes its commission.
 */
describe('deleting a sale cascades into cuttings + inventory', () => {
  let productId = '';

  beforeEach(() => {
    useCuttingStore.setState({ batches: [] });
    useSaleStore.setState({ sales: [] });
    useCommissionStore.setState({ entries: [] });
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

  const customerBatches = (saleId: string) =>
    useCuttingStore
      .getState()
      .batches.filter((b) => b.source === CUTTING_SOURCE_CUSTOMER && b.saleId === saleId);

  it('removeCustomerPurchase drops the sale-linked batch', () => {
    const saleId = generateId();
    useCuttingStore.getState().recordCustomerPurchase({
      saleId,
      subcategory: 'Thai White',
      quantity: 10,
      customerId: '',
      customerName: 'X',
      cuttingType: 'Grafted with Roots',
      dateBought: '2026-01-01',
    });
    expect(customerBatches(saleId)).toHaveLength(1);

    useCuttingStore.getState().removeCustomerPurchase(saleId);
    expect(customerBatches(saleId)).toHaveLength(0);
  });

  const rowFor = (subcategory: string) =>
    useInventoryStore.getState().findByCategorySub(CUTTINGS_PRODUCT_TYPE, subcategory);

  it('deleting a completed (Paid + Received) sale returns its stock to inventory', () => {
    // Seed a Ready-for-Sale pool so the delivered sale has stock to draw down.
    const seeded = rowFor('Thai White')!;
    useInventoryStore.getState().adjustPacked(seeded.id, 20);
    useInventoryStore.getState().adjustAvailableForSale(seeded.id, 20);
    const packedBefore = rowFor('Thai White')!.packed ?? 0;
    const endingBefore = rowFor('Thai White')!.endingQty;

    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Cuttings – Thai White', quantity: 5, unitPrice: 300, surcharge: 0, total: 1500 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: true, delivered: true,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    // Receiving drew 5 out of the packed / Ready-for-Sale pools.
    expect(rowFor('Thai White')!.packed).toBe(packedBefore - 5);
    expect(rowFor('Thai White')!.endingQty).toBe(endingBefore - 5);

    // A completed sale is now deletable, and deletion returns the stock.
    useSaleStore.getState().deleteSale(sale.id);
    expect(useSaleStore.getState().getSale(sale.id)).toBeUndefined();
    expect(rowFor('Thai White')!.packed).toBe(packedBefore);
    expect(rowFor('Thai White')!.endingQty).toBe(endingBefore);
  });

  it('deleteSale alone removes the sale-linked commission entry', () => {
    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Cuttings – Thai White', quantity: 5, unitPrice: 300, surcharge: 0, total: 1500 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: false, delivered: false,
      soldByEmployeeId: 'emp-1', soldByName: 'Rey', notes: '',
    });
    // Simulate the SaleForm cascade that opens a commission entry for this sale.
    useCommissionStore.getState().setForSale({
      date: sale.date, employeeId: 'emp-1', employeeName: 'Rey', saleId: sale.id,
      saleAmount: 1500, commissionPct: 10, notes: '',
    });
    expect(useCommissionStore.getState().entries.some((e) => e.saleId === sale.id)).toBe(true);

    useSaleStore.getState().deleteSale(sale.id);
    expect(useCommissionStore.getState().entries.some((e) => e.saleId === sale.id)).toBe(false);
  });

  it('deleteSale alone (no UI helper) cascades away the sale-linked cutting batch', () => {
    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Cuttings – Thai White', quantity: 5, unitPrice: 300, surcharge: 0, total: 1500 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: false, delivered: false,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    useCuttingStore.getState().recordCustomerPurchase({
      saleId: sale.id, subcategory: 'Thai White', quantity: 5, customerId: '', customerName: 'X',
      cuttingType: 'Grafted with Roots', dateBought: sale.date,
    });
    expect(customerBatches(sale.id)).toHaveLength(1);

    // No UI cascade this time — deleteSale must clean up the batch on its own.
    useSaleStore.getState().deleteSale(sale.id);
    expect(useSaleStore.getState().getSale(sale.id)).toBeUndefined();
    expect(customerBatches(sale.id)).toHaveLength(0);
  });

  it('a non-locked sale deletes and its cutting batch is cascaded away', () => {
    const sale = useSaleStore.getState().addSale({
      date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
      items: [{ productId, productName: 'Cuttings – Thai White', quantity: 5, unitPrice: 300, surcharge: 0, total: 1500 }],
      paymentMethod: 'Cash', paymentDetails: '', paid: false, delivered: false,
      soldByEmployeeId: '', soldByName: '', notes: '',
    });
    // Simulate the SaleForm cascade that records a customer cutting batch.
    useCuttingStore.getState().recordCustomerPurchase({
      saleId: sale.id,
      subcategory: 'Thai White',
      quantity: 5,
      customerId: '',
      customerName: 'X',
      cuttingType: 'Grafted with Roots',
      dateBought: sale.date,
    });
    expect(customerBatches(sale.id)).toHaveLength(1);

    // Mirror the SalesPage delete cascade order.
    useCuttingStore.getState().removeCustomerPurchase(sale.id);
    useSaleStore.getState().deleteSale(sale.id);

    expect(useSaleStore.getState().getSale(sale.id)).toBeUndefined();
    expect(customerBatches(sale.id)).toHaveLength(0);
  });
});
