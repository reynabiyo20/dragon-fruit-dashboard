/**
 * Backup & Restore — export/import all app data.
 *
 * Every store persists to localStorage under a `dfd-`-prefixed key (see the
 * Zustand `persist` configs). Rather than maintain a hand-written list of stores
 * (which would drift as stores are added), backup captures EVERY `dfd-` key at
 * export time and restores them wholesale. This is complete and future-proof.
 *
 * Restore replaces the persisted data and requires a reload so every store
 * re-hydrates from the imported values.
 */

/** Prefix shared by all persisted store keys. */
const KEY_PREFIX = 'dfd-';

/** Bumped if the backup envelope format ever changes. */
const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  format: 'dragon-fruit-dashboard-backup';
  version: number;
  exportedAt: string;
  /** Map of localStorage key → raw stored JSON string. */
  data: Record<string, string>;
}

/** Collect all `dfd-` localStorage entries into a backup envelope. */
export function createBackup(): BackupFile {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(KEY_PREFIX)) {
      const value = localStorage.getItem(key);
      if (value !== null) data[key] = value;
    }
  }
  return {
    format: 'dragon-fruit-dashboard-backup',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** Number of store keys currently held in localStorage (for UI display). */
export function backupKeyCount(): number {
  let count = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(KEY_PREFIX)) count += 1;
  }
  return count;
}

/** Trigger a browser download of the backup as a timestamped JSON file. */
export function downloadBackup(): void {
  const backup = createBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `dragon-fruit-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ParsedBackup {
  file: BackupFile;
  /** Number of store keys in the backup. */
  keyCount: number;
}

/**
 * Validate and parse a backup file's text. Throws a descriptive Error when the
 * content isn't a recognizable backup so the UI can surface it.
 */
export function parseBackup(text: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('This file is not a valid backup.');
  }
  const file = parsed as Partial<BackupFile>;
  if (file.format !== 'dragon-fruit-dashboard-backup') {
    throw new Error('This file is not a Dragon Fruit Dashboard backup.');
  }
  if (!file.data || typeof file.data !== 'object') {
    throw new Error('This backup has no data to restore.');
  }
  const keys = Object.keys(file.data).filter((k) => k.startsWith(KEY_PREFIX));
  if (keys.length === 0) {
    throw new Error('This backup contains no recognizable app data.');
  }
  return { file: file as BackupFile, keyCount: keys.length };
}

/**
 * Restore a parsed backup: clears existing `dfd-` keys, writes the backup's
 * entries, and returns. Callers should reload the page afterward so every store
 * re-hydrates from the restored localStorage.
 */
export function restoreBackup(file: BackupFile): void {
  // Remove current app keys first so a restore is a clean replace, not a merge.
  const existing: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(KEY_PREFIX)) existing.push(key);
  }
  existing.forEach((k) => localStorage.removeItem(k));

  // Write only recognized app keys from the backup.
  Object.entries(file.data).forEach(([key, value]) => {
    if (key.startsWith(KEY_PREFIX) && typeof value === 'string') {
      localStorage.setItem(key, value);
    }
  });
}
