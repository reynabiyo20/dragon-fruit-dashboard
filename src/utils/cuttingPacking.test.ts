import { describe, it, expect } from 'vitest';
import { computeCuttingPackingStatus, computeSaleDeliveryReadiness } from './cuttingPacking';
import type { Sale, Product, InventoryItem } from '../types';
import { CUTTINGS_PRODUCT_TYPE } from '../constants';

// ── Minimal factories ────────────────────────────────────────────────────────
function product(id: string, category: string, subcategory: string): Product {
  return {
    id, category, subcategory, costPHP: 0, sellingPricePHP: 0, costUSD: 0, sellingPriceUSD: 0,
    unit: 'piece', notes: '', createdAt: '', updatedAt: '',
  } as Product;
}

function sale(id: string, delivered: boolean, lines: { productId: string; quantity: number }[]): Sale {
  return {
    id, date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: '', saleType: '',
    items: lines.map((l) => ({ productId: l.productId, productName: '', quantity: l.quantity, unitPrice: 10, surcharge: 0, total: l.quantity * 10 })),
    subtotal: 0, currency: 'PHP', paymentMethod: 'Cash', paymentDetails: '', paid: true, delivered,
    soldByEmployeeId: '', soldByName: '', notes: '', createdAt: '', updatedAt: '',
  } as Sale;
}

function invRow(subcategory: string, availableForSale: number, needsPacking: number): InventoryItem {
  return {
    id: `inv-${subcategory}`, category: CUTTINGS_PRODUCT_TYPE, subcategory, unit: 'piece',
    beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 0, unitCost: 0,
    packed: availableForSale, needsPacking, breedingStock: 0, availableForSale, produced: 0, harvested: 0,
    notes: '', createdAt: '', updatedAt: '',
  } as InventoryItem;
}

const products: Record<string, Product> = {
  tw: product('tw', CUTTINGS_PRODUCT_TYPE, 'Thai White'),
  v2: product('v2', CUTTINGS_PRODUCT_TYPE, 'Variety 2'),
  fruit: product('fr', 'Fruit', 'Thai White'),
};
const resolver = (id: string) => Object.values(products).find((p) => p.id === id);

describe('computeCuttingPackingStatus', () => {
  it('is all-zero when there are no pending cutting sales', () => {
    const res = computeCuttingPackingStatus([sale('s1', true, [{ productId: 'tw', quantity: 5 }])], resolver, [invRow('Thai White', 0, 0)]);
    expect(res.pendingDemand).toBe(0);
    expect(res.toPack).toBe(0);
    expect(res.pendingOrders).toBe(0);
  });

  it('counts pending cutting demand and flags the shortfall to pack', () => {
    // 10 Thai White ordered (pending), only 4 packed on hand → 6 still to pack.
    const res = computeCuttingPackingStatus(
      [sale('s1', false, [{ productId: 'tw', quantity: 10 }])],
      resolver,
      [invRow('Thai White', 4, 3)],
    );
    expect(res.pendingDemand).toBe(10);
    expect(res.coveredByPacked).toBe(4);
    expect(res.toPack).toBe(6);
    expect(res.bareOnHand).toBe(3);
    expect(res.pendingOrders).toBe(1);
    expect(res.byVariety[0]).toMatchObject({ variety: 'Thai White', toPack: 6, coveredByPacked: 4, needsPacking: 3 });
  });

  it('caps coverage at demand — surplus packed stock does not create negative to-pack', () => {
    const res = computeCuttingPackingStatus(
      [sale('s1', false, [{ productId: 'tw', quantity: 3 }])],
      resolver,
      [invRow('Thai White', 20, 0)],
    );
    expect(res.toPack).toBe(0);
    expect(res.coveredByPacked).toBe(3);
  });

  it('ignores delivered sales and non-cutting lines', () => {
    const res = computeCuttingPackingStatus(
      [
        sale('s1', true, [{ productId: 'tw', quantity: 5 }]),   // delivered → ignored
        sale('s2', false, [{ productId: 'fruit', quantity: 8 }]), // Fruit → ignored
        sale('s3', false, [{ productId: 'tw', quantity: 2 }]),   // counts
      ],
      resolver,
      [invRow('Thai White', 0, 5)],
    );
    expect(res.pendingDemand).toBe(2);
    expect(res.toPack).toBe(2);
    expect(res.pendingOrders).toBe(1);
  });

  it('aggregates demand per variety and sorts most-to-pack first', () => {
    const res = computeCuttingPackingStatus(
      [
        sale('s1', false, [{ productId: 'tw', quantity: 4 }, { productId: 'v2', quantity: 12 }]),
        sale('s2', false, [{ productId: 'tw', quantity: 1 }]),
      ],
      resolver,
      [invRow('Thai White', 5, 0), invRow('Variety 2', 2, 6)],
    );
    // Thai White demand 5, packed 5 → toPack 0. Variety 2 demand 12, packed 2 → toPack 10.
    expect(res.pendingDemand).toBe(17);
    expect(res.toPack).toBe(10);
    expect(res.byVariety[0].variety).toBe('Variety 2'); // largest shortfall first
    expect(res.byVariety[0].toPack).toBe(10);
  });
});

