import { useState, useCallback } from 'react';

/**
 * Shared state + handlers for a list page's create/edit/delete modal flow.
 *
 * Every entity list page (customers, vendors, products, …) repeats the same
 * modal/editing/deleteTarget scaffold. This hook centralizes it.
 *
 * @example
 * const crud = useListCrud<Customer>();
 * // open add:    crud.openAdd()
 * // open edit:   crud.openEdit(row)
 * // in <Modal open={crud.modalOpen} …>  {crud.editing ? 'Edit' : 'Add'}
 * // delete flow: crud.requestDelete(row) → <ConfirmDialog open={!!crud.deleteTarget} …>
 */
export function useListCrud<T>() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);

  const openAdd = useCallback(() => {
    setEditing(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((row: T) => {
    setEditing(row);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditing(null);
  }, []);

  const requestDelete = useCallback((row: T) => setDeleteTarget(row), []);
  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  /** Run a delete action against the current target, then clear it */
  const confirmDelete = useCallback(
    (deleteFn: (row: T) => void) => {
      setDeleteTarget((current) => {
        if (current) deleteFn(current);
        return null;
      });
    },
    []
  );

  return {
    modalOpen,
    editing,
    deleteTarget,
    openAdd,
    openEdit,
    closeModal,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}
