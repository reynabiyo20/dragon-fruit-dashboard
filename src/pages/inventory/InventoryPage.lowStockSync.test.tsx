import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InventoryPage } from './InventoryPage';
import { useInventoryStore } from '../../store/inventoryStore';
import { useTableUiStore } from '../../store/tableUiStore';
import { LOW_STOCK_THRESHOLD } from '../../constants';

/**
 * The "Low Stock Alerts" KPI count must always equal what the low-stock table
 * view shows. Regression guard for a desync where a search typed against the
 * full inventory carried over into the low-stock view and silently hid rows
 * while the KPI still counted them.
 */

/** Add a priced row with an explicit ending qty (via beginningQty) and return it. */
function addRow(subcategory: string, endingQty: number) {
  return useInventoryStore.getState().addItem({
    category: 'Fertilizer',
    subcategory,
    unit: 'sack',
    beginningQty: endingQty,
    purchased: 0,
    used: 0,
    sold: 0,
    unitCost: 100, // priced → eligible for low-stock
    notes: '',
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <InventoryPage />
    </MemoryRouter>,
  );
}

/** The KPI value rendered in the "Low Stock Alerts" card. */
function kpiCount(): number {
  const title = screen.getByText('Low Stock Alerts');
  const card = title.closest('[role="button"]') ?? title.parentElement!;
  const value = within(card as HTMLElement).getAllByText(/^\d+$/)[0];
  return Number(value.textContent);
}

/** Count of data rows currently rendered in the inventory table body. */
function visibleRowCount(): number {
  // Each inventory data row carries a per-row "Select row" checkbox.
  return screen.queryAllByLabelText('Select row').length;
}

beforeEach(() => {
  useInventoryStore.setState({ items: [], _seeded: 999 });
  useTableUiStore.setState({ byKey: {} });
});

describe('InventoryPage — low-stock KPI stays in sync with the table', () => {
  it('KPI count equals the number of low-stock rows shown when filtered', () => {
    addRow('Cocopeat', 0); // low
    addRow('Rice Hull', 2); // low
    addRow('Vermicast', 50); // well stocked

    renderPage();

    // Two rows at/under the threshold.
    expect(kpiCount()).toBe(2);
    expect(useInventoryStore.getState().lowStockItems(LOW_STOCK_THRESHOLD)).toHaveLength(2);

    // All three rows visible before filtering.
    expect(visibleRowCount()).toBe(3);

    // Click the KPI card to filter to low-stock only.
    fireEvent.click(screen.getByText('Low Stock Alerts'));

    // Now the visible rows match the KPI count exactly.
    expect(visibleRowCount()).toBe(2);
    expect(kpiCount()).toBe(2);
  });

  it('a lingering full-inventory search does not desync the low-stock view', () => {
    addRow('Cocopeat', 0); // low
    addRow('Rice Hull', 2); // low
    addRow('Vermicast', 50); // well stocked

    renderPage();

    // Type a search that matches only the well-stocked row in the full view.
    const search = screen.getByPlaceholderText('Search inventory…');
    fireEvent.change(search, { target: { value: 'Vermicast' } });
    expect(visibleRowCount()).toBe(1);

    // Switch into the low-stock view. The stale "Vermicast" search must NOT
    // carry over and hide the low-stock rows — visible rows must equal the KPI.
    fireEvent.click(screen.getByText('Low Stock Alerts'));

    expect(kpiCount()).toBe(2);
    expect(visibleRowCount()).toBe(2);
  });
});
