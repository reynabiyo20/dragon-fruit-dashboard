import { useState } from 'react';
import { Plus, X, Tag, Pencil, Check } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { SectionCard } from '../../components/ui/SectionCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { InputField } from '../../components/forms/FormField';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import {
  useSaleTypeStore,
  useInventoryCategoryStore,
  useUnitStore,
  useEmployeeTypeStore,
} from '../../store/optionStores';
import type { OptionListStore } from '../../store/optionListStore';
import { useExpenseCategoryStore, type ExpenseCategoryEntry } from '../../store/expenseCategoryStore';
import { useProductCategoryStore, type ProductCategoryEntry } from '../../store/productCategoryStore';
import { useSaleStore } from '../../store/saleStore';
import { useProductStore } from '../../store/productStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useExpenseStore } from '../../store/expenseStore';
import { useEmployeeStore } from '../../store/employeeStore';
import { useVendorStore } from '../../store/vendorStore';
import { useListCrud } from '../../hooks/useListCrud';
import { ProductCatalogManager } from './ProductCatalogManager';
import type { UseBoundStore, StoreApi } from 'zustand';

/** A Zustand hook produced by createOptionListStore */
type OptionListHook = UseBoundStore<StoreApi<OptionListStore>>;

/* ── Simple option-list manager (chips + inline add + remove) ─────────────────── */

interface OptionListManagerProps {
  title: string;
  subtitle?: string;
  useStore: OptionListHook;
  addPlaceholder: string;
  /** Noun used in the delete confirmation, e.g. "customer type" */
  noun: string;
  /** Optional: how many existing records still use a value (shown before delete) */
  countUsage?: (value: string) => number;
}

function OptionListManager({ title, subtitle, useStore, addPlaceholder, noun, countUsage }: OptionListManagerProps) {
  // Subscribe to `values` directly so the list re-renders on add/rename/remove
  const values = useStore((s) => s.values);
  const add = useStore((s) => s.add);
  const rename = useStore((s) => s.rename);
  const remove = useStore((s) => s.remove);

  const [draft, setDraft] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  // Inline rename: the value being edited + its working draft
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const handleAdd = () => {
    const v = draft.trim();
    if (!v) return;
    // Block exact duplicates (case-insensitive) — the SimilarEntryHint already
    // shows the "already exists" notice, so just keep the draft for context.
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    add(v);
    setDraft('');
  };

  const startEdit = (v: string) => {
    setEditing(v);
    setEditDraft(v);
  };

  // A rename that collides with a DIFFERENT existing value (case-insensitive).
  const renameCollides =
    editing !== null &&
    editDraft.trim() !== '' &&
    editDraft.trim().toLowerCase() !== editing.toLowerCase() &&
    values.some((x) => x !== editing && x.toLowerCase() === editDraft.trim().toLowerCase());

  const commitEdit = () => {
    if (editing === null) return;
    // Block a rename onto an existing value — keep the editor open for a fix.
    if (renameCollides) return;
    rename(editing, editDraft);
    setEditing(null);
    setEditDraft('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditDraft('');
  };

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="space-y-4">
        {values.length === 0 ? (
          <p className="text-xs text-gray-400">No entries yet. Add one below.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {values.map((v) =>
              editing === v ? (
                <span
                  key={v}
                  className="inline-flex items-center gap-1 py-0.5 pl-1 pr-0.5 rounded-full bg-white border border-green-300"
                >
                  {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                  <input
                    autoFocus
                    type="text"
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                    }}
                    className="w-28 px-2 py-0.5 text-sm rounded-full focus:outline-none"
                    aria-label={`Rename ${v}`}
                  />
                  <button
                    type="button"
                    onClick={commitEdit}
                    aria-label="Save"
                    disabled={renameCollides}
                    className="p-1 rounded-full text-green-600 hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-400 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={renameCollides ? `"${editDraft.trim()}" already exists` : 'Save'}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    aria-label="Cancel"
                    className="p-1 rounded-full text-gray-400 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ) : (
                <span
                  key={v}
                  className="inline-flex items-center gap-0.5 pl-3 pr-1 py-1 rounded-full text-sm bg-gray-100 text-gray-700"
                >
                  {v}
                  <button
                    type="button"
                    onClick={() => startEdit(v)}
                    aria-label={`Rename ${v}`}
                    className="p-0.5 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-green-400"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRemove(v)}
                    aria-label={`Remove ${v}`}
                    className="p-0.5 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              )
            )}
          </div>
        )}

        {/* Inline-rename collision notice */}
        {renameCollides && (
          <p className="text-xs text-amber-600">"{editDraft.trim()}" already exists as a {noun} — pick a different name.</p>
        )}

        <div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <InputField
                label="Add new"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder={addPlaceholder}
              />
            </div>
            <Button type="button" icon={<Plus className="w-4 h-4" />} onClick={handleAdd}>
              Add
            </Button>
          </div>
          {/* Similar / exact-duplicate hint for the value being typed. */}
          <SimilarEntryHint
            value={draft}
            options={values}
            noun={noun}
            onPick={(v) => setDraft(v)}
          />
        </div>
      </div>

      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove !== null) remove(pendingRemove);
          setPendingRemove(null);
        }}
        title="Remove entry"
        message={(() => {
          const inUse = pendingRemove !== null && countUsage ? countUsage(pendingRemove) : 0;
          const usageNote =
            inUse > 0
              ? ` ${inUse} existing record${inUse !== 1 ? 's' : ''} still use${inUse === 1 ? 's' : ''} it — those keep their value and are not changed.`
              : ' Existing records that already use it are not affected.';
          return `Remove "${pendingRemove}" from the ${noun} list?${usageNote}`;
        })()}
        confirmLabel="Remove"
      />
    </SectionCard>
  );
}

