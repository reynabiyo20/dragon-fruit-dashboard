import { Pencil, Trash2 } from 'lucide-react';
import { Button } from './Button';

interface RowActionsProps {
  onEdit: () => void;
  onDelete: () => void;
}

/** Standard Edit / Delete action buttons for a data-table row. */
export function RowActions({ onEdit, onDelete }: RowActionsProps) {
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
