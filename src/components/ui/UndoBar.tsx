import { Undo2, X } from 'lucide-react';

interface UndoBarProps {
  /** Description of the action that can be reverted, e.g. "Marked 3 sales as paid". */
  message: string;
  /** Revert the last bulk action. */
  onUndo: () => void;
  /** Dismiss the bar without undoing. */
  onDismiss: () => void;
}

/**
 * A slim toolbar shown above a table after a bulk action, offering a one-click
 * undo. Rendered only while an undo snapshot exists (the parent controls
 * visibility by conditionally mounting this). Keyboard- and screen-reader
 * friendly: it's an aria-live region so the outcome is announced.
 */
export function UndoBar({ message, onUndo, onDismiss }: UndoBarProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-primary-200 bg-primary-50"
    >
      <span className="text-sm text-primary-900">{message}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium text-primary-700 rounded-lg hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        >
          <Undo2 className="w-4 h-4" />
          Undo
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 rounded text-primary-500 hover:text-primary-800 hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