describe('computeSaleDeliveryReadiness', () => {
  it('blocks delivery when packed stock is short and reports the per-variety shortfall', () => {
    // 2000 ordered (the Maribel Casey case), 0 packed → can't deliver, 2000 to pack.
    const s = sale('s1', false, [{ productId: 'tw', quantity: 2000 }]);
    const res = computeSaleDeliveryReadiness(s, resolver, [invRow('Thai White', 0, 4000)]);
    expect(res.canDeliver).toBe(false);
    expect(res.shortfalls).toEqual([
      { variety: 'Thai White', needed: 2000, ready: 0, toPack: 2000 },
    ]);
  });

  it('allows delivery when packed stock exactly meets the sale quantity', () => {
    const s = sale('s1', false, [{ productId: 'tw', quantity: 2000 }]);
    const res = computeSaleDeliveryReadiness(s, resolver, [invRow('Thai White', 2000, 0)]);
    expect(res.canDeliver).toBe(true);
    expect(res.shortfalls).toEqual([]);
  });

  it('allows delivery when packed stock exceeds the sale quantity', () => {
    const s = sale('s1', false, [{ productId: 'tw', quantity: 2000 }]);
    const res = computeSaleDeliveryReadiness(s, resolver, [invRow('Thai White', 3000, 0)]);
    expect(res.canDeliver).toBe(true);
    expect(res.shortfalls).toEqual([]);
  });

  it('reports a partial shortfall (some packed, not enough)', () => {
    const s = sale('s1', false, [{ productId: 'tw', quantity: 2000 }]);
    const res = computeSaleDeliveryReadiness(s, resolver, [invRow('Thai White', 1200, 800)]);
    expect(res.canDeliver).toBe(false);
    expect(res.shortfalls[0]).toEqual({ variety: 'Thai White', needed: 2000, ready: 1200, toPack: 800 });
  });

  it('ignores non-cutting lines — a fruit-only sale is always deliverable', () => {
    // Fruit has no packing step, so it never blocks even with no inventory row.
    const s = sale('s1', false, [{ productId: 'fruit', quantity: 8 }]);
    const res = computeSaleDeliveryReadiness(s, resolver, []);
    expect(res.canDeliver).toBe(true);
    expect(res.shortfalls).toEqual([]);
  });

  it('checks each cutting variety independently and sorts biggest shortfall first', () => {
    const s = sale('s1', false, [
      { productId: 'tw', quantity: 5 },   // 5 packed → covered
      { productId: 'v2', quantity: 12 },  // 2 packed → 10 short
    ]);
    const res = computeSaleDeliveryReadiness(s, resolver, [invRow('Thai White', 5, 0), invRow('Variety 2', 2, 0)]);
    expect(res.canDeliver).toBe(false);
    expect(res.shortfalls).toHaveLength(1);
    expect(res.shortfalls[0]).toEqual({ variety: 'Variety 2', needed: 12, ready: 2, toPack: 10 });
  });

  it('re-validating an already-delivered sale credits its own qty back to ready stock', () => {
    // A delivered 2000 order already drew its 2000 out of availableForSale, so the
    // row now reads 0 packed. Editing it must not falsely block — its own 2000 is
    // added back before comparing, leaving it deliverable.
    const s = sale('s1', true, [{ productId: 'tw', quantity: 2000 }]);
    const res = computeSaleDeliveryReadiness(s, resolver, [invRow('Thai White', 0, 0)]);
    expect(res.canDeliver).toBe(true);
    expect(res.shortfalls).toEqual([]);
  });

  it('an already-delivered sale is still short if it was over-delivered beyond packed stock', () => {
    // Delivered qty 2000 but only 1200 was ever packed (availableForSale went
    // negative to -800). Crediting 2000 back → ready 1200 < 2000 → still 800 short.
    const s = sale('s1', true, [{ productId: 'tw', quantity: 2000 }]);
    const res = computeSaleDeliveryReadiness(s, resolver, [invRow('Thai White', -800, 0)]);
    expect(res.canDeliver).toBe(false);
    expect(res.shortfalls[0]).toEqual({ variety: 'Thai White', needed: 2000, ready: 1200, toPack: 800 });
  });

  it('can override the alreadyDelivered assumption explicitly', () => {
    // Same delivered sale, but forcing alreadyDelivered=false checks it as if
    // fresh: 0 packed vs 2000 needed → short. Confirms the flag drives the credit.
    const s = sale('s1', true, [{ productId: 'tw', quantity: 2000 }]);
    const res = computeSaleDeliveryReadiness(s, resolver, [invRow('Thai White', 0, 0)], false);
    expect(res.canDeliver).toBe(false);
    expect(res.shortfalls[0].toPack).toBe(2000);
  });
});
