import { describe, it, expect, beforeEach } from 'vitest';
import { unlinkResellProduct } from './productLink';
import { useProductStore } from './productStore';
import { useSaleStore } from './saleStore';

/**
 * Un-resell must remove an auto-created, unused product but must NOT delete a
 * product that carries a selling price or is referenced by a sale.
 */
describe('unlinkResellProduct', () => {
  beforeEach(() => {
    useProductStore.setState({ products: [], _seeded: 999 });
    useSaleStore.setState({ sales: [] });
  });

  function addProduct(over: { sellingPricePHP?: number } = {}) {
    return useProductStore.getState().addProduct({
      category: 'Construction Material',
      subcategory: 'Cement',
      costPHP: 250,
      sellingPricePHP: 0,
      costUSD: 0,
      sellingPriceUSD: 0,
      unit: 'bag',
      notes: '',
      ...over,
    });
  }

  it('removes an auto-created product with no price and no sales', () => {
    addProduct();
    const result = unlinkResellProduct('Construction Material', 'Cement');
    expect(result).toBe('removed');
    expect(useProductStore.getState().findByCategorySub('Construction Material', 'Cement')).toBeUndefined();
  });

  it('keeps a product that has a selling price set', () => {
    addProduct({ sellingPricePHP: 500 });
    const result = unlinkResellProduct('Construction Material', 'Cement');
    expect(result).toBe('kept-priced');
    expect(useProductStore.getState().findByCategorySub('Construction Material', 'Cement')).toBeDefined();
  });

  it('keeps a product referenced by a sale', () => {
    const p = addProduct();
    useSaleStore.setState({
      sales: [
        {
          id: 's1', date: '2026-01-01', invoiceNumber: '', customerId: '', customerName: 'X', saleType: '',
          items: [{ productId: p.id, productName: 'Cement', quantity: 1, unitPrice: 300, surcharge: 0, total: 300 }],
          subtotal: 300, paymentMethod: 'Cash', paymentDetails: '', paid: true,
          soldByEmployeeId: '', soldByName: '', notes: '', createdAt: '', updatedAt: '',
        },
      ],
    });
    const result = unlinkResellProduct('Construction Material', 'Cement');
    expect(result).toBe('kept-sold');
    expect(useProductStore.getState().findByCategorySub('Construction Material', 'Cement')).toBeDefined();
  });

  it('returns not-found when no product matches', () => {
    expect(unlinkResellProduct('Construction Material', 'Nope')).toBe('not-found');
  });
});
