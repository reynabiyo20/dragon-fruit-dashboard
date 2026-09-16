import { describe, it, expect, beforeEach } from 'vitest';
import { useVendorStore } from './vendorStore';
import { useVendorProductStore } from './vendorProductStore';

/**
 * Reproduces the itemized-purchase cascade at the store level: when a product is
 * added for a vendor in the ProductItemsPicker, the product's category/subcategory
 * must land in that vendor's `supplies` so it shows on the Vendors page (Bug A).
 */
beforeEach(() => {
  useVendorStore.setState({ vendors: [], _seeded: 999 });
  useVendorProductStore.setState({ products: [], prices: [] });
});

describe('itemized purchase cascades products into vendor supplies', () => {
  it('addSupply records the product category/subcategory on the vendor', () => {
    const vendor = useVendorStore.getState().addVendor({
      vendor: 'Acme', contact: '', phone: '', supplies: [], notes: '',
    });

    // Simulate ProductItemsPicker.addProductEntry
    const product = useVendorProductStore.getState().addProduct({
      name: 'Ammonium Sulfate 21-0-0', category: 'Fertilizer', subcategory: 'Nitrogen', unit: 'sack',
    });
    useVendorProductStore.getState().linkVendorPrice(vendor.id, product.id, 0);
    const added = useVendorStore.getState().addSupply(vendor.id, product.category, product.subcategory);

    expect(added).toBe(true);
    const updated = useVendorStore.getState().getVendor(vendor.id)!;
    expect(updated.supplies).toContainEqual({ category: 'Fertilizer', subcategory: 'Nitrogen' });
  });

  it('does not duplicate a supply already present', () => {
    const vendor = useVendorStore.getState().addVendor({
      vendor: 'Acme', contact: '', phone: '',
      supplies: [{ category: 'Fertilizer', subcategory: 'Nitrogen' }], notes: '',
    });
    const added = useVendorStore.getState().addSupply(vendor.id, 'Fertilizer', 'Nitrogen');
    expect(added).toBe(false);
    expect(useVendorStore.getState().getVendor(vendor.id)!.supplies).toHaveLength(1);
  });

  it('matches supplies regardless of case/whitespace drift between product and existing supply', () => {
    const vendor = useVendorStore.getState().addVendor({
      vendor: 'Acme', contact: '', phone: '',
      supplies: [{ category: 'Fertilizer', subcategory: 'Nitrogen' }], notes: '',
    });
    // Product created with differently-cased/padded category should NOT create a duplicate
    const added = useVendorStore.getState().addSupply(vendor.id, ' fertilizer ', ' nitrogen ');
    expect(added).toBe(false);
    expect(useVendorStore.getState().getVendor(vendor.id)!.supplies).toHaveLength(1);
  });
});
