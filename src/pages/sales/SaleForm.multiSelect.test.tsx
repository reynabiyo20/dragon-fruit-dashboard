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
import { useInventoryStore } from '../../store/inventoryStore';
import { useSaleDraftStore } from '../../store/saleDraftStore';
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
  // Clear any in-progress draft so a prior test's lines don't restore into the
  // next test's fresh new-sale form.
  useSaleDraftStore.getState().clear();
  // Give the test products on-hand stock so they can be sold. A sale is blocked
  // for any product whose inventory row has 0 ending quantity, so without stock
  // the checklist would (correctly) refuse to add these lines.
  useInventoryStore.setState({
    items: [
      { id: 'i1', category: 'Fruit', subcategory: 'Thai White', unit: 'Kg', beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 50, unitCost: 0, packed: 0, needsPacking: 0, breedingStock: 0, availableForSale: 0, produced: 0, harvested: 0, notes: '', createdAt: '', updatedAt: '' },
      { id: 'i2', category: 'Fruit', subcategory: 'Variety 2', unit: 'Kg', beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 50, unitCost: 0, packed: 0, needsPacking: 0, breedingStock: 0, availableForSale: 0, produced: 0, harvested: 0, notes: '', createdAt: '', updatedAt: '' },
      { id: 'i3', category: 'Fruit', subcategory: 'Variety 3', unit: 'Kg', beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 50, unitCost: 0, packed: 0, needsPacking: 0, breedingStock: 0, availableForSale: 0, produced: 0, harvested: 0, notes: '', createdAt: '', updatedAt: '' },
    ],
    _seeded: 999,
  });
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

  it('blocks adding a product with 0 ending stock (disabled + no line added)', () => {
    // Zero out one product's stock — it must not be sellable.
    useInventoryStore.setState({
      items: [
        { id: 'i1', category: 'Fruit', subcategory: 'Thai White', unit: 'Kg', beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 0, unitCost: 0, packed: 0, needsPacking: 0, breedingStock: 0, availableForSale: 0, produced: 0, harvested: 0, notes: '', createdAt: '', updatedAt: '' },
        { id: 'i2', category: 'Fruit', subcategory: 'Variety 2', unit: 'Kg', beginningQty: 0, purchased: 0, used: 0, sold: 0, endingQty: 50, unitCost: 0, packed: 0, needsPacking: 0, breedingStock: 0, availableForSale: 0, produced: 0, harvested: 0, notes: '', createdAt: '', updatedAt: '' },
      ],
      _seeded: 999,
    });

    render(<SaleForm sale={null} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /select products/i }));

    const picker = screen.getByPlaceholderText(/search products/i).closest('div')!;
    const box = (label: RegExp) =>
      within(picker).getByText(label).closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement;

    // The out-of-stock product's checkbox is disabled, and it shows a "No stock"
    // label — so the user can't add it to the sale.
    const outOfStockBox = box(/Fruit – Thai White/i);
    expect(outOfStockBox.disabled).toBe(true);
    expect(within(picker).getByText(/no stock/i)).toBeTruthy();

    // A product with stock is still sellable.
    fireEvent.click(box(/Fruit – Variety 2/i));
    expect(lineCount()).toBe(1);
  });
});
