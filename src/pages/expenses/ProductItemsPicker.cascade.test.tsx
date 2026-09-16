import { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { ProductItemsPicker } from './ProductItemsPicker';
import { useVendorStore } from '../../store/vendorStore';
import { useVendorProductStore } from '../../store/vendorProductStore';
import { useProductStore } from '../../store/productStore';
import { useExpenseCategoryStore } from '../../store/expenseCategoryStore';
import type { ExpenseItem } from '../../types';

beforeEach(() => {
  useVendorProductStore.setState({ products: [], prices: [] });
  useProductStore.setState({ products: [], _seeded: 999 });
  useExpenseCategoryStore.setState({
    entries: [
      { id: 'c1', category: 'Fertilizer', subcategory: 'Nitrogen', quantifiable: true, createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
});

/** Renders the picker with a controlled `items` list, mirroring ExpenseForm. */
function Harness({ vendorId }: { vendorId: string }) {
  const [items, setItems] = useState<ExpenseItem[]>([]);
  return (
    <ProductItemsPicker vendorId={vendorId} vendorName="Acme" items={items} onChange={setItems} />
  );
}

describe('ProductItemsPicker cascades a checked product into vendor supplies', () => {
  it('checking a vendor supply entry records it back on the vendor (already present) and a new product cascades', () => {
    // Vendor already declares one supply so it appears as a checklist entry
    useVendorStore.setState({
      vendors: [
        {
          id: 'v1', vendor: 'Acme', contact: '', phone: '',
          supplies: [{ category: 'Fertilizer', subcategory: 'Nitrogen' }],
          notes: '', createdAt: '', updatedAt: '',
        },
      ],
      _seeded: 999,
    });

    render(<Harness vendorId="v1" />);

    // The declared supply shows as a checkable entry
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // After selecting, the supply is promoted to a catalog product + line item,
    // and the cascade keeps the supply on the vendor.
    const vendor = useVendorStore.getState().getVendor('v1')!;
    expect(vendor.supplies).toContainEqual({ category: 'Fertilizer', subcategory: 'Nitrogen' });
    // A catalog product was created and linked to the vendor
    expect(useVendorProductStore.getState().productsFor('v1').length).toBe(1);
  });

  it('inline "New product" persists a new subcategory into the expense taxonomy (sorted)', () => {
    useVendorStore.setState({
      vendors: [
        { id: 'v1', vendor: 'Acme', contact: '', phone: '', supplies: [], notes: '', createdAt: '', updatedAt: '' },
      ],
      _seeded: 999,
    });

    render(<Harness vendorId="v1" />);

    // Open the inline create-product form
    fireEvent.click(screen.getByRole('button', { name: /new product/i }));

    // Category: pick the existing 'Fertilizer' via its select (the one carrying that option)
    const categorySelect = Array.from(document.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'Fertilizer')
    ) as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: 'Fertilizer' } });

    // Subcategory: choose "+ Add new subcategory…" then type a brand-new value
    const subSelect = Array.from(document.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.textContent?.includes('Add new subcategory'))
    ) as HTMLSelectElement;
    fireEvent.change(subSelect, { target: { value: '__new__' } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Magnesium/i), { target: { value: 'Potassium' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    // Unit (required): pick an existing seeded unit ('sack')
    const unitSelect = Array.from(document.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'sack')
    ) as HTMLSelectElement;
    fireEvent.change(unitSelect, { target: { value: 'sack' } });

    // Default price (required)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 250/i), { target: { value: '300' } });

    // Flag it as resold so it cascades into the sellable Products list
    fireEvent.click(screen.getByLabelText(/We resell this/i));

    // Submit the new product (product name left blank → defaults to subcategory)
    fireEvent.click(screen.getByRole('button', { name: /add product/i }));

    // The new subcategory is now in the taxonomy under Fertilizer, sorted
    const subs = useExpenseCategoryStore.getState().subcategoriesFor('Fertilizer');
    expect(subs).toContain('Potassium');
    expect(subs).toEqual([...subs].sort());

    // The product was created with the subcategory as its default name
    const product = useVendorProductStore.getState().products.find((p) => p.subcategory === 'Potassium');
    expect(product?.name).toBe('Potassium');

    // Cascaded into the sellable Products store with unit + cost = the entered price
    const sellable = useProductStore.getState().findByCategorySub('Fertilizer', 'Potassium');
    expect(sellable).toBeDefined();
    expect(sellable?.unit).toBe('sack');
    expect(sellable?.costPHP).toBe(300);
    expect(sellable?.sellingPricePHP).toBe(0);
  });

  it('does NOT cascade to the sellable Products list when "We resell this" is left off', () => {
    useVendorStore.setState({
      vendors: [
        { id: 'v1', vendor: 'Acme', contact: '', phone: '', supplies: [], notes: '', createdAt: '', updatedAt: '' },
      ],
      _seeded: 999,
    });

    render(<Harness vendorId="v1" />);
    fireEvent.click(screen.getByRole('button', { name: /new product/i }));

    const categorySelect = Array.from(document.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'Fertilizer')
    ) as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: 'Fertilizer' } });

    const subSelect = Array.from(document.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.textContent?.includes('Add new subcategory'))
    ) as HTMLSelectElement;
    fireEvent.change(subSelect, { target: { value: '__new__' } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Magnesium/i), { target: { value: 'Cement' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    const unitSelect = Array.from(document.querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'sack')
    ) as HTMLSelectElement;
    fireEvent.change(unitSelect, { target: { value: 'sack' } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 250/i), { target: { value: '250' } });

    // Leave "We resell this" unchecked (default), then submit
    fireEvent.click(screen.getByRole('button', { name: /add product/i }));

    // Catalog got it, but the sellable Products list did NOT
    expect(useVendorProductStore.getState().products.some((p) => p.subcategory === 'Cement')).toBe(true);
    expect(useProductStore.getState().findByCategorySub('Fertilizer', 'Cement')).toBeUndefined();
  });
});
