import { useState } from 'react';
import { Plus, X, Tag, Pencil, Check, Search } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { SectionCard } from '../../components/ui/SectionCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { InputField } from '../../components/forms/FormField';
import { SimilarEntryHint } from '../../components/forms/SimilarEntryHint';
import {
  useSaleTypeStore,
  useUnitStore,
  useEmployeeTypeStore,
  useEmployeePositionStore,
  useAccountingClassificationStore,
  useExpenseTypeStore,
  useLaborTypeStore,
} from '../../store/optionStores';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import type { OptionListStore } from '../../store/optionListStore';
import { useExpenseCategoryStore, type ExpenseCategoryEntry } from '../../store/expenseCategoryStore';
import { useProductCategoryStore, type ProductCategoryEntry } from '../../store/productCategoryStore';
import { useAssumptionsStore, type LifecycleAssumptions } from '../../store/assumptionsStore';
import { useSaleStore } from '../../store/saleStore';
import { useProductStore } from '../../store/productStore';
import { useInventoryStore } from '../../store/inventoryStore';
import { useExpenseStore } from '../../store/expenseStore';
import { useEmployeeStore } from '../../store/employeeStore';
import { useVendorStore } from '../../store/vendorStore';
import { useListCrud } from '../../hooks/useListCrud';
import { ProductCatalogManager } from './ProductCatalogManager';
import { BackupRestore } from './BackupRestore';
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
  /** Global Settings search — filters the visible chips + hides a non-matching card. */
  search?: string;
}

