import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
}));

import { SaleForm } from './SaleForm';
import { useProductStore } from '../../store/productStore';
import { useSaleStore } from '../../store/saleStore';
import { useCustomerStore } from '../../store/customerStore';
import { useEmployeeStore } from '../../store/employeeStore';
import type { Product } from '../../types';

function product(over: Partial<Product>): Product {
  return {
    id: over.id ?? 'p1',
    category: over.category ?? 'Fruit',
    subcategory: over.subcategory ?? 'Thai White',
    costPHP: 0,
    sellingPricePHP: over.sellingPricePHP ?? 100,
    costUSD: 0,
    sellingPriceUSD: 0,
    unit: 'Kg',
    notes: '',
    createdAt: '',
    updatedAt: '',
  };
}

beforeEach(() => {
  useProductStore.setState({
    products: [
      product({ id: 'p1', subcategory: 'Thai White', sellingPricePHP: 300 }),
      product({ id: 'p2', subcategory: 'Variety 2', sellingPricePHP: 200 }),
      product({ id: 'p3', subcategory: 'Variety 3', sellingPricePHP: 150 }),
    ],
    _seeded: 999,
  });
  useSaleStore.setState({ sales: [] });
  useCustomerStore.setState({ customers: [] });
  useEmployeeStore.setState({ employees: [] });
});

/** Number of line-item rows (each shows a "Qty *" field). */
function lineCount(): number {
  return screen.queryAllByText(/^Qty \*/).length;
}

describe('SaleForm bulk product multi-select', () => {
  it('checking products in the picker adds a line per product; unchecking removes it', () => {
    render(<SaleForm sale={null} onClose={() => {}} />);

    // No lines yet
    expect(lineCount()).toBe(0);

    // Open the bulk picker
    fireEvent.click(screen.getByRole('button', { name: /select products/i }));

    // Check two products from the checklist
    const picker = screen.getByPlaceholderText(/search products/i).closest('div')!;
    const box = (label: RegExp) =>
      within(picker).getByText(label).closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement;

    fireEvent.click(box(/Fruit – Thai White/i));
    fireEvent.click(box(/Fruit – Variety 2/i));

    // Two line items were added, and both products show as checked
    expect(lineCount()).toBe(2);
    expect(box(/Fruit – Thai White/i).checked).toBe(true);
    expect(box(/Fruit – Variety 2/i).checked).toBe(true);

    // Uncheck one → its line is removed
    fireEvent.click(box(/Fruit – Thai White/i));
    expect(lineCount()).toBe(1);
    expect(box(/Fruit – Thai White/i).checked).toBe(false);
    expect(box(/Fruit – Variety 2/i).checked).toBe(true);
  });
});
