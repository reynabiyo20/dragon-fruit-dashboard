import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Sprout, AlertTriangle, DollarSign, PackageCheck, Pencil, FlaskConical, ListChecks, PackagePlus, Bell, BellOff, X } from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useInventoryStore } from '../../store/inventoryStore';
import { useProductStore } from '../../store/productStore';
import { useUnitStore } from '../../store/optionStores';
import type { InventoryItem } from '../../types';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { SectionCard } from '../../components/ui/SectionCard';
import { CollapsibleSection } from '../../components/ui/CollapsibleSection';
import { RowActions } from '../../components/ui/RowActions';
import { UndoBar } from '../../components/ui/UndoBar';
import { formatNumber, formatPHP, formatDate, categoryLabel } from '../../utils/format';
import { todayISO } from '../../utils/date';
import { useListCrud } from '../../hooks/useListCrud';
import { LOW_STOCK_THRESHOLD, CUTTINGS_PRODUCT_TYPE, DRINK_PRODUCT_TYPE, isServiceCategory } from '../../constants';
import { BRAND, PIE_COLORS } from '../../constants/chartColors';
import {
  AXIS_TICK, AXIS_LINE, GRID_STROKE,
  TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE,
  LEGEND_STYLE, LEGEND_ICON_SIZE,
  PIE_OUTER_RADIUS, PIE_INNER_RADIUS, PIE_CENTER_Y, renderPieValueLabel,
} from '../../constants/chartTheme';
import { useProductCategoryStore } from '../../store/productCategoryStore';
import { useManufacturingStore } from '../../store/manufacturingStore';
import { useTableUiStore } from '../../store/tableUiStore';
import { syncTaxonomy } from '../../store/taxonomySync';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { InventoryForm } from './InventoryForm';

