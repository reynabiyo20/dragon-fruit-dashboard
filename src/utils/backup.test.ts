import { describe, it, expect, beforeEach } from 'vitest';
import { createBackup, backupKeyCount, parseBackup, restoreBackup } from './backup';

describe('backup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('createBackup', () => {
    it('captures only dfd- prefixed keys', () => {
      localStorage.setItem('dfd-sales', '{"state":{"sales":[]}}');
      localStorage.setItem('dfd-farm', '{"state":{"sections":[]}}');
      localStorage.setItem('unrelated', 'keep-out');

      const backup = createBackup();
      expect(backup.format).toBe('dragon-fruit-dashboard-backup');
      expect(Object.keys(backup.data).sort()).toEqual(['dfd-farm', 'dfd-sales']);
      expect(backup.data).not.toHaveProperty('unrelated');
      expect(typeof backup.exportedAt).toBe('string');
    });
  });

  describe('backupKeyCount', () => {
    it('counts only dfd- keys', () => {
      localStorage.setItem('dfd-a', '1');
      localStorage.setItem('dfd-b', '2');
      localStorage.setItem('other', '3');
      expect(backupKeyCount()).toBe(2);
    });
  });

  describe('parseBackup', () => {
    it('rejects invalid JSON', () => {
      expect(() => parseBackup('not json')).toThrow(/not valid JSON/i);
    });
    it('rejects a non-backup object', () => {
      expect(() => parseBackup(JSON.stringify({ hello: 'world' }))).toThrow(/not a Dragon Fruit Dashboard backup/i);
    });
    it('rejects a backup with no recognizable keys', () => {
      const file = { format: 'dragon-fruit-dashboard-backup', version: 1, exportedAt: '', data: { junk: 'x' } };
      expect(() => parseBackup(JSON.stringify(file))).toThrow(/no recognizable app data/i);
    });
    it('accepts a valid backup and reports its key count', () => {
      const file = createBackupFixture();
      const parsed = parseBackup(JSON.stringify(file));
      expect(parsed.keyCount).toBe(2);
      expect(parsed.file.format).toBe('dragon-fruit-dashboard-backup');
    });
  });

  describe('restoreBackup', () => {
    it('replaces existing dfd- data and preserves unrelated keys', () => {
      // Pre-existing app data that should be wiped, plus an unrelated key.
      localStorage.setItem('dfd-stale', 'old');
      localStorage.setItem('theme', 'dark');

      restoreBackup(createBackupFixture());

      // Stale app key removed, backup keys written, unrelated key untouched.
      expect(localStorage.getItem('dfd-stale')).toBeNull();
      expect(localStorage.getItem('dfd-sales')).toBe('{"state":{"sales":[1]}}');
      expect(localStorage.getItem('dfd-farm')).toBe('{"state":{"sections":[2]}}');
      expect(localStorage.getItem('theme')).toBe('dark');
    });

    it('round-trips: create → restore reproduces the same data', () => {
      localStorage.setItem('dfd-sales', '{"state":{"sales":[42]}}');
      const backup = createBackup();
      localStorage.setItem('dfd-sales', '{"state":{"sales":[]}}'); // mutate
      restoreBackup(backup);
      expect(localStorage.getItem('dfd-sales')).toBe('{"state":{"sales":[42]}}');
    });
  });
});

function createBackupFixture() {
  return {
    format: 'dragon-fruit-dashboard-backup' as const,
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      'dfd-sales': '{"state":{"sales":[1]}}',
      'dfd-farm': '{"state":{"sections":[2]}}',
    },
  };
}
