import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useProductStore } from '../../store/productStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { formatNumber, categoryLabel } from '../../utils/format';

/** How a checked product's quantity is applied to its inventory row. */
export type QtyMode = 'add' | 'set';

/** A selected existing product with the quantity the user wants to stock. */
export interface ExistingSelection {
  productId: string;
  category: string;
  subcategory: string;
  unit: string;
  unitCost: number;
  beginningQty: number;
  mode: QtyMode;
}

interface ExistingProductsPickerProps {
  selections: Record<string, ExistingSelection>;
  onChange: (next: Record<string, ExistingSelection>) => void;
}

/**
 * Pick multiple products from the Products catalog to stock in Inventory. Each
 * checked product gets a beginning-qty input, an editable unit cost (prefilled
 * from the product), and an Add-to / Set-to toggle that decides whether the
 * quantity is added to any existing inventory row or replaces it. Products that
 * already have an inventory row show their current ending qty for context.
 */
export function ExistingProductsPicker({ selections, onChange }: ExistingProductsPickerProps) {
  const products = useProductStore((s) => s.products);
  const findInventory = useInventoryStore((s) => s.findByCategorySub);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).sort(),
    [products],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => (category === 'all' ? true : p.category === category))
      .filter((p) => {
        if (!q) return true;
        return (
          p.subcategory.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        (a.category + a.subcategory).localeCompare(b.category + b.subcategory, undefined, { sensitivity: 'base' }),
      );
  }, [products, query, category]);

  const toggle = (productId: string) => {
    const next = { ...selections };
    if (next[productId]) {
      delete next[productId];
    } else {
      const p = products.find((x) => x.id === productId);
      if (!p) return;
      next[productId] = {
        productId,
        category: p.category,
        subcategory: p.subcategory,
        unit: p.unit || 'piece',
        unitCost: p.costPHP ?? 0,
        beginningQty: 0,
        mode: 'add',
      };
    }
    onChange(next);
  };

  const patch = (productId: string, p: Partial<ExistingSelection>) => {
    const current = selections[productId];
    if (!current) return;
    onChange({ ...selections, [productId]: { ...current, ...p } });
  };

  const selectedCount = Object.keys(selections).length;

  return (
    <div className="space-y-3">
      {/* Search + category filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[10rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products…"
            className="w-full pl-9 pr-9 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="text-sm border border-primary-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {selectedCount > 0 && (
        <p className="text-xs text-primary-700 font-medium">{selectedCount} product{selectedCount === 1 ? '' : 's'} selected</p>
      )}

      {/* Product checklist */}
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No products match.</p>
      ) : (
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-80 overflow-y-auto scrollbar-thin">
          {filtered.map((p) => {
            const checked = !!selections[p.id];
            const sel = selections[p.id];
            const existingRow = findInventory(p.category, p.subcategory);
            return (
              <div key={p.id} className="px-3 py-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(p.id)}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 flex-shrink-0"
                  />
                  <span className="flex-1 min-w-0 text-sm text-gray-700 truncate">
                    {categoryLabel(p.category, p.subcategory)}
                  </span>
                  {existingRow ? (
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      in stock: {formatNumber(existingRow.endingQty, 0)} {existingRow.unit}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300 flex-shrink-0">not stocked</span>
                  )}
                </label>

                {checked && sel && (
                  <div className="mt-2 ml-6 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                    <label className="text-xs text-gray-500">
                      Beginning Qty
                      <input
                        type="number"
                        step="0.01"
                        value={sel.beginningQty}
                        onChange={(e) => patch(p.id, { beginningQty: Number(e.target.value) || 0 })}
                        className="mt-0.5 w-full px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </label>
                    <label className="text-xs text-gray-500">
                      Unit Cost (₱)
                      <input
                        type="number"
                        step="0.01"
                        value={sel.unitCost}
                        onChange={(e) => patch(p.id, { unitCost: Number(e.target.value) || 0 })}
                        className="mt-0.5 w-full px-2 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </label>
                    {/* Add-to vs Set-to only matters when a row already exists. */}
                    {existingRow ? (
                      <div className="col-span-2 text-xs text-gray-500">
                        Apply as
                        <div className="mt-0.5 inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 ml-2">
                          {([
                            { value: 'add', label: 'Add to' },
                            { value: 'set', label: 'Set to' },
                          ] as const).map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              aria-pressed={sel.mode === opt.value}
                              onClick={() => patch(p.id, { mode: opt.value })}
                              className={[
                                'px-2.5 py-1 text-xs rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                                sel.mode === opt.value
                                  ? 'bg-white text-gray-900 shadow-sm font-medium'
                                  : 'text-gray-500 hover:text-gray-700',
                              ].join(' ')}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="col-span-2 text-xs text-gray-400 self-center">New inventory row</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
