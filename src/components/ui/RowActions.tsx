import { Pencil, Trash2, Lock } from 'lucide-react';
import { Button } from './Button';

interface RowActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  /** When true, Edit and Delete are disabled (e.g. a locked/paid record). */
  locked?: boolean;
  /** Tooltip shown on the disabled buttons explaining why they're locked. */
  lockedReason?: string;
}

/** Standard Edit / Delete action buttons for a data-table row. */
export function RowActions({ onEdit, onDelete, locked = false, lockedReason }: RowActionsProps) {
  if (locked) {
    return (
      <div className="flex items-center justify-end gap-1" title={lockedReason}>
        <Button
          variant="ghost"
          size="xs"
          icon={<Lock className="w-3.5 h-3.5" />}
          disabled
          aria-label={lockedReason ?? 'Editing locked'}
        >
          Locked
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="xs" icon={<Pencil className="w-3.5 h-3.5" />} onClick={onEdit}>
        Edit
      </Button>
      <Button
        variant="ghost"
        size="xs"
        icon={<Trash2 className="w-3.5 h-3.5" />}
        onClick={onDelete}
        className="text-red-500 hover:text-red-700 hover:bg-red-50"
      >
        Delete
      </Button>
    </div>
  );
}
