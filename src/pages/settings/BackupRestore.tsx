/**
 * Backup & Restore — export all app data to a JSON file, or restore from one.
 *
 * All data lives in the browser (localStorage), so this is the only way to move
 * data between devices/browsers or guard against a cache wipe. Restore fully
 * replaces current data and reloads the app.
 */
import { useRef, useState } from 'react';
import { Download, Upload, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { SectionCard } from '../../components/ui/SectionCard';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import {
  downloadBackup, backupKeyCount, parseBackup, restoreBackup, type ParsedBackup,
} from '../../utils/backup';

export function BackupRestore() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const keyCount = backupKeyCount();

  const handleExport = () => {
    try {
      downloadBackup();
      toast.success('Backup downloaded');
    } catch {
      toast.error('Could not create the backup file.');
    }
  };

  // Read the chosen file, validate it, and open the confirm dialog.
  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so choosing the same file again re-triggers onChange.
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseBackup(String(reader.result ?? ''));
        setPending(parsed);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not read that backup.');
      }
    };
    reader.onerror = () => toast.error('Could not read that file.');
    reader.readAsText(file);
  };

  const confirmRestore = () => {
    if (!pending) return;
    try {
      restoreBackup(pending.file);
      toast.success('Backup restored — reloading…');
      // Reload so every store re-hydrates from the restored localStorage.
      setTimeout(() => window.location.reload(), 600);
    } catch {
      toast.error('Restore failed.');
    } finally {
      setPending(null);
    }
  };

  return (
    <SectionCard
      title="Backup & Restore"
      subtitle="All data is stored in this browser. Export regularly to keep a safe copy."
    >
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Button icon={<Download className="w-4 h-4" />} onClick={handleExport}>
            Export Backup
          </Button>
          <Button
            variant="outline"
            icon={<Upload className="w-4 h-4" />}
            onClick={() => fileInputRef.current?.click()}
          >
            Restore from File
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChosen}
            className="hidden"
            aria-hidden="true"
          />
          <span className="text-xs text-gray-400">
            {keyCount} data {keyCount === 1 ? 'store' : 'stores'} on this device
          </span>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-gold-200 bg-gold-50 p-3 text-xs text-gold-800">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Restoring <span className="font-semibold">replaces all current data</span> with the backup's
            contents and reloads the app. Export your current data first if you might need it.
          </span>
        </div>
      </div>

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={confirmRestore}
        title="Restore this backup?"
        message={
          pending
            ? `This will replace all current data with the backup (${pending.keyCount} data ${
                pending.keyCount === 1 ? 'store' : 'stores'
              }, exported ${new Date(pending.file.exportedAt).toLocaleString()}). This cannot be undone.`
            : ''
        }
        confirmLabel="Restore & Reload"
      />
    </SectionCard>
  );
}