function OptionListManager({ title, subtitle, useStore, addPlaceholder, noun, countUsage, search = '' }: OptionListManagerProps) {
  // Subscribe to `values` directly so the list re-renders on add/rename/remove
  const allValues = useStore((s) => s.values);
  const add = useStore((s) => s.add);
  const rename = useStore((s) => s.rename);
  const remove = useStore((s) => s.remove);

  const [draft, setDraft] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  // Inline rename: the value being edited + its working draft
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // Apply the global search: match against the card title OR individual values.
  // (Computed AFTER all hooks so the early "hide" return never skips a hook.)
  const q = search.trim().toLowerCase();
  const titleMatches = q === '' || title.toLowerCase().includes(q);
  const values = q === '' || titleMatches ? allValues : allValues.filter((v) => v.toLowerCase().includes(q));
  // Hide the whole card when searching and neither the title nor any value matches.
  if (q !== '' && !titleMatches && values.length === 0) return null;

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
                  className="inline-flex items-center gap-1 py-0.5 pl-1 pr-0.5 rounded-full bg-white border border-primary-300"
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
                    className="p-1 rounded-full text-primary-600 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-40 disabled:cursor-not-allowed"
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
                    className="p-0.5 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-400"
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
          <p className="text-xs text-gold-600">"{editDraft.trim()}" already exists as a {noun} — pick a different name.</p>
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
  | { kind: 'renameSubcategory'; entry: ExpenseCategoryEntry } // rename one subcategory row
  | { kind: 'editBookkeeping'; entry: ExpenseCategoryEntry };   // set classification + type for a row

function CategoryManager({ search = '' }: { search?: string }) {
  const { entries, categories, subcategoriesFor, addEntry, updateEntry, renameCategory, deleteEntry, isQuantifiable, setQuantifiable, setBookkeeping } =
    useExpenseCategoryStore();
  const expenses = useExpenseStore((s) => s.expenses);
  const vendors = useVendorStore((s) => s.vendors);
  // Same editable option lists the Expense form uses, so a category's default
  // classification/type is chosen from (and can extend) the exact same choices.
  const acOptions = useAccountingClassificationStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addAccountingClassification = useAccountingClassificationStore((s) => s.add);
  const expenseTypeOptions = useExpenseTypeStore((s) => s.values).map((v) => ({ value: v, label: v }));
  const addExpenseType = useExpenseTypeStore((s) => s.add);

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
  const [bk, setBk] = useState<{ accountingClassification: string; expenseType: string }>({
    accountingClassification: '',
    expenseType: '',
  });
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

  const openEditBookkeeping = (entry: ExpenseCategoryEntry) => {
    setMode({ kind: 'editBookkeeping', entry });
    setForm({ category: entry.category, subcategory: entry.subcategory });
    setBk({
      accountingClassification: entry.accountingClassification ?? '',
      expenseType: entry.expenseType ?? '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const norm = (s: string) => s.trim().toLowerCase();
  const handleSave = () => {
    // Bookkeeping edit doesn't touch the category name — just the classification
    // + type for this row — so handle it before the name-required guard below.
    if (mode.kind === 'editBookkeeping') {
      setBookkeeping(mode.entry.id, bk.accountingClassification.trim(), bk.expenseType.trim());
      closeModal();
      return;
    }
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
          : mode.kind === 'editBookkeeping' ? 'Bookkeeping Classification'
            : 'Rename Subcategory';

  // Group entries by category for the chip display
  // Apply the global search: keep a category when its name matches, else keep
  // only its matching subcategories; drop a category with no match at all.
  const q = search.trim().toLowerCase();
  const grouped = categories()
    .map((cat) => {
      const allSubs = entries.filter((e) => e.category === cat && e.subcategory !== '');
      if (q === '') return { category: cat, subs: allSubs };
      const catMatches = cat.toLowerCase().includes(q);
      const subs = catMatches ? allSubs : allSubs.filter((e) => e.subcategory.toLowerCase().includes(q));
      return { category: cat, subs, _hidden: !catMatches && subs.length === 0 };
    })
    .filter((g) => !('_hidden' in g) || !g._hidden);

  return (
    <SectionCard
      title="Vendor & Expense Categories"
      subtitle={`${entries.length} entries across ${categories().length} categories · "Quantifiable" captures qty × unit price · the tag icon sets the bookkeeping classification & type`}
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
            // Row whose bookkeeping the header pencil edits: the top-level row if
            // present, else the first subcategory row (so single-row categories
            // like Electricity are still editable from the header).
            const headerEntry =
              topLevel ?? subs[0] ?? entries.find((e) => e.category === category);
            // Distinct classification/type across this category's rows — shown as
            // a compact summary chip on the card.
            const bkClasses = [...new Set(entries.filter((e) => e.category === category && e.accountingClassification).map((e) => e.accountingClassification as string))];
            const bkTypes = [...new Set(entries.filter((e) => e.category === category && e.expenseType).map((e) => e.expenseType as string))];
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
                      className="p-1 rounded-md text-gray-400 hover:text-primary-700 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-400"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openRenameCategory(category)}
                      aria-label={`Rename category ${category}`}
                      title="Rename category"
                      className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-400"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {headerEntry && (
                      <button
                        type="button"
                        onClick={() => openEditBookkeeping(headerEntry)}
                        aria-label={`Set bookkeeping classification for ${category}`}
                        title="Bookkeeping classification & type"
                        className="p-1 rounded-md text-gray-400 hover:text-primary-700 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-400"
                      >
                        <Tag className="w-3.5 h-3.5" />
                      </button>
                    )}
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
                    className="w-3.5 h-3.5 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  Quantifiable (qty × price)
                </label>

                {/* Bookkeeping default(s) synced from the sheet: accounting
                    classification + cost behavior. Shows "Mixed" when a
                    category's subcategories differ. */}
                {(bkClasses.length > 0 || bkTypes.length > 0) && (
                  <div className="flex flex-wrap gap-1 mb-2 text-[11px]">
                    {bkClasses.length > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {bkClasses.length === 1 ? bkClasses[0] : 'Mixed classification'}
                      </span>
                    )}
                    {bkTypes.length > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {bkTypes.length === 1 ? bkTypes[0] : 'Mixed type'}
                      </span>
                    )}
                  </div>
                )}

                {subs.length === 0 ? (
                  <p className="text-xs text-gray-400">No subcategories</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {subs.map((e) => (
                      <span
                        key={e.id}
                        title={[e.accountingClassification, e.expenseType].filter(Boolean).join(' · ') || undefined}
                        className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-full text-xs bg-primary-50 text-primary-700"
                      >
                        {e.subcategory}
                        <button
                          type="button"
                          onClick={() => openEditBookkeeping(e)}
                          aria-label={`Set bookkeeping for ${e.subcategory}`}
                          title="Bookkeeping classification & type"
                          className="p-0.5 rounded-full text-primary-400 hover:text-primary-700 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-400"
                        >
                          <Tag className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openRenameSubcategory(e)}
                          aria-label={`Rename ${e.subcategory}`}
                          className="p-0.5 rounded-full text-primary-400 hover:text-primary-700 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-400"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => crud.requestDelete(e)}
                          aria-label={`Remove ${e.subcategory}`}
                          className="p-0.5 rounded-full text-primary-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
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
        {mode.kind === 'editBookkeeping' ? (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              Bookkeeping default for{' '}
              <span className="font-medium text-gray-800">
                {mode.entry.category}
                {mode.entry.subcategory ? ` – ${mode.entry.subcategory}` : ''}
              </span>
              . These prefill the Expense form when this item is chosen.
            </p>
            <CreatableSelect
              label="Accounting Classification"
              value={bk.accountingClassification}
              options={acOptions}
              onChange={(v) => setBk((b) => ({ ...b, accountingClassification: v }))}
              onCreate={(v) => { addAccountingClassification(v); setBk((b) => ({ ...b, accountingClassification: v })); }}
              placeholder="Optional — e.g. Operating Expense (OpEx)"
              createLabel="Add new classification…"
              newFieldLabel="New accounting classification"
            />
            <CreatableSelect
              label="Expense Type"
              value={bk.expenseType}
              options={expenseTypeOptions}
              onChange={(v) => setBk((b) => ({ ...b, expenseType: v }))}
              onCreate={(v) => { addExpenseType(v); setBk((b) => ({ ...b, expenseType: v })); }}
              placeholder="Optional — e.g. Fixed"
              createLabel="Add new expense type…"
              newFieldLabel="New expense type"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" type="button" onClick={closeModal}>Cancel</Button>
              <Button onClick={handleSave}>Save Changes</Button>
            </div>
          </div>
        ) : (
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
        )}
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

function ProductCategoryManager({ search = '' }: { search?: string }) {
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

  const q = search.trim().toLowerCase();
  const grouped = categories()
    .map((category) => {
      const allSubs = entries.filter((e) => e.category === category && e.subcategory !== '');
      if (q === '') return { category, subs: allSubs };
      const catMatches = category.toLowerCase().includes(q);
      const subs = catMatches ? allSubs : allSubs.filter((e) => e.subcategory.toLowerCase().includes(q));
      return { category, subs, _hidden: !catMatches && subs.length === 0 };
    })
    .filter((g) => !('_hidden' in g) || !g._hidden);

  return (
    <SectionCard
      title="Product & Inventory Categories"
      subtitle={`${entries.length} entries across ${categories().length} categories · shared by Products and Inventory · "Cuttings" orders under 25 get the small-order surcharge in Sales`}
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
                    <button type="button" onClick={() => openAddSubcategory(category)} aria-label={`Add subcategory to ${category}`} title="Add subcategory" className="p-1 rounded-md text-gray-400 hover:text-primary-700 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-400">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => openRenameCategory(category)} aria-label={`Rename category ${category}`} title="Rename category" className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-400">
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
                      <span key={e.id} className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-full text-xs bg-berry-50 text-berry-700">
                        {e.subcategory}
                        <button type="button" onClick={() => openRenameSubcategory(e)} aria-label={`Rename ${e.subcategory}`} className="p-0.5 rounded-full text-berry-400 hover:text-berry-700 hover:bg-berry-100 focus:outline-none focus:ring-2 focus:ring-berry-400">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button type="button" onClick={() => crud.requestDelete(e)} aria-label={`Remove ${e.subcategory}`} className="p-0.5 rounded-full text-berry-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400">
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

/* ── Lifecycle assumptions (cuttings → fruit growth model) ────────────────────── */

interface AssumptionFieldDef {
  key: keyof LifecycleAssumptions;
  label: string;
  hint: string;
  step?: string;
}

/** Whether a field accepts zero as a valid value (most yields/timelines don't). */
type AssumptionFieldDefExt = AssumptionFieldDef & { allowZero?: boolean };

/** Fruit growth-model inputs — drive the wholesale supply forecast. */
const FRUIT_ASSUMPTION_FIELDS: AssumptionFieldDefExt[] = [
  { key: 'yieldFruitsPerMaturePlant', label: 'Fruits / mature plant (per season)', hint: 'Seasonal yield of an established fruiting plant — drives the Farm pool forecast' },
  { key: 'yieldFruitsGrafted', label: 'First-harvest fruits / grafted cutting', hint: 'Yield of a newly-deployed grafted cutting' },
  { key: 'yieldFruitsUnrooted', label: 'First-harvest fruits / unrooted cutting', hint: 'Yield of a newly-deployed unrooted cutting' },
  { key: 'harvestDaysGrafted', label: 'Days to first harvest — grafted', hint: 'Days from planting/delivery to first fruit (grafted)' },
  { key: 'harvestDaysUnrooted', label: 'Days to first harvest — unrooted', hint: 'Days from planting/delivery to first fruit (unrooted)' },
  { key: 'fruitWeightKg', label: 'Average fruit weight (kg)', hint: 'Weight of one dragon fruit — converts pieces to kg', step: '0.01' },
];

/** Cuttings growth-model inputs — drive the estimated ready/plant dates. */
const CUTTING_ASSUMPTION_FIELDS: AssumptionFieldDefExt[] = [
  { key: 'callusingDays', label: 'Callusing hold (days)', hint: 'Heal window after harvesting internal cuttings, before the growth countdown starts' },
  { key: 'cuttingReadyBaseWeeks', label: 'Base grow-out weeks', hint: 'Weeks until a cutting is ready, before the cutting-type modifier' },
  { key: 'cuttingUnrootedModifierWeeks', label: 'Extra weeks — unrooted', hint: 'Added on top of the base for unrooted cuttings (grafted adds none)', allowZero: true },
  { key: 'rootWeeksDefault', label: 'Default rooting weeks', hint: 'Weeks a grafted cutting needs to root before it can sell' },
];

interface AssumptionFieldsEditorProps {
  fields: AssumptionFieldDefExt[];
  values: LifecycleAssumptions;
  setValues: (patch: Partial<LifecycleAssumptions>) => void;
}

/**
 * The shared number-grid editor used by both the fruit and cuttings assumption
 * cards. Local drafts keep a half-typed number from resetting mid-edit; the
 * value is committed on blur.
 */
function AssumptionFieldsEditor({ fields, values, setValues }: AssumptionFieldsEditorProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const commit = (field: AssumptionFieldDefExt, raw: string) => {
    const n = Number(raw);
    const min = field.allowZero ? 0 : 1e-9;
    if (Number.isFinite(n) && n >= min) setValues({ [field.key]: n } as Partial<LifecycleAssumptions>);
    setDrafts((d) => {
      const next = { ...d };
      delete next[field.key];
      return next;
    });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {fields.map((f) => (
        <InputField
          key={f.key}
          label={f.label}
          type="number"
          step={f.step ?? '1'}
          min={f.allowZero ? 0 : undefined}
          hint={f.hint}
          value={drafts[f.key] ?? String(values[f.key])}
          onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
          onBlur={(e) => commit(f, e.target.value)}
        />
      ))}
    </div>
  );
}

/**
 * Editor for the user-manageable lifecycle assumptions, split into two cards:
 * the fruit growth model (yield/timeline the wholesale forecast reads) and the
 * cuttings growth model (callusing + grow-out weeks that drive ready dates).
 * Changing a value re-projects live — no saved records are rewritten.
 */
function AssumptionsManager() {
  const values = useAssumptionsStore((s) => s.values);
  const setValues = useAssumptionsStore((s) => s.set);
  const reset = useAssumptionsStore((s) => s.reset);

  return (
    <>
      <SectionCard
        title="Fruit Lifecycle Assumptions"
        subtitle="Yield & timeline used by the wholesale supply forecast — tune to your orchard"
        actions={
          <Button size="sm" variant="outline" onClick={reset}>Reset to defaults</Button>
        }
      >
        <AssumptionFieldsEditor fields={FRUIT_ASSUMPTION_FIELDS} values={values} setValues={setValues} />
        <p className="mt-3 text-xs text-gray-400">
          These are projection inputs — changing them re-estimates the forecast but never rewrites saved records.
        </p>
      </SectionCard>

      <SectionCard
        title="Cuttings Lifecycle Assumptions"
        subtitle="Callusing hold & grow-out timing used to estimate a cutting batch's ready and planting dates"
        actions={
          <Button size="sm" variant="outline" onClick={reset}>Reset to defaults</Button>
        }
      >
        <AssumptionFieldsEditor fields={CUTTING_ASSUMPTION_FIELDS} values={values} setValues={setValues} />
        <p className="mt-3 text-xs text-gray-400">
          These are projection inputs — changing them re-estimates future ready dates but never rewrites saved batches.
        </p>
      </SectionCard>
    </>
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
  const countEmployeeType = (v: string) => employees.filter((e) => e.employeeType === v).length;
  const countPosition = (v: string) => employees.filter((e) => e.position === v).length;
  const countLaborType = (v: string) => employees.filter((e) => e.laborType === v).length;
  const countUnit = (v: string) =>
    products.filter((p) => p.unit === v).length +
    items.filter((i) => i.unit === v).length +
    expenses.filter((e) => e.unit === v).length;
  // Accounting classification & expense type are shared by expenses AND employees
  // (labor bookkeeping), so their usage spans both stores. Counting both makes the
  // "still in use" note before deletion accurate across the whole app.
  const countAccountingClassification = (v: string) =>
    expenses.filter((e) => e.accountingClassification === v).length +
    employees.filter((e) => e.accountingClassification === v).length;
  const countExpenseType = (v: string) => expenses.filter((e) => e.expenseType === v).length;

  // Global search — filters every manager below (option lists + category
  // taxonomies) by matching against list titles, values, categories and
  // subcategories. Empty string shows everything.
  const [search, setSearch] = useState('');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Manage the option lists used across the app. Removing an entry doesn't change records that already use it."
      />

      <BackupRestore />

      {/* Global search across all option lists & category taxonomies */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search categories, subcategories, types, units…"
          aria-label="Search settings"
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      </div>

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
          search={search}
        />
        <OptionListManager
          title="Employee Types"
          subtitle="Used when creating or editing employees"
          useStore={useEmployeeTypeStore}
          addPlaceholder="e.g. Intern"
          noun="employee type"
          countUsage={countEmployeeType}
          search={search}
        />
        <OptionListManager
          title="Positions"
          subtitle="Employee roles — used when creating or editing employees"
          useStore={useEmployeePositionStore}
          addPlaceholder="e.g. Harvester"
          noun="position"
          countUsage={countPosition}
          search={search}
        />
        <OptionListManager
          title="Labor Types"
          subtitle="Direct / Indirect / Selling / Administrative — sets how a role's wage books (COGS vs OpEx)"
          useStore={useLaborTypeStore}
          addPlaceholder="e.g. Direct Labor"
          noun="labor type"
          countUsage={countLaborType}
          search={search}
        />
        <OptionListManager
          title="Accounting Classifications"
          subtitle="CapEx / OpEx / COGS … — shared by the Expense and Employee forms and category bookkeeping"
          useStore={useAccountingClassificationStore}
          addPlaceholder="e.g. Operating Expense (OpEx)"
          noun="accounting classification"
          countUsage={countAccountingClassification}
          search={search}
        />
        <OptionListManager
          title="Expense Types"
          subtitle="Cost behavior (Fixed / Variable / Semi-Variable) — shared by the Expense form and category bookkeeping"
          useStore={useExpenseTypeStore}
          addPlaceholder="e.g. Fixed"
          noun="expense type"
          countUsage={countExpenseType}
          search={search}
        />
        <OptionListManager
          title="Units"
          subtitle="Shared by products and inventory (Kg, piece, box…)"
          useStore={useUnitStore}
          addPlaceholder="e.g. tray"
          noun="unit"
          countUsage={countUnit}
          search={search}
        />
      </div>

      <ProductCategoryManager search={search} />

      <CategoryManager search={search} />

      <AssumptionsManager />

      <ProductCatalogManager />
    </div>
  );
}
