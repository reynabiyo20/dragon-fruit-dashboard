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
import { useUnitStore } from '../../store/optionStores';
import type { ExpenseItem } from '../../types';

beforeEach(() => {
  useVendorProductStore.setState({ products: [], prices: [] });
  useProductStore.setState({
    products: [
      {
        id: 'ab', category: 'Cuttings', subcategory: 'American Beauty',
        costPHP: 35, sellingPricePHP: 300, costUSD: 0, sellingPriceUSD: 10,
        unit: 'piece', notes: '', createdAt: '', updatedAt: '',
      },
    ],
    _seeded: 999,
  });
  useExpenseCategoryStore.setState({
    entries: [
      { id: 'c1', category: 'Cuttings', subcategory: 'American Beauty', quantifiable: true, createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
});

function Harness({ vendorId, onItems }: { vendorId: string; onItems?: (items: ExpenseItem[]) => void }) {
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const handle = (next: ExpenseItem[]) => { setItems(next); onItems?.(next); };
  return <ProductItemsPicker vendorId={vendorId} vendorName="Acme" items={items} onChange={handle} />;
}

const vendorWithAmericanBeauty = () =>
  useVendorStore.setState({
    vendors: [
      {
        id: 'v1', vendor: 'Acme', contact: '', phone: '', location: { province: '', municipality: '' },
        supplies: [{ category: 'Cuttings', subcategory: 'American Beauty' }],
        notes: '', createdAt: '', updatedAt: '',
      },
    ],
    _seeded: 999,
  });

describe('ProductItemsPicker resolves and displays the line unit', () => {
  it('selecting Cuttings/American Beauty resolves unit "piece" from the product catalog', () => {
    vendorWithAmericanBeauty();
    let latestItems: ExpenseItem[] = [];
    render(<Harness vendorId="v1" onItems={(it) => { latestItems = it; }} />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(latestItems[0]?.unit).toBe('piece');
    // The line's unit select reflects the resolved value (not the blank "—").
    const unitSelect = screen.getByLabelText(/Unit for/i) as HTMLSelectElement;
    expect(unitSelect.value).toBe('piece');
  });

  it('shows a legacy title-cased unit via the matching option casing (not blank "—")', () => {
    // Product catalog carries a legacy "Piece" (capital P) that the unit list
    // ('piece') only has in lowercase.
    useProductStore.setState({
      products: [
        {
          id: 'ab', category: 'Cuttings', subcategory: 'American Beauty',
          costPHP: 35, sellingPricePHP: 300, costUSD: 0, sellingPriceUSD: 10,
          unit: 'Piece', notes: '', createdAt: '', updatedAt: '',
        },
      ],
      _seeded: 999,
    });
    useUnitStore.setState({ values: ['piece'], _seeded: 999 } as never);
    vendorWithAmericanBeauty();

    render(<Harness vendorId="v1" />);
    fireEvent.click(screen.getByRole('checkbox'));

    const unitSelect = screen.getByLabelText(/Unit for/i) as HTMLSelectElement;
    // The select resolves to the option's canonical casing rather than the
    // blank "—", so the unit is visible instead of appearing unset.
    expect(unitSelect.value).toBe('piece');
  });

  it('shows a unit missing entirely from the option list as its own option', () => {
    useProductStore.setState({
      products: [
        {
          id: 'ab', category: 'Cuttings', subcategory: 'American Beauty',
          costPHP: 35, sellingPricePHP: 300, costUSD: 0, sellingPriceUSD: 10,
          unit: 'crate', notes: '', createdAt: '', updatedAt: '',
        },
      ],
      _seeded: 999,
    });
    useUnitStore.setState({ values: ['piece'], _seeded: 999 } as never);
    vendorWithAmericanBeauty();

    render(<Harness vendorId="v1" />);
    fireEvent.click(screen.getByRole('checkbox'));

    const unitSelect = screen.getByLabelText(/Unit for/i) as HTMLSelectElement;
    expect(unitSelect.value).toBe('crate');
  });
});