/* ── Expense / vendor category + subcategory manager ──────────────────────────── */

interface CategoryFormState {
  category: string;
  subcategory: string;
}

/** What the category modal is doing */
type CategoryModalMode =
  | { kind: 'add' }                                        // new category (+ optional subcategory)
  | { kind: 'addSubcategory'; category: string }           // new subcategory under a fixed category
  | { kind: 'renameCategory'; category: string }           // rename a whole category (all rows)
  | { kind: 'renameSubcategory'; entry: ExpenseCategoryEntry }; // rename one subcategory row

function CategoryManager() {
  const { entries, categories, subcategoriesFor, addEntry, updateEntry, renameCategory, deleteEntry, isQuantifiable, setQuantifiable } =
    useExpenseCategoryStore();
  const expenses = useExpenseStore((s) => s.expenses);
  const vendors = useVendorStore((s) => s.vendors);

  /** Expenses + vendor supplies that use a (category, subcategory) entry. */
  const usageFor = (e: ExpenseCategoryEntry): number => {
    const usesCategory = (base: string, sub: string) =>
      e.subcategory ? base === e.category && sub === e.subcategory : base === e.category;
    const expenseHits = expenses.filter((x) => {
      // Multi-item expenses: match if any line uses the category
      if (x.items && x.items.length > 0) {
        return x.items.some((it) => usesCategory(it.category, it.subcategory));
      }
      return usesCategory(x.category, x.subcategory);
    }).length;
    const vendorHits = vendors.filter((v) =>
      v.supplies.some((s) =>
        e.subcategory
          ? s.category === e.category && s.subcategory === e.subcategory
          : s.category === e.category,
      ),
    ).length;
    return expenseHits + vendorHits;
  };
  const crud = useListCrud<ExpenseCategoryEntry>();
  const [mode, setMode] = useState<CategoryModalMode>({ kind: 'add' });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CategoryFormState>({ category: '', subcategory: '' });
  const [formError, setFormError] = useState('');

  const openAdd = () => {
    setMode({ kind: 'add' });
    setForm({ category: '', subcategory: '' });
    setFormError('');
    setModalOpen(true);
  };

  const openAddSubcategory = (category: string) => {
    setMode({ kind: 'addSubcategory', category });
    setForm({ category, subcategory: '' });
    setFormError('');
    setModalOpen(true);
  };

  const openRenameCategory = (category: string) => {
    setMode({ kind: 'renameCategory', category });
    setForm({ category, subcategory: '' });
    setFormError('');
    setModalOpen(true);
  };

  const openRenameSubcategory = (entry: ExpenseCategoryEntry) => {
    setMode({ kind: 'renameSubcategory', entry });
    setForm({ category: entry.category, subcategory: entry.subcategory });
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const norm = (s: string) => s.trim().toLowerCase();
  const handleSave = () => {
    const category = form.category.trim();
    if (!category) {
      setFormError('Category name is required');
      return;
    }
    if (mode.kind === 'add') {
      const sub = form.subcategory.trim();
      // Block an exact (case-insensitive) duplicate of the same (category, sub).
      if (entries.some((e) => norm(e.category) === norm(category) && norm(e.subcategory) === norm(sub))) {
        setFormError(sub ? `"${category} – ${sub}" already exists` : `"${category}" already exists`);
        return;
      }
      addEntry(category, sub);
    } else if (mode.kind === 'addSubcategory') {
      const sub = form.subcategory.trim();
      if (!sub) {
        setFormError('Subcategory name is required');
        return;
      }
      if (entries.some((e) => norm(e.category) === norm(mode.category) && norm(e.subcategory) === norm(sub))) {
        setFormError(`"${sub}" already exists under ${mode.category}`);
        return;
      }
      addEntry(mode.category, sub);
    } else if (mode.kind === 'renameCategory') {
      // Block renaming onto a DIFFERENT existing category.
      if (
        norm(category) !== norm(mode.category) &&
        categories().some((c) => norm(c) === norm(category))
      ) {
        setFormError(`"${category}" already exists`);
        return;
      }
      renameCategory(mode.category, category);
    } else {
      // renameSubcategory: edit just this row (category stays the same)
      const sub = form.subcategory.trim();
      if (
        norm(sub) !== norm(mode.entry.subcategory) &&
        entries.some(
          (e) => e.id !== mode.entry.id && norm(e.category) === norm(mode.entry.category) && norm(e.subcategory) === norm(sub),
        )
      ) {
        setFormError(`"${sub}" already exists under ${mode.entry.category}`);
        return;
      }
      updateEntry(mode.entry.id, mode.entry.category, sub);
    }
    closeModal();
  };

  const modalTitle =
    mode.kind === 'add' ? 'Add Category Entry'
      : mode.kind === 'addSubcategory' ? `Add Subcategory to "${mode.category}"`
        : mode.kind === 'renameCategory' ? 'Rename Category'
          : 'Rename Subcategory';

  // Group entries by category for the chip display
  const grouped = categories().map((cat) => ({
    category: cat,
    subs: entries.filter((e) => e.category === cat && e.subcategory !== ''),
  }));

  return (
    <SectionCard
      title="Vendor & Expense Categories"
      subtitle={`${entries.length} entries across ${categories().length} categories · "Quantifiable" means the expense form captures quantity × unit price`}
      actions={
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={openAdd}>
          Add
        </Button>
      }
    >
      {grouped.length === 0 ? (
        <p className="text-xs text-gray-400">No categories yet. Add one to get started.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {grouped.map(({ category, subs }) => {
            // The top-level (empty-subcategory) entry, used to delete the whole category row
            const topLevel = entries.find((e) => e.category === category && e.subcategory === '');
            const quantifiable = isQuantifiable(category);
            return (
              <div key={category} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-800 truncate">{category}</span>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => openAddSubcategory(category)}
                      aria-label={`Add subcategory to ${category}`}
                      title="Add subcategory"
                      className="p-1 rounded-md text-gray-400 hover:text-green-700 hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-400"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openRenameCategory(category)}
                      aria-label={`Rename category ${category}`}
                      title="Rename category"
                      className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-green-400"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {topLevel && (
                      <button
                        type="button"
                        onClick={() => crud.requestDelete(topLevel)}
                        aria-label={`Remove category ${category}`}
                        className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={quantifiable}
                    onChange={(e) => setQuantifiable(category, e.target.checked)}
                    className="w-3.5 h-3.5 text-green-600 border-gray-300 rounded focus:ring-green-500"
                  />
                  Quantifiable (qty × price)
                </label>

                {subs.length === 0 ? (
                  <p className="text-xs text-gray-400">No subcategories</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {subs.map((e) => (
                      <span
                        key={e.id}
                        className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700"
                      >
                        {e.subcategory}
                        <button
                          type="button"
                          onClick={() => openRenameSubcategory(e)}
                          aria-label={`Rename ${e.subcategory}`}
                          className="p-0.5 rounded-full text-blue-400 hover:text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => crud.requestDelete(e)}
                          aria-label={`Remove ${e.subcategory}`}
                          className="p-0.5 rounded-full text-blue-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / rename modal */}
      <Modal open={modalOpen} onClose={closeModal} title={modalTitle} size="sm">
        <div className="space-y-4">
          {mode.kind === 'addSubcategory' ? (
            <p className="text-xs text-gray-500">
              Adding a subcategory under{' '}
              <span className="font-medium text-gray-800">{mode.category}</span>
            </p>
          ) : (
            <div>
              <InputField
                label="Category"
                required
                value={form.category}
                onChange={(e) => { setForm((f) => ({ ...f, category: e.target.value })); setFormError(''); }}
                placeholder="e.g. Fertilizer"
                disabled={mode.kind === 'renameSubcategory'}
                hint={mode.kind === 'renameCategory' ? 'Renames this category across all its subcategories' : undefined}
                error={mode.kind === 'renameCategory' || mode.kind === 'add' ? formError : undefined}
              />
              {(mode.kind === 'add' || mode.kind === 'renameCategory') && (
                <SimilarEntryHint
                  value={form.category}
                  options={categories().filter((c) => mode.kind !== 'renameCategory' || c.toLowerCase() !== mode.category.toLowerCase())}
                  noun="category"
                  onPick={(v) => setForm((f) => ({ ...f, category: v }))}
                />
              )}
            </div>
          )}
          {mode.kind !== 'renameCategory' && (
            <div>
              <InputField
                label="Subcategory"
                required={mode.kind === 'addSubcategory'}
                value={form.subcategory}
                onChange={(e) => { setForm((f) => ({ ...f, subcategory: e.target.value })); setFormError(''); }}
                placeholder={mode.kind === 'addSubcategory' ? 'e.g. Cement' : 'e.g. Magnesium  (leave blank if top-level only)'}
                hint={mode.kind === 'add' ? 'Leave blank if this category needs no subcategories' : undefined}
                error={mode.kind === 'addSubcategory' || mode.kind === 'renameSubcategory' ? formError : undefined}
              />
              {(mode.kind === 'add' || mode.kind === 'addSubcategory' || mode.kind === 'renameSubcategory') && (
                <SimilarEntryHint
                  value={form.subcategory}
                  options={subcategoriesFor(
                    mode.kind === 'addSubcategory' ? mode.category
                      : mode.kind === 'renameSubcategory' ? mode.entry.category
                        : form.category,
                  ).filter((s) => mode.kind !== 'renameSubcategory' || s.toLowerCase() !== mode.entry.subcategory.toLowerCase())}
                  noun="subcategory"
                  onPick={(v) => setForm((f) => ({ ...f, subcategory: v }))}
                />
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleSave}>
              {mode.kind === 'add' || mode.kind === 'addSubcategory' ? 'Add Entry' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((e) => deleteEntry(e.id))}
        title="Remove entry"
        message={(() => {
          const t = crud.deleteTarget;
          if (!t) return '';
          const label = `${t.category}${t.subcategory ? ` – ${t.subcategory}` : ''}`;
          const inUse = usageFor(t);
          const note =
            inUse > 0
              ? ` ${inUse} expense/vendor record${inUse !== 1 ? 's' : ''} still use${inUse === 1 ? 's' : ''} it — those keep their value and are not changed.`
              : " This won't affect existing expenses or vendors.";
          return `Delete "${label}"?${note}`;
        })()}
        confirmLabel="Remove"
      />
    </SectionCard>
  );
}

/* ── Product type + variety manager ───────────────────────────────────────────── */

type ProductModalMode =
  | { kind: 'addCategory' }
  | { kind: 'addSubcategory'; category: string }
  | { kind: 'renameCategory'; category: string }
  | { kind: 'renameSubcategory'; entry: ProductCategoryEntry };

function ProductCategoryManager() {
  const { entries, categories, subcategoriesFor, addEntry, updateEntry, renameCategory, deleteEntry } =
    useProductCategoryStore();
  const crud = useListCrud<ProductCategoryEntry>();
  const [mode, setMode] = useState<ProductModalMode>({ kind: 'addCategory' });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<{ category: string; subcategory: string }>({ category: '', subcategory: '' });
  const [formError, setFormError] = useState('');

  const openAddCategory = () => { setMode({ kind: 'addCategory' }); setForm({ category: '', subcategory: '' }); setFormError(''); setModalOpen(true); };
  const openAddSubcategory = (category: string) => { setMode({ kind: 'addSubcategory', category }); setForm({ category, subcategory: '' }); setFormError(''); setModalOpen(true); };
  const openRenameCategory = (category: string) => { setMode({ kind: 'renameCategory', category }); setForm({ category, subcategory: '' }); setFormError(''); setModalOpen(true); };
  const openRenameSubcategory = (entry: ProductCategoryEntry) => { setMode({ kind: 'renameSubcategory', entry }); setForm({ category: entry.category, subcategory: entry.subcategory }); setFormError(''); setModalOpen(true); };
  const closeModal = () => setModalOpen(false);

  const norm = (s: string) => s.trim().toLowerCase();
  const handleSave = () => {
    const category = form.category.trim();
    if (!category) { setFormError('Category is required'); return; }
    if (mode.kind === 'addCategory') {
      const sub = form.subcategory.trim();
      if (entries.some((e) => norm(e.category) === norm(category) && norm(e.subcategory) === norm(sub))) {
        setFormError(sub ? `"${category} – ${sub}" already exists` : `"${category}" already exists`);
        return;
      }
      addEntry(category, sub);
    } else if (mode.kind === 'addSubcategory') {
      const sub = form.subcategory.trim();
      if (!sub) { setFormError('Subcategory name is required'); return; }
      if (entries.some((e) => norm(e.category) === norm(mode.category) && norm(e.subcategory) === norm(sub))) {
        setFormError(`"${sub}" already exists under ${mode.category}`);
        return;
      }
      addEntry(mode.category, sub);
    } else if (mode.kind === 'renameCategory') {
      if (
        norm(category) !== norm(mode.category) &&
        categories().some((c) => norm(c) === norm(category))
      ) {
        setFormError(`"${category}" already exists`);
        return;
      }
      renameCategory(mode.category, category);
    } else {
      const sub = form.subcategory.trim();
      if (
        norm(sub) !== norm(mode.entry.subcategory) &&
        entries.some(
          (e) => e.id !== mode.entry.id && norm(e.category) === norm(mode.entry.category) && norm(e.subcategory) === norm(sub),
        )
      ) {
        setFormError(`"${sub}" already exists under ${mode.entry.category}`);
        return;
      }
      updateEntry(mode.entry.id, mode.entry.category, sub);
    }
    closeModal();
  };

  const modalTitle =
    mode.kind === 'addCategory' ? 'Add Category'
      : mode.kind === 'addSubcategory' ? `Add Subcategory to "${mode.category}"`
        : mode.kind === 'renameCategory' ? 'Rename Category'
          : 'Rename Subcategory';

  const grouped = categories().map((category) => ({
    category,
    subs: entries.filter((e) => e.category === category && e.subcategory !== ''),
  }));

  return (
    <SectionCard
      title="Categories & Subcategories"
      subtitle={`${entries.length} entries across ${categories().length} categories · "Cuttings" orders under 25 get the small-order surcharge in Sales`}
      actions={<Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={openAddCategory}>Add</Button>}
    >
      {grouped.length === 0 ? (
        <p className="text-xs text-gray-400">No categories yet. Add one to get started.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {grouped.map(({ category, subs }) => {
            const topLevel = entries.find((e) => e.category === category && e.subcategory === '');
            return (
              <div key={category} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-800 truncate">{category}</span>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button type="button" onClick={() => openAddSubcategory(category)} aria-label={`Add subcategory to ${category}`} title="Add subcategory" className="p-1 rounded-md text-gray-400 hover:text-green-700 hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-400">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => openRenameCategory(category)} aria-label={`Rename category ${category}`} title="Rename category" className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-green-400">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {topLevel && (
                      <button type="button" onClick={() => crud.requestDelete(topLevel)} aria-label={`Remove category ${category}`} className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {subs.length === 0 ? (
                  <p className="text-xs text-gray-400">No varieties</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {subs.map((e) => (
                      <span key={e.id} className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700">
                        {e.subcategory}
                        <button type="button" onClick={() => openRenameSubcategory(e)} aria-label={`Rename ${e.subcategory}`} className="p-0.5 rounded-full text-purple-400 hover:text-purple-700 hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-400">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button type="button" onClick={() => crud.requestDelete(e)} aria-label={`Remove ${e.subcategory}`} className="p-0.5 rounded-full text-purple-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal} title={modalTitle} size="sm">
        <div className="space-y-4">
          {mode.kind === 'addSubcategory' ? (
            <p className="text-xs text-gray-500">
              Adding a subcategory under <span className="font-medium text-gray-800">{mode.category}</span>
            </p>
          ) : (
            <div>
              <InputField
                label="Category"
                required
                value={form.category}
                onChange={(e) => { setForm((f) => ({ ...f, category: e.target.value })); setFormError(''); }}
                placeholder="e.g. Drink"
                disabled={mode.kind === 'renameSubcategory'}
                hint={mode.kind === 'renameCategory' ? 'Renames this category across all its subcategories' : undefined}
                error={mode.kind === 'renameCategory' || mode.kind === 'addCategory' ? formError : undefined}
              />
              {(mode.kind === 'addCategory' || mode.kind === 'renameCategory') && (
                <SimilarEntryHint
                  value={form.category}
                  options={categories().filter((c) => mode.kind !== 'renameCategory' || c.toLowerCase() !== mode.category.toLowerCase())}
                  noun="category"
                  onPick={(v) => setForm((f) => ({ ...f, category: v }))}
                />
              )}
            </div>
          )}
          {mode.kind !== 'renameCategory' && (
            <div>
              <InputField
                label="Subcategory"
                required={mode.kind === 'addSubcategory'}
                value={form.subcategory}
                onChange={(e) => { setForm((f) => ({ ...f, subcategory: e.target.value })); setFormError(''); }}
                placeholder={mode.kind === 'addSubcategory' ? 'e.g. Thai White' : 'e.g. Thai White  (leave blank if none)'}
                hint={mode.kind === 'addCategory' ? 'Leave blank if this category has no subcategories' : undefined}
                error={mode.kind === 'addSubcategory' || mode.kind === 'renameSubcategory' ? formError : undefined}
              />
              {(mode.kind === 'addCategory' || mode.kind === 'addSubcategory' || mode.kind === 'renameSubcategory') && (
                <SimilarEntryHint
                  value={form.subcategory}
                  options={subcategoriesFor(
                    mode.kind === 'addSubcategory' ? mode.category
                      : mode.kind === 'renameSubcategory' ? mode.entry.category
                        : form.category,
                  ).filter((s) => mode.kind !== 'renameSubcategory' || s.toLowerCase() !== mode.entry.subcategory.toLowerCase())}
                  noun="subcategory"
                  onPick={(v) => setForm((f) => ({ ...f, subcategory: v }))}
                />
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleSave}>
              {mode.kind === 'addCategory' || mode.kind === 'addSubcategory' ? 'Add Entry' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!crud.deleteTarget}
        onClose={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete((e) => deleteEntry(e.id))}
        title="Remove entry"
        message={
          crud.deleteTarget?.subcategory
            ? `Delete "${crud.deleteTarget.category} – ${crud.deleteTarget.subcategory}"? This also removes the matching product so it no longer appears in Sales. Past sales keep their records.`
            : `Delete the entire "${crud.deleteTarget?.category}" category? This removes ALL products of this category so they no longer appear in Sales. Past sales keep their records.`
        }
        confirmLabel="Remove"
      />
    </SectionCard>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────────── */

export function SettingsPage() {
  // Live record collections, for showing "X records still use this" before delete.
  const sales = useSaleStore((s) => s.sales);
  const products = useProductStore((s) => s.products);
  const items = useInventoryStore((s) => s.items);
  const expenses = useExpenseStore((s) => s.expenses);
  const employees = useEmployeeStore((s) => s.employees);

  const countSaleType = (v: string) => sales.filter((s) => s.saleType === v).length;
  const countInventoryCategory = (v: string) => items.filter((i) => i.category === v).length;
  const countEmployeeType = (v: string) => employees.filter((e) => e.employeeType === v).length;
  const countUnit = (v: string) =>
    products.filter((p) => p.unit === v).length +
    items.filter((i) => i.unit === v).length +
    expenses.filter((e) => e.unit === v).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Manage the option lists used across the app. Removing an entry doesn't change records that already use it."
      />

      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <Tag className="w-4 h-4" />
        Option lists
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OptionListManager
          title="Sale Types"
          subtitle="How a sale happened (walk-in, online, …) — used when recording sales"
          useStore={useSaleTypeStore}
          addPlaceholder="e.g. Distributor"
          noun="sale type"
          countUsage={countSaleType}
        />
        <OptionListManager
          title="Employee Types"
          subtitle="Used when creating or editing employees"
          useStore={useEmployeeTypeStore}
          addPlaceholder="e.g. Intern"
          noun="employee type"
          countUsage={countEmployeeType}
        />
        <OptionListManager
          title="Inventory Categories"
          subtitle="Used when creating or editing inventory items"
          useStore={useInventoryCategoryStore}
          addPlaceholder="e.g. Irrigation"
          noun="inventory category"
          countUsage={countInventoryCategory}
        />
        <OptionListManager
          title="Units"
          subtitle="Shared by products and inventory (Kg, piece, box…)"
          useStore={useUnitStore}
          addPlaceholder="e.g. tray"
          noun="unit"
          countUsage={countUnit}
        />
      </div>

      <ProductCategoryManager />

      <CategoryManager />

      <ProductCatalogManager />
    </div>
  );
}
