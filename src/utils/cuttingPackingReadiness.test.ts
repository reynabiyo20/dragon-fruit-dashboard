import { describe, it, expect, beforeEach } from 'vitest';

import { useInventoryStore } from '../store/inventoryStore';
import { useProductStore } from '../store/productStore';
import { computeSaleDeliveryReadiness } from './cuttingPacking';
import { generateId, now } from './id';
import { CUTTINGS_PRODUCT_TYPE } from '../constants';

/**
 * Delivery readiness gate: a partially-packed cutting order must NOT be
 * deliverable. 4000 American Beauty on hand (bare, needs packing) + a 3000-unit
 * sale. Delivery stays BLOCKED until all 3000 are packed, because the gate reads
 * availableForSale (packed & ready), not raw on-hand stock.
 */
describe('cutting delivery readiness: partial packing does not allow delivery', () => {
  let productId = '';
  let rowId = '';

  beforeEach(() => {
    rowId = generateId();
    useInventoryStore.setState({
      items: [
        {
          id: rowId,
          category: CUTTINGS_PRODUCT_TYPE,
          subcategory: 'American Beauty',
          unit: 'piece',
          beginningQty: 0,
          purchased: 0,
          used: 0,
          sold: 0,
          endingQty: 4000,
          unitCost: 0,
          packed: 0,
          needsPacking: 4000, // all bare, nothing packed yet
          breedingStock: 0,
          availableForSale: 0,
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
      subcategory: 'American Beauty',
      costPHP: 0, sellingPricePHP: 100, costUSD: 0, sellingPriceUSD: 0,
      unit: 'piece', notes: '',
    });
    productId = product.id;
  });

  const sale = {
    delivered: false as const,
    items: [{ productId: '', productName: 'Cuttings – American Beauty', quantity: 3000, unitPrice: 100, surcharge: 0, total: 300000 }],
  };
  const saleWithProduct = () => ({ ...sale, items: [{ ...sale.items[0], productId }] });
  const getProduct = (id: string) => useProductStore.getState().getProduct(id);

  it('with nothing packed, delivery is blocked (3000 short)', () => {
    const r = computeSaleDeliveryReadiness(saleWithProduct(), getProduct, useInventoryStore.getState().items);
    expect(r.canDeliver).toBe(false);
    expect(r.shortfalls[0].toPack).toBe(3000);
  });

  it('after packing only 1000, delivery is STILL blocked (2000 short)', () => {
    useInventoryStore.getState().packCuttings(rowId, 1000);
    const row = useInventoryStore.getState().getItem(rowId)!;
    expect(row.availableForSale).toBe(1000);
    const r = computeSaleDeliveryReadiness(saleWithProduct(), getProduct, useInventoryStore.getState().items);
    expect(r.canDeliver).toBe(false);
    expect(r.shortfalls[0].toPack).toBe(2000);
  });

  it('only once all 3000 are packed does delivery unblock', () => {
    useInventoryStore.getState().packCuttings(rowId, 3000);
    const r = computeSaleDeliveryReadiness(saleWithProduct(), getProduct, useInventoryStore.getState().items);
    expect(r.canDeliver).toBe(true);
  });
});