export function InventoryPage() {
  const { items, deleteItem, updateItem, totalValue, lowStockItems, packCuttings, unpackCuttings, ensureRow, adjustProduced, adjustUsedCuttings } = useInventoryStore();
  // Products store — used by the "Add to Products" bulk action, which turns
  // selected inventory rows into sellable products (find-or-create, seeding cost
  // from unitCost; selling price is left for the user to fill in later).
  const upsertSellableProduct = useProductStore((s) => s.upsertFromPurchase);
  const findSellableProduct = useProductStore((s) => s.findByCategorySub);
  const deleteProduct = useProductStore((s) => s.deleteProduct);
  // Subscribe to the product list so the per-row "Sold" indicator updates live as
  // products are linked/unlinked. Keyed by normalized category|subcategory.
  const products = useProductStore((s) => s.products);
  const soldKeys = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase();
    return new Set(products.map((p) => `${norm(p.category)}|${norm(p.subcategory)}`));
  }, [products]);
  const isSold = (i: InventoryItem) =>
    soldKeys.has(`${i.category.trim().toLowerCase()}|${i.subcategory.trim().toLowerCase()}`);
  const unitOptions = useUnitStore((s) => s.values).map((v) => ({ value: v, label: v }));
  // Taxonomy for the production target picker (any category + variety).
  const categoriesList = useProductCategoryStore((s) => s.categories);
  const subcategoriesFor = useProductCategoryStore((s) => s.subcategoriesFor);
  // Manufacturing (turn inventory inputs into a finished product).
  const manufacturing = useManufacturingStore();
  const crud = useListCrud<InventoryItem>();
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  // Reset the shared <Table> UI state (search/sort) for a given persist key. Used
  // when switching in/out of the low-stock view so a lingering search from the
  // full-inventory view can't silently hide low-stock rows — which would make the
  // visible table disagree with the "Low Stock Alerts" KPI count.
  const patchTableUi = useTableUiStore((s) => s.patch);
  // "Pack" flow: the row whose bare cuttings we're packing + the entered qty.
  const [packTarget, setPackTarget] = useState<InventoryItem | null>(null);
  const [packQty, setPackQty] = useState('');
  // "Record Usage" flow. Two modes:
  //  - 'use':     record an amount consumed NOW (increment) + date + note.
  //               Capped at current ending qty (can't use more than on hand).
  //  - 'correct': directly set the cumulative Used total to fix a typo. Can't
  //               push ending qty negative; note optional when lowering.
  //  - 'produce': consume this item as an INPUT toward making another product;
  //               stages it into a manufacturing run for a chosen target.
  const [usageTarget, setUsageTarget] = useState<InventoryItem | null>(null);
  const [usageMode, setUsageMode] = useState<'use' | 'correct' | 'produce'>('use');
  const [usageValue, setUsageValue] = useState('');  // amount-now ('use'/'produce') OR new total ('correct')
  const [usageDate, setUsageDate] = useState('');
  const [usageNote, setUsageNote] = useState('');
  const [usageError, setUsageError] = useState('');
  // 'produce' mode: the target product this input is being staged toward.
  const [prodTargetCategory, setProdTargetCategory] = useState('');
  const [prodTargetSubcategory, setProdTargetSubcategory] = useState('');
  // Cuttings usage that would eat into PACKED stock (used > needsPacking) pauses
  // to confirm. Holds a ready-to-run finalizer + the overflow amount for the
  // warning copy; cleared on confirm/cancel.
  const [usagePackedWarn, setUsagePackedWarn] = useState<
    { fromPacked: number; needsPacking: number; total: number; apply: () => void } | null
  >(null);

  // "Produce finished goods" flow: turn a target's staged inputs into stock.
  const [produceTarget, setProduceTarget] = useState<InventoryItem | null>(null);
  const [produceQty, setProduceQty] = useState('');
  const [produceDate, setProduceDate] = useState('');
  const [produceError, setProduceError] = useState('');

  // ── Bulk edit Beginning Qty + undo ──────────────────────────────────────────
  // Selecting rows and choosing "Set Beginning Qty" opens a small modal to enter
  // one value applied to every selected row. We snapshot each row's previous
  // beginningQty so the whole change can be reverted in one click; the Undo bar
  // shows only while a snapshot exists. Editing beginningQty recomputes ending
  // qty in the store, so undo (restoring the old value) also restores ending.
  const [bulkBeginRows, setBulkBeginRows] = useState<InventoryItem[] | null>(null);
  const [bulkBeginValue, setBulkBeginValue] = useState('');
  const [bulkBeginError, setBulkBeginError] = useState('');
  // Shared undo for any bulk field edit: each entry stores the row's PREVIOUS
  // value(s) as a patch, so undo simply re-applies them via updateItem.
  const [undoSnapshot, setUndoSnapshot] = useState<{ message: string; prev: { id: string; patch: Partial<InventoryItem> }[] } | null>(null);

  const openBulkBegin = (rows: InventoryItem[]) => {
    if (rows.length === 0) return;
    setBulkBeginRows(rows);
    setBulkBeginValue('');
    setBulkBeginError('');
  };
  const closeBulkBegin = () => {
    setBulkBeginRows(null);
    setBulkBeginValue('');
    setBulkBeginError('');
  };
  const confirmBulkBegin = () => {
    if (!bulkBeginRows) return;
    const value = Number(bulkBeginValue);
    if (!Number.isFinite(value) || value < 0) {
      setBulkBeginError('Enter a valid beginning quantity (0 or more).');
      return;
    }
    const prev = bulkBeginRows.map((i) => ({ id: i.id, patch: { beginningQty: i.beginningQty } }));
    bulkBeginRows.forEach((i) => updateItem(i.id, { beginningQty: value }));
    const count = bulkBeginRows.length;
    setUndoSnapshot({
      message: `Set beginning qty to ${formatNumber(value, 2)} for ${count} item${count !== 1 ? 's' : ''}.`,
      prev,
    });
    toast.success(`Updated beginning qty for ${count} item${count !== 1 ? 's' : ''}`);
    closeBulkBegin();
  };

  const undoBulk = () => {
    if (!undoSnapshot) return;
    undoSnapshot.prev.forEach(({ id, patch }) => updateItem(id, patch));
    setUndoSnapshot(null);
  };

  // ── Bulk "Add to Products" (undoable) ───────────────────────────────────────
  // Turns the selected inventory rows into sellable products. Each row is
  // upserted by (category, subcategory): a new product is created with its cost
  // seeded from the row's unitCost and a blank selling price, while an existing
  // product is left as-is (upsertFromPurchase never overwrites a set cost/price).
  // Rows without a subcategory can't identify a product, so they're skipped.
  // Undo removes only the products this action newly created (existing products
  // are never touched, so there's nothing to revert for them).
  const [bulkAddRows, setBulkAddRows] = useState<InventoryItem[] | null>(null);
  const [addUndo, setAddUndo] = useState<{ message: string; createdIds: string[] } | null>(null);
  // Undo for the "Pack" action: snapshot the row + how much was just packed so
  // it can be moved back into Needs Packing in one click (only the still-unsold
  // portion is reversible).
  const [packUndo, setPackUndo] = useState<{ message: string; itemId: string; qty: number } | null>(null);

  const openBulkAddToProducts = (rows: InventoryItem[]) => {
    if (rows.length === 0) return;
    setBulkAddRows(rows);
  };
  const closeBulkAddToProducts = () => setBulkAddRows(null);

  // Rows in the current selection that can be turned into products (have a
  // subcategory) split into those that will be newly created vs already exist.
  const addable = (bulkAddRows ?? []).filter((i) => i.subcategory.trim() !== '');
  const skipped = (bulkAddRows ?? []).length - addable.length;
  const toCreate = addable.filter((i) => !findSellableProduct(i.category, i.subcategory));
  const alreadyExist = addable.length - toCreate.length;

  const confirmBulkAddToProducts = () => {
    if (!bulkAddRows) return;
    const createdIds: string[] = [];
    addable.forEach((i) => {
      const existedBefore = !!findSellableProduct(i.category, i.subcategory);
      const product = upsertSellableProduct({
        category: i.category,
        subcategory: i.subcategory,
        unit: i.unit,
        costPHP: i.unitCost,
      });
      if (!existedBefore) createdIds.push(product.id);
    });
    const created = createdIds.length;
    if (created === 0) {
      toast(
        alreadyExist > 0
          ? `Already in Products — nothing to add`
          : `No products added — selected items have no variety set`,
        { icon: 'ℹ️' },
      );
      closeBulkAddToProducts();
      return;
    }
    setAddUndo({
      message:
        `Added ${created} product${created !== 1 ? 's' : ''} from inventory` +
        (alreadyExist > 0 ? ` (${alreadyExist} already existed)` : '') +
        `. Set their selling price in Products.`,
      createdIds,
    });
    toast.success(`Added ${created} product${created !== 1 ? 's' : ''} for sale`);
    closeBulkAddToProducts();
  };

  const undoAddToProducts = () => {
    if (!addUndo) return;
    addUndo.createdIds.forEach((id) => deleteProduct(id));
    setAddUndo(null);
  };

  // Deep-link support: /inventory?highlight=<variety> (e.g. from the Cuttings
  // Store "view inventory" link). Highlights the matching Cuttings row so the
  // packed stock is easy to spot; clears when the highlight is dismissed.
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightVariety = (searchParams.get('highlight') ?? '').trim().toLowerCase();
  const highlightRow = (i: InventoryItem) =>
    !!highlightVariety &&
    i.category === CUTTINGS_PRODUCT_TYPE &&
    i.subcategory.trim().toLowerCase() === highlightVariety;
  const highlightedItem = highlightVariety ? items.find(highlightRow) : undefined;
  const clearHighlight = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('highlight');
    setSearchParams(next, { replace: true });
  };

  const alerts = useMemo(() => lowStockItems(LOW_STOCK_THRESHOLD), [items]);
  const invValue = useMemo(() => totalValue(), [items]);
  const displayItems = showLowStockOnly ? alerts : items;

  // The low-stock view uses its OWN persisted search/sort ("inventory.low") so a
  // search typed against the full inventory ("inventory") can't carry over and
  // hide low-stock rows. Toggling clears the destination view's search first, so
  // the low-stock table always opens showing exactly `alerts` — keeping the
  // visible rows in lockstep with the "Low Stock Alerts" KPI count.
  const tablePersistKey = showLowStockOnly ? 'inventory.low' : 'inventory';
  const toggleLowStock = (next: boolean) => {
    patchTableUi(next ? 'inventory.low' : 'inventory', { query: '' });
    setShowLowStockOnly(next);
  };

  // ── Chart data ───────────────────────────────────────────────────────────────
  /** Inventory value (ending qty × unit cost) grouped by category, descending. */
  const valueByCategory = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const i of items) {
      const value = i.endingQty * i.unitCost;
      if (value === 0) continue;
      byCat.set(i.category, (byCat.get(i.category) ?? 0) + value);
    }
    return Array.from(byCat.entries())
      .map(([category, value]) => ({ category, value: Number(value.toFixed(2)) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [items]);

  /** Cutting pool composition across all Cuttings rows. */
  const cuttingPools = useMemo(() => {
    let packed = 0, needsPacking = 0, breedingStock = 0, availableForSale = 0;
    for (const i of items) {
      if (i.category !== CUTTINGS_PRODUCT_TYPE) continue;
      packed += i.packed ?? 0;
      needsPacking += i.needsPacking ?? 0;
      breedingStock += i.breedingStock ?? 0;
      availableForSale += i.availableForSale ?? 0;
    }
    return [
      { name: 'Packed', value: packed },
      { name: 'Needs Packing', value: needsPacking },
      { name: 'Breeding Stock', value: breedingStock },
      { name: 'Available for Sale', value: availableForSale },
    ].filter((d) => d.value > 0);
  }, [items]);

  const endingClass = (qty: number) =>
    qty < 0 ? 'text-red-600 font-bold' : qty === 0 ? 'text-gray-400' : 'text-leaf-700 font-semibold';

  const itemValue = (i: InventoryItem) => i.endingQty * i.unitCost;

  // A row is packable when it's a Cuttings row with bare stock waiting.
  const isPackable = (i: InventoryItem) =>
    i.category === CUTTINGS_PRODUCT_TYPE && (i.needsPacking ?? 0) > 0;

  const openPack = (i: InventoryItem) => {
    setPackTarget(i);
    setPackQty(String(i.needsPacking ?? 0)); // default to packing all bare stock
  };
  const closePack = () => { setPackTarget(null); setPackQty(''); };
  const confirmPack = () => {
    if (!packTarget) return;
    const qty = Number(packQty) || 0;
    const packed = packCuttings(packTarget.id, qty);
    if (packed > 0) {
      toast.success(`Packed ${formatNumber(packed, 0)} ${packTarget.subcategory} — now Available to Sell`);
      // Offer a one-click undo back into Needs Packing.
      setPackUndo({
        message: `Packed ${formatNumber(packed, 0)} ${packTarget.subcategory} — now Available to Sell.`,
        itemId: packTarget.id,
        qty: packed,
      });
    } else {
      toast.error('Enter a quantity packed (up to what needs packing).');
    }
    closePack();
  };

  const undoPack = () => {
    if (!packUndo) return;
    const moved = unpackCuttings(packUndo.itemId, packUndo.qty);
    if (moved > 0) {
      toast(`Moved ${formatNumber(moved, 0)} back to Needs Packing`, { icon: '↩️' });
    } else {
      // The packed stock was already sold/delivered, so it can't be pulled back.
      toast.error('Cannot undo — those cuttings have already been sold.');
    }
    setPackUndo(null);
  };

  // ── Record Usage ────────────────────────────────────────────────────────────
  const openUsage = (i: InventoryItem) => {
    setUsageTarget(i);
    setUsageMode('use');
    setUsageValue('');            // amount used now (blank so the user types it)
    setUsageDate(todayISO());     // default the usage date to today
    setUsageNote('');
    setUsageError('');
    setProdTargetCategory('');
    setProdTargetSubcategory('');
  };
  const closeUsage = () => {
    setUsageTarget(null);
    setUsageMode('use');
    setUsageValue('');
    setUsageDate('');
    setUsageNote('');
    setUsageError('');
    setProdTargetCategory('');
    setProdTargetSubcategory('');
  };
  const confirmUsage = () => {
    if (!usageTarget) return;
    const value = Number(usageValue);
    const note = usageNote.trim();
    const prevUsed = usageTarget.used ?? 0;
    const ending = usageTarget.endingQty;
    // Cuttings consume physical stock from the pools (Needs Packing first, then
    // Packed) rather than a plain `used` subtraction. When the amount used spills
    // past Needs Packing into Packed stock, we pause to confirm first.
    const isCutting = usageTarget.category.trim().toLowerCase() === CUTTINGS_PRODUCT_TYPE.toLowerCase();
    const needsPacking = usageTarget.needsPacking ?? 0;

    if (usageMode === 'use') {
      // Record an amount consumed NOW (increment). Must be positive, can't exceed
      // what's currently on hand (ending qty), and needs a date + a note.
      if (!Number.isFinite(value) || value <= 0) {
        setUsageError('Enter how much was used (greater than 0).');
        return;
      }
      if (value > ending) {
        setUsageError(`Only ${formatNumber(ending, 2)} available — can't use ${formatNumber(value, 2)}.`);
        return;
      }
      if (!usageDate) {
        setUsageError('Pick the date this was used.');
        return;
      }
      if (!note) {
        setUsageError('Add a note on what it was used for.');
        return;
      }
      const newUsed = prevUsed + value;
      const logLine = `${formatDate(usageDate)}: used ${formatNumber(value, 2)} (→ ${formatNumber(newUsed, 2)} total) — ${note}`;
      const nextNotes = usageTarget.notes?.trim() ? `${usageTarget.notes.trim()}\n${logLine}` : logLine;

      if (isCutting) {
        // Draw from Needs Packing first, then Packed. Log the note and, when the
        // usage would eat into Packed stock, confirm first.
        const targetId = usageTarget.id;
        const apply = () => {
          const fromPacked = adjustUsedCuttings(targetId, value);
          updateItem(targetId, { notes: nextNotes });
          if (fromPacked > 0) {
            toast.success(`Recorded ${formatNumber(value, 2)} used (${formatNumber(fromPacked, 2)} from packed)`);
          } else {
            toast.success(`Recorded ${formatNumber(value, 2)} used`);
          }
          closeUsage();
        };
        if (value > needsPacking) {
          setUsagePackedWarn({ fromPacked: value - needsPacking, needsPacking, total: value, apply });
          return;
        }
        apply();
        return;
      }

      updateItem(usageTarget.id, { used: newUsed, notes: nextNotes });
      toast.success(`Recorded ${formatNumber(value, 2)} used`);
      closeUsage();
      return;
    }

    if (usageMode === 'produce') {
      // Consume this item as an INPUT toward manufacturing another product. Same
      // stock rules as 'use' (positive, ≤ ending, dated) + a chosen target. The
      // input is staged into the target's manufacturing run; the finished goods
      // are credited later via the Produce action.
      const tCat = prodTargetCategory.trim();
      const tSub = prodTargetSubcategory.trim();
      if (!Number.isFinite(value) || value <= 0) {
        setUsageError('Enter how much was used (greater than 0).');
        return;
      }
      if (value > ending) {
        setUsageError(`Only ${formatNumber(ending, 2)} available — can't use ${formatNumber(value, 2)}.`);
        return;
      }
      if (!usageDate) {
        setUsageError('Pick the date this was used.');
        return;
      }
      if (!tCat || !tSub) {
        setUsageError('Pick the product this is being used to make.');
        return;
      }
      if (
        tCat.toLowerCase() === usageTarget.category.trim().toLowerCase() &&
        tSub.toLowerCase() === usageTarget.subcategory.trim().toLowerCase()
      ) {
        setUsageError("The target product must differ from the input item.");
        return;
      }
      // Deduct the input from stock via `used` and log it.
      const newUsed = prevUsed + value;
      const targetLabel = categoryLabel(tCat, tSub);
      const base = `${formatDate(usageDate)}: used ${formatNumber(value, 2)} (→ ${formatNumber(newUsed, 2)} total) — to make ${targetLabel}`;
      const logLine = note ? `${base} (${note})` : base;
      const nextNotes = usageTarget.notes?.trim() ? `${usageTarget.notes.trim()}\n${logLine}` : logLine;

      // Run the manufacturing staging + stock deduction. Deferred so a cuttings
      // packed-stock warning can gate it behind a confirmation.
      const targetId = usageTarget.id;
      const inputItem = { category: usageTarget.category, subcategory: usageTarget.subcategory, quantity: value, unit: usageTarget.unit };
      const apply = () => {
        // Make sure the target has an inventory row to receive the finished goods.
        const targetRow = ensureRow(tCat, tSub, 'piece');
        // Stage the input into the target's manufacturing run.
        manufacturing.stageInput({
          targetCategory: tCat,
          targetSubcategory: tSub,
          targetUnit: targetRow.unit,
          input: inputItem,
          date: usageDate,
        });
        if (isCutting) {
          const fromPacked = adjustUsedCuttings(targetId, value);
          updateItem(targetId, { notes: nextNotes });
          if (fromPacked > 0) {
            toast.success(`Staged ${formatNumber(value, 2)} ${inputItem.subcategory} for ${targetLabel} (${formatNumber(fromPacked, 2)} from packed)`);
          } else {
            toast.success(`Staged ${formatNumber(value, 2)} ${inputItem.subcategory} for ${targetLabel}`);
          }
        } else {
          updateItem(targetId, { used: newUsed, notes: nextNotes });
          toast.success(`Staged ${formatNumber(value, 2)} ${inputItem.subcategory} for ${targetLabel}`);
        }
        closeUsage();
      };

      if (isCutting && value > needsPacking) {
        setUsagePackedWarn({ fromPacked: value - needsPacking, needsPacking, total: value, apply });
        return;
      }
      apply();
      return;
    }

    // 'correct' mode: directly set the cumulative Used total (typo fix). Can't
    // push ending qty negative. A note is required only when this raises Used.
    if (!Number.isFinite(value) || value < 0) {
      setUsageError('Enter a valid used total (0 or more).');
      return;
    }
    const endingIfSet = ending + prevUsed - value; // ending recomputed with the new used
    if (endingIfSet < 0) {
      const maxUsed = ending + prevUsed;
      setUsageError(`Too high — Used can't exceed ${formatNumber(maxUsed, 2)} (would make ending qty negative).`);
      return;
    }
    if (value > prevUsed && !note) {
      setUsageError('Raising the Used total requires a note on what the extra was used for.');
      return;
    }
    const delta = value - prevUsed;
    const changeLabel = delta === 0 ? `Used total confirmed at ${formatNumber(value, 2)}`
      : delta > 0 ? `Used corrected +${formatNumber(delta, 2)} (→ ${formatNumber(value, 2)})`
      : `Used corrected ${formatNumber(delta, 2)} (→ ${formatNumber(value, 2)})`;
    const logLine = note
      ? `${formatDate(usageDate || todayISO())}: ${changeLabel} — ${note}`
      : `${formatDate(usageDate || todayISO())}: ${changeLabel}`;
    const nextNotes = usageTarget.notes?.trim() ? `${usageTarget.notes.trim()}\n${logLine}` : logLine;
    updateItem(usageTarget.id, { used: value, notes: nextNotes });
    toast.success('Used total corrected');
    closeUsage();
  };

  // ── Produce finished goods from a target's staged inputs ────────────────────
  const openProduce = (i: InventoryItem) => {
    setProduceTarget(i);
    setProduceQty('');
    setProduceDate(todayISO());
    setProduceError('');
  };
  const closeProduce = () => {
    setProduceTarget(null);
    setProduceQty('');
    setProduceDate('');
    setProduceError('');
  };
  const confirmProduce = () => {
    if (!produceTarget) return;
    const run = manufacturing.openRunFor(produceTarget.category, produceTarget.subcategory);
    if (!run) {
      setProduceError('Nothing staged to produce for this product yet.');
      return;
    }
    const qty = Number(produceQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setProduceError('Enter how many finished units were produced.');
      return;
    }
    if (!produceDate) {
      setProduceError('Pick the production date.');
      return;
    }
    // Close the run and credit the finished goods into the target's `produced`
    // pool (which raises its ending qty). The staged inputs were already deducted
    // from their source rows when they were staged.
    manufacturing.produceRun(run.id, qty, produceTarget.unit, produceDate);
    adjustProduced(produceTarget.id, qty);
    // Log the finished good into the product store so a produced/processed item
    // becomes a sellable product. Find-or-create by (category, subcategory):
    // a brand-new product is seeded with its cost from the target row's unitCost
    // and a blank selling price for the user to fill in later; an existing product
    // is left as-is (upsertFromPurchase never overwrites a set cost/price).
    const productExistedBefore = !!findSellableProduct(produceTarget.category, produceTarget.subcategory);
    syncTaxonomy(produceTarget.category, produceTarget.subcategory);
    upsertSellableProduct({
      category: produceTarget.category,
      subcategory: produceTarget.subcategory,
      unit: produceTarget.unit,
      costPHP: produceTarget.unitCost,
    });
    const inputsSummary = run.inputs
      .map((inp) => `${formatNumber(inp.quantity, 2)} ${inp.unit} ${categoryLabel(inp.category, inp.subcategory)}`)
      .join(', ');
    const logLine = `${formatDate(produceDate)}: produced ${formatNumber(qty, 2)} ${produceTarget.unit} from ${inputsSummary || 'staged inputs'}`;
    const nextNotes = produceTarget.notes?.trim() ? `${produceTarget.notes.trim()}\n${logLine}` : logLine;
    updateItem(produceTarget.id, { notes: nextNotes });
    toast.success(
      productExistedBefore
        ? `Produced ${formatNumber(qty, 2)} ${produceTarget.subcategory}`
        : `Produced ${formatNumber(qty, 2)} ${produceTarget.subcategory} — added to Products`,
    );
    closeProduce();
  };

  /** Staged (not-yet-produced) input count for a row acting as a manufacturing target. */
  const stagedRunFor = (i: InventoryItem) => manufacturing.openRunFor(i.category, i.subcategory);

  const columns: Column<InventoryItem>[] = [
    {
      key: 'category',
      header: 'Type',
      accessor: (i) => (
        <span className="text-xs font-medium text-berry-700 bg-berry-50 px-2 py-0.5 rounded-full">
          {i.category}
        </span>
      ),
      sortValue: (i) => i.category,
    },
    {
      key: 'subcategory',
      header: 'Variety / Item',
      accessor: (i) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-gray-900">{i.subcategory}</span>
          {isSold(i) && (
            <span
              className="text-[10px] font-semibold uppercase tracking-wide text-leaf-700 bg-leaf-50 border border-leaf-200 px-1.5 py-0.5 rounded-full flex-shrink-0"
              title="Sold in Products"
            >
              Sold
            </span>
          )}
          {alerts.some((a) => a.id === i.id) && (
            <AlertTriangle className="w-3.5 h-3.5 text-gold-500 flex-shrink-0" aria-label="Low stock" />
          )}
        </div>
      ),
      sortValue: (i) => i.subcategory,
    },
    { key: 'unit',         header: 'Unit',       accessor: (i) => i.unit,                          sortValue: (i) => i.unit,         editable: { type: 'select', options: unitOptions, getValue: (i) => i.unit } },
    {
      key: 'beginningQty',
      header: 'Beginning',
      // Cuttings don't use a plain beginning qty (tracked via Packed / Needs
      // Packing); show a dash for them, matching the other N/A columns.
      accessor: (i) =>
        i.category.trim().toLowerCase() === CUTTINGS_PRODUCT_TYPE.toLowerCase()
          ? <span className="text-gray-300" title="Cuttings are tracked under Packed / Needs Packing">—</span>
          : formatNumber(i.beginningQty, 2),
      sortValue: (i) => i.beginningQty,
      editable: { type: 'number', step: '0.01', min: 0, getValue: (i) => i.beginningQty, canEdit: (i) => !isServiceCategory(i.category) && i.category.trim().toLowerCase() !== CUTTINGS_PRODUCT_TYPE.toLowerCase() },
    },
    {
      key: 'packed',
      header: 'Packed',
      // Cuttings become on-hand sellable stock when "Marked as Packed" (or bought
      // already packed) — this adds into Ending Qty. 0 for non-cuttings rows.
      accessor: (i) => {
        const qty = i.packed ?? 0;
        return <span className={qty > 0 ? 'font-medium text-primary-700' : 'text-gray-400'}>{formatNumber(qty, 0)}</span>;
      },
      sortValue: (i) => i.packed ?? 0,
      headerClassName: 'whitespace-nowrap',
    },
    {
      key: 'needsPacking',
      header: 'Needs Packing',
      // Bare cuttings bought from a customer that still need packing. On hand
      // (counts in Ending Qty) but not sellable until packed via the Pack action.
      accessor: (i) => {
        const qty = i.needsPacking ?? 0;
        return (
          <span className={qty > 0 ? 'font-semibold text-gold-600' : 'text-gray-400'}>
            {formatNumber(qty, 0)}
          </span>
        );
      },
      sortValue: (i) => i.needsPacking ?? 0,
      headerClassName: 'whitespace-nowrap',
    },
    // Purchased and Sold are DERIVED from the Expense and Sales cascades — they
    // must not be hand-edited here, so they carry no `editable` config.
    // Cuttings never use `purchased` — their purchases route to Packed / Needs
    // Packing instead — so show a neutral dash there while keeping the real
    // number for every other product type.
    {
      key: 'purchased',
      header: 'Purchased',
      accessor: (i) =>
        i.category === CUTTINGS_PRODUCT_TYPE
          ? <span className="text-gray-300" title="Cuttings purchases show under Packed / Needs Packing">—</span>
          : formatNumber(i.purchased, 2),
      sortValue: (i) => i.purchased,
    },
    { key: 'sold',         header: 'Sold',       accessor: (i) => formatNumber(i.sold, 2),         sortValue: (i) => i.sold },
    {
      key: 'used',
      header: 'Used',
      // Editing Used opens a "Record Usage" form that requires a note on what the
      // stock was used for (appended to the row's Notes as a log). Clicking the
      // cell — or its pencil — opens the modal instead of the plain inline editor.
      accessor: (i) => (
        <button
          type="button"
          onClick={() => openUsage(i)}
          className="group/used flex items-center gap-1 text-left w-full rounded px-1 -mx-1 hover:bg-primary-50 focus:outline-none focus:ring-1 focus:ring-primary-400"
          title="Click to record usage (asks what it was used for)"
        >
          <span>{formatNumber(i.used, 2)}</span>
          <Pencil className="w-3 h-3 text-gray-300 opacity-0 group-hover/used:opacity-100 flex-shrink-0" />
        </button>
      ),
      sortValue: (i) => i.used,
    },
    {
      key: 'endingQty',
      header: 'Ending Qty',
      // beginning + purchased − used − sold + packed
      accessor: (i) => <span className={endingClass(i.endingQty)}>{formatNumber(i.endingQty, 2)}</span>,
      sortValue: (i) => i.endingQty,
      headerClassName: 'whitespace-nowrap',
    },
    {
      key: 'availableForSale',
      header: 'Available to Sell',
      // All packed-and-undelivered cuttings (farm-packed + customer-packed). A
      // subset of Ending Qty, not an addition to it. A received cutting sale
      // reduces this; packing bare stock increases it.
      accessor: (i) => {
        const qty = i.availableForSale ?? 0;
        return (
          <span className={qty > 0 ? 'font-semibold text-leaf-700' : 'text-gray-400'}>
            {formatNumber(qty, 0)}
          </span>
        );
      },
      sortValue: (i) => i.availableForSale ?? 0,
      headerClassName: 'whitespace-nowrap',
    },
    {
      key: 'breedingStock',
      header: 'Our Farm Breeding Stock',
      // Units reserved for our own plots — credited when a batch is flagged
      // "For Replant in Farm", cleared when it is "Marked as Planted".
      accessor: (i) => {
        const qty = i.breedingStock ?? 0;
        return (
          <span className={qty > 0 ? 'font-semibold text-berry-700' : 'text-gray-400'}>
            {formatNumber(qty, 0)}
          </span>
        );
      },
      sortValue: (i) => i.breedingStock ?? 0,
    },
    {
      key: 'toProcess',
      header: 'To Process',
      // Raw inputs staged toward manufacturing THIS product (fruit for a drink,
      // ingredients for a fertilizer blend). Informational — NOT part of ending
      // qty. Produce them into finished stock via the Produce action.
      accessor: (i) => {
        const run = stagedRunFor(i);
        const count = run?.inputs.length ?? 0;
        if (count === 0) return <span className="text-gray-300">—</span>;
        const summary = run!.inputs
          .map((inp) => `${formatNumber(inp.quantity, 2)} ${inp.unit} ${categoryLabel(inp.category, inp.subcategory)}`)
          .join(', ');
        return (
          <span className="font-medium text-gold-700" title={summary}>
            {count} input{count !== 1 ? 's' : ''} staged
          </span>
        );
      },
      sortValue: (i) => stagedRunFor(i)?.inputs.length ?? 0,
      headerClassName: 'whitespace-nowrap',
    },
    {
      key: 'unitCost',
      header: 'Unit Cost (₱)',
      accessor: (i) => i.unitCost > 0 ? formatPHP(i.unitCost) : '—',
      sortValue: (i) => i.unitCost,
    },
    {
      key: 'value',
      header: 'Value (₱)',
      accessor: (i) => (
        <span className="font-medium text-gray-700">
          {i.unitCost > 0 ? formatPHP(itemValue(i)) : '—'}
        </span>
      ),
      sortValue: (i) => itemValue(i),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        subtitle={`${items.length} item${items.length !== 1 ? 's' : ''} · Ending Qty = beginning + purchased − used − sold + packed + needs packing`}
        actions={
          <Button icon={<Plus className="w-4 h-4" />} onClick={crud.openAdd}>Add Item</Button>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Items" value={items.length} icon={Sprout} iconColor="text-primary-600" iconBg="bg-primary-50" />
        <StatCard title="Total Inventory Value" value={formatPHP(invValue)} subtitle="Sum of ending qty × unit cost" icon={DollarSign} iconColor="text-berry-600" iconBg="bg-berry-50" />
        <StatCard
          title="Low Stock Alerts"
          value={alerts.length}
          subtitle={
            alerts.length > 0
              ? showLowStockOnly
                ? `Showing ${alerts.length} low-stock item${alerts.length !== 1 ? 's' : ''} — click to show all`
                : `Items at or below ${LOW_STOCK_THRESHOLD} units — click to filter`
              : 'All items well stocked'
          }
          icon={AlertTriangle}
          iconColor={alerts.length > 0 ? 'text-red-500' : 'text-leaf-600'}
          iconBg={alerts.length > 0 ? 'bg-red-50' : 'bg-leaf-50'}
          titleColor={alerts.length > 0 ? 'text-red-600' : undefined}
          valueColor={alerts.length > 0 ? 'text-red-600' : undefined}
          onClick={alerts.length > 0 ? () => toggleLowStock(!showLowStockOnly) : undefined}
        />
      </div>

      {/* Analytics charts */}
      {items.length > 0 && (valueByCategory.length > 0 || cuttingPools.length > 0) && (
        <CollapsibleSection title="Analytics" subtitle="Charts" storageKey="inventory.analytics.collapsed">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Inventory value by category */}
          {valueByCategory.length > 0 && (
            <SectionCard title="Inventory Value by Category" subtitle="Ending qty × unit cost, grouped by category">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={valueByCategory} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="category" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `₱${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip
                    formatter={(v) => formatPHP(Number(v))}
                    cursor={{ fill: 'rgba(106, 58, 103, 0.06)' }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Bar dataKey="value" name="Value" fill={BRAND.berry} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          )}

          {/* Cutting pool composition */}
          {cuttingPools.length > 0 && (
            <SectionCard title="Cutting Pool Composition" subtitle="Where cutting stock sits across pools">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={cuttingPools}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy={PIE_CENTER_Y}
                    innerRadius={PIE_INNER_RADIUS}
                    outerRadius={PIE_OUTER_RADIUS}
                    paddingAngle={1}
                    label={renderPieValueLabel}
                    labelLine={false}
                  >
                    {cuttingPools.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => `${formatNumber(Number(v), 0)} cuttings`}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                  />
                  <Legend iconSize={LEGEND_ICON_SIZE} wrapperStyle={LEGEND_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </SectionCard>
          )}
        </div>
        </CollapsibleSection>
      )}

      {/* Deep-link highlight banner (from the Cuttings "view inventory" link) */}
      {highlightVariety && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5">
          <p className="text-sm text-primary-800">
            {highlightedItem
              ? <>Showing <span className="font-semibold">{highlightedItem.subcategory}</span> cuttings — <span className="font-semibold">{formatNumber(highlightedItem.availableForSale ?? 0, 0)}</span> Available to Sell.</>
              : <>No cuttings inventory row found for "{searchParams.get('highlight')}".</>}
          </p>
          <button
            type="button"
            onClick={clearHighlight}
            className="text-xs font-medium text-primary-600 hover:text-primary-800 hover:underline flex-shrink-0"
          >
            Clear
          </button>
        </div>
      )}

      {/* Active low-stock filter banner — lets the user clear the filter */}
      {showLowStockOnly && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          <span>
            Showing{' '}
            <span className="font-semibold">{alerts.length}</span>{' '}
            item{alerts.length !== 1 ? 's' : ''} at or below {LOW_STOCK_THRESHOLD} units.
          </span>
          <button
            type="button"
            onClick={() => toggleLowStock(false)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <X className="w-3.5 h-3.5" /> Clear filter
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title="No inventory items yet"
          description="Add items to track beginning qty, purchases, usage, and sales."
          action={<Button onClick={crud.openAdd} icon={<Plus className="w-4 h-4" />}>Add Item</Button>}
        />
      ) : (
        <>
        {undoSnapshot && (
          <UndoBar
            message={undoSnapshot.message}
            onUndo={undoBulk}
            onDismiss={() => setUndoSnapshot(null)}
          />
        )}
        {addUndo && (
          <UndoBar
            message={addUndo.message}
            onUndo={undoAddToProducts}
            onDismiss={() => setAddUndo(null)}
          />
        )}
        {packUndo && (
          <UndoBar
            message={packUndo.message}
            onUndo={undoPack}
            onDismiss={() => setPackUndo(null)}
          />
        )}
        <Table
          // Remount when switching modes so the table re-seeds its search from
          // the (just-cleared) persisted state for the active key — this keeps
          // the visible low-stock rows equal to the KPI's `alerts.length`.
          key={tablePersistKey}
          data={displayItems}
          columns={columns}
          keyExtractor={(i) => i.id}
          searchFilter={(i, q) =>
            i.subcategory.toLowerCase().includes(q) ||
            i.category.toLowerCase().includes(q) ||
            i.unit.toLowerCase().includes(q) ||
            i.notes.toLowerCase().includes(q)
          }
          searchPlaceholder={showLowStockOnly ? 'Search low-stock items…' : 'Search inventory…'}
          emptyMessage={showLowStockOnly ? 'No low-stock items found.' : 'No inventory items found.'}
          // Highlight the deep-linked Cuttings row (from the packed-cutting link).
          rowClassName={(i) => (highlightRow(i) ? 'bg-primary-50 hover:bg-primary-100' : '')}
          actions={(i) => (
            <div className="flex items-center justify-end gap-1">
              {isPackable(i) && (
                <Button
                  variant="ghost"
                  size="xs"
                  icon={<PackageCheck className="w-3.5 h-3.5" />}
                  onClick={() => openPack(i)}
                  className="text-gold-600 hover:text-gold-700 hover:bg-gold-50"
                >
                  Pack
                </Button>
              )}
              {!!stagedRunFor(i) && (
                <Button
                  variant="ghost"
                  size="xs"
                  icon={<FlaskConical className="w-3.5 h-3.5" />}
                  onClick={() => openProduce(i)}
                  className="text-gold-600 hover:text-gold-700 hover:bg-gold-50"
                >
                  Produce
                </Button>
              )}
              {/* Low-stock tracking toggle: let the user mark an item "ok to be low"
                  so it stops nagging as low stock (service categories are already
                  auto-excluded, so the toggle is hidden for them). */}
              {!isServiceCategory(i.category) && (
                <button
                  type="button"
                  onClick={() => updateItem(i.id, { ignoreLowStock: !i.ignoreLowStock })}
                  aria-pressed={!!i.ignoreLowStock}
                  title={
                    i.ignoreLowStock
                      ? 'Low-stock alerts off — click to track low stock again'
                      : 'Tracking low stock — click to mark "ok to be low"'
                  }
                  className={[
                    'p-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                    i.ignoreLowStock
                      ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                      : 'text-gold-500 hover:text-gold-600 hover:bg-gold-50',
                  ].join(' ')}
                >
                  {i.ignoreLowStock ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                </button>
              )}
              <RowActions onEdit={() => crud.openEdit(i)} onDelete={() => crud.requestDelete(i)} />
            </div>
          )}
          bulkActions={{
            noun: 'item',
            actions: [
              { label: 'Add to Products', icon: <PackagePlus className="w-4 h-4" />, onClick: openBulkAddToProducts, variant: 'primary' },
              { label: 'Set Beginning Qty', icon: <ListChecks className="w-4 h-4" />, onClick: openBulkBegin },
            ],
            onDelete: (rows) => rows.forEach((i) => deleteItem(i.id)),
          }}
          onCellEdit={(i, key, value) => updateItem(i.id, { [key]: value })}
          persistKey={tablePersistKey}
          defaultSort={{ key: 'subcategory', dir: 'asc' }}
          getRecency={(i) => i.createdAt}
        />
        </>
      )}

      <Modal open={crud.modalOpen} onClose={crud.closeModal} title={crud.editing ? 'Edit Inventory Item' : 'Add Inventory Item'} size="lg">
        <InventoryForm item={crud.editing} onClose={crud.closeModal} />
      </Modal>

      {/* Bulk-set Beginning Qty across the selected rows (undoable) */}
      <Modal open={!!bulkBeginRows} onClose={closeBulkBegin} title="Set Beginning Qty" size="sm">
        {bulkBeginRows && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Set the beginning quantity for{' '}
              <span className="font-medium text-gray-900">{bulkBeginRows.length}</span> selected
              item{bulkBeginRows.length !== 1 ? 's' : ''}. Ending qty recalculates automatically, and
              you can undo this right after.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Beginning quantity</label>
              <input
                type="number"
                min="0"
                step="0.01"
                autoFocus
                value={bulkBeginValue}
                onChange={(e) => { setBulkBeginValue(e.target.value); setBulkBeginError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmBulkBegin(); } }}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {bulkBeginError && <p className="text-xs text-red-500 mt-1">{bulkBeginError}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeBulkBegin}>Cancel</Button>
              <Button icon={<ListChecks className="w-4 h-4" />} onClick={confirmBulkBegin}>Apply to {bulkBeginRows.length}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk "Add to Products" — turn selected inventory rows into sellable products */}
      <Modal open={!!bulkAddRows} onClose={closeBulkAddToProducts} title="Add to Products" size="sm">
        {bulkAddRows && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Add{' '}
              <span className="font-medium text-gray-900">{toCreate.length}</span>{' '}
              selected inventory item{toCreate.length !== 1 ? 's' : ''} to the Products catalog for
              sale. Each product's cost is seeded from its inventory unit cost; the selling price is
              left blank for you to set in Products. You can undo this right after.
            </p>

            {toCreate.length > 0 && (
              <ul className="max-h-48 overflow-auto scrollbar-thin rounded-lg border border-gray-100 divide-y divide-gray-50">
                {toCreate.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-gray-800">
                      {categoryLabel(i.category, i.subcategory)}
                    </span>
                    <span className="flex-shrink-0 text-xs text-gray-500">
                      {i.unitCost > 0 ? formatPHP(i.unitCost) : 'no cost'} / {i.unit || '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {(alreadyExist > 0 || skipped > 0) && (
              <div className="space-y-1 text-xs text-gray-500">
                {alreadyExist > 0 && (
                  <p>
                    {alreadyExist} selected item{alreadyExist !== 1 ? 's are' : ' is'} already in
                    Products and will be left unchanged.
                  </p>
                )}
                {skipped > 0 && (
                  <p>
                    {skipped} selected item{skipped !== 1 ? 's have' : ' has'} no variety set and
                    can't be added.
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeBulkAddToProducts}>Cancel</Button>
              <Button
                icon={<PackagePlus className="w-4 h-4" />}
                onClick={confirmBulkAddToProducts}
                disabled={toCreate.length === 0}
              >
                {toCreate.length > 0 ? `Add ${toCreate.length} to Products` : 'Nothing to add'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Pack bare cuttings → Ready for Sale */}
      <Modal open={!!packTarget} onClose={closePack} title="Pack Cuttings" size="sm">
        {packTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Move packed <span className="font-medium text-gray-900">{packTarget.subcategory}</span> cuttings
              from <span className="font-medium">Needs Packing</span> into <span className="font-medium">Available to Sell</span>.
              {' '}<span className="text-gray-500">{formatNumber(packTarget.needsPacking ?? 0, 0)} awaiting packing.</span>
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity packed</label>
              <input
                type="number"
                min="0"
                step="1"
                max={packTarget.needsPacking ?? 0}
                value={packQty}
                onChange={(e) => setPackQty(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-gray-400 mt-1">Ending Qty is unchanged — the stock was already on hand.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closePack}>Cancel</Button>
              <Button icon={<PackageCheck className="w-4 h-4" />} onClick={confirmPack}>Pack</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Record Usage — updating Used requires a note on what it was used for */}
      <Modal open={!!usageTarget} onClose={closeUsage} title="Record Usage" size="sm">
        {usageTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-900">{usageTarget.subcategory}</span>
              {' '}<span className="text-gray-500">({usageTarget.category})</span> —
              {' '}<span className="font-medium">{formatNumber(usageTarget.endingQty, 2)}</span> on hand,
              {' '}<span className="font-medium">{formatNumber(usageTarget.used ?? 0, 2)}</span> used so far.
            </p>

            {/* Mode toggle: consume stock, use it to make another product, or
                correct the running total. */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => { setUsageMode('use'); setUsageValue(''); setUsageError(''); }}
                className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                  usageMode === 'use'
                    ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Use / consume
              </button>
              <button
                type="button"
                onClick={() => {
                  setUsageMode('produce');
                  setUsageValue('');
                  setUsageError('');
                  // Default the target type to Drink (the common case); editable.
                  if (!prodTargetCategory) setProdTargetCategory(DRINK_PRODUCT_TYPE);
                }}
                className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                  usageMode === 'produce'
                    ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Make a product
              </button>
              <button
                type="button"
                onClick={() => { setUsageMode('correct'); setUsageValue(String(usageTarget.used ?? 0)); setUsageError(''); }}
                className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                  usageMode === 'correct'
                    ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                Correct total
              </button>
            </div>

            {/* Production target picker (only in 'produce' mode). Both fields are
                creatable; new type/variety cascade into the shared taxonomies. */}
            {usageMode === 'produce' && (
              <div className="grid grid-cols-2 gap-3">
                <CreatableSelect
                  label="Make (type)"
                  value={prodTargetCategory}
                  options={categoriesList().map((c) => ({ value: c, label: c }))}
                  onChange={(v) => { setProdTargetCategory(v); setProdTargetSubcategory(''); setUsageError(''); }}
                  onCreate={(v) => {
                    // New target type → register in the shared taxonomies.
                    syncTaxonomy(v, '');
                    setProdTargetCategory(v);
                    setProdTargetSubcategory('');
                    setUsageError('');
                  }}
                  placeholder="Select type…"
                  createLabel="+ Create new type…"
                  newFieldLabel="New Type"
                  newFieldPlaceholder="e.g. Drink"
                />
                <CreatableSelect
                  label="Variety"
                  value={prodTargetSubcategory}
                  options={(prodTargetCategory ? subcategoriesFor(prodTargetCategory) : []).map((s) => ({ value: s, label: s }))}
                  onChange={(v) => { setProdTargetSubcategory(v); setUsageError(''); }}
                  onCreate={(v) => {
                    // New variety under the chosen type → cascade to taxonomies.
                    if (prodTargetCategory.trim()) syncTaxonomy(prodTargetCategory, v);
                    setProdTargetSubcategory(v);
                    setUsageError('');
                  }}
                  disabled={!prodTargetCategory}
                  placeholder={prodTargetCategory ? 'Select or add variety…' : 'Pick a type first'}
                  createLabel="+ Enter variety…"
                  newFieldLabel="Variety"
                  newFieldPlaceholder="e.g. Calamansi"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {usageMode === 'correct' ? 'New Used total' : 'Quantity used'}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={usageMode === 'correct' ? usageTarget.endingQty + (usageTarget.used ?? 0) : usageTarget.endingQty}
                  value={usageValue}
                  onChange={(e) => { setUsageValue(e.target.value); setUsageError(''); }}
                  placeholder={usageMode === 'correct' ? '' : `up to ${formatNumber(usageTarget.endingQty, 2)}`}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {usageMode === 'correct'
                    ? 'Fixes the cumulative Used figure.'
                    : `Deducts from stock. Max ${formatNumber(usageTarget.endingQty, 2)}.`}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={usageDate}
                  onChange={(e) => { setUsageDate(e.target.value); setUsageError(''); }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {usageMode === 'produce' ? 'Note (optional)' : 'Used for'}
                {(usageMode === 'use' || (usageMode === 'correct' && Number(usageValue) > (usageTarget.used ?? 0))) && <span className="text-red-500"> *</span>}
              </label>
              <textarea
                rows={2}
                value={usageNote}
                onChange={(e) => { setUsageNote(e.target.value); setUsageError(''); }}
                placeholder={usageMode === 'produce' ? 'e.g. batch #4, extra ripe fruit…' : 'e.g. planted in Plot 3, given to staff, potting mix batch…'}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                {usageMode === 'use'
                  ? "Required. Appended to this item's Notes as a dated log."
                  : usageMode === 'produce'
                    ? "Optional — the target product is logged automatically. Produce the finished goods from that product's row."
                    : Number(usageValue) > (usageTarget.used ?? 0)
                      ? "Required when raising the total. Appended to Notes as a dated log."
                      : "Optional for a correction. Appended to Notes as a dated log."}
              </p>
            </div>

            {usageError && <p className="text-xs text-red-500">{usageError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeUsage}>Cancel</Button>
              <Button onClick={confirmUsage}>
                {usageMode === 'use' ? 'Record Usage' : usageMode === 'produce' ? 'Stage for Production' : 'Save Correction'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cuttings usage that spills past Needs Packing into Packed stock —
          confirm before drawing sellable packed cuttings down. */}
      <ConfirmDialog
        open={!!usagePackedWarn}
        onClose={() => setUsagePackedWarn(null)}
        onConfirm={() => {
          usagePackedWarn?.apply();
          setUsagePackedWarn(null);
        }}
        title="This will use packed cuttings"
        message={
          usagePackedWarn
            ? `Only ${formatNumber(usagePackedWarn.needsPacking, 2)} need packing, but you're using ${formatNumber(usagePackedWarn.total, 2)}. The extra ${formatNumber(usagePackedWarn.fromPacked, 2)} will be deducted from packed (ready-for-sale) cuttings. Continue?`
            : ''
        }
        confirmLabel="Use packed cuttings"
      />

      {/* Produce finished goods from staged inputs */}
      <Modal open={!!produceTarget} onClose={closeProduce} title="Produce Finished Goods" size="sm">
        {produceTarget && (() => {
          const run = stagedRunFor(produceTarget);
          return (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Produce <span className="font-medium text-gray-900">{produceTarget.subcategory}</span>
                {' '}<span className="text-gray-500">({produceTarget.category})</span> from its staged inputs.
              </p>
              {run && run.inputs.length > 0 ? (
                <div className="rounded-lg border border-gold-100 bg-gold-50 p-2">
                  <p className="text-xs font-medium text-gold-700 mb-1">Inputs consumed for this batch:</p>
                  <ul className="text-xs text-gold-800 space-y-0.5">
                    {run.inputs.map((inp, idx) => (
                      <li key={idx}>
                        {formatNumber(inp.quantity, 2)} {inp.unit} — {categoryLabel(inp.category, inp.subcategory)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-gray-400">No staged inputs. Use "Make a product" from an input item first.</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Finished units ({produceTarget.unit})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={produceQty}
                    onChange={(e) => { setProduceQty(e.target.value); setProduceError(''); }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Credited to this product's stock (ending qty).</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={produceDate}
                    onChange={(e) => { setProduceDate(e.target.value); setProduceError(''); }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
              {produceError && <p className="text-xs text-red-500">{produceError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeProduce}>Cancel</Button>
                <Button icon={<FlaskConical className="w-4 h-4" />} onClick={confirmProduce} disabled={!run || run.inputs.length === 0}>
                  Produce
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((i) => deleteItem(i.id))}
        message={`Delete inventory item "${crud.deleteTarget?.subcategory}"? This cannot be undone.`}
      />
    </div>
  );
}
