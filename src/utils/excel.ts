/**
 * Excel Import / Export Utility
 *
 * TODO: Full implementation pending.
 *
 * This module uses the `xlsx` library (already installed) to handle
 * importing and exporting data from/to Excel (.xlsx) files.
 *
 * Planned functions:
 *   - exportToExcel(data, sheetName, fileName)  — export any array of objects to .xlsx
 *   - importFromExcel(file, sheetName)           — read a sheet and return array of rows
 *   - exportAllModules()                         — export all modules to a single workbook
 *                                                  matching the BookKeeping_DragonFruitDepot.xlsx layout
 *   - importAllModules(file)                     — import from a matching workbook
 *
 * Usage example (when implemented):
 *   import { exportToExcel } from '@/utils/excel';
 *   exportToExcel(sales, 'SALES TEMPLATE', 'DragonFruitDepot_Sales.xlsx');
 */

import * as XLSX from 'xlsx';

/** Export a single array of objects to an .xlsx file and trigger browser download */
export function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  sheetName: string,
  fileName: string
): void {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

/** Read the first sheet (or named sheet) from an uploaded File and return row objects */
export async function importFromExcel<T = Record<string, unknown>>(
  file: File,
  sheetName?: string
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const targetSheet = sheetName ?? workbook.SheetNames[0];
        const worksheet = workbook.Sheets[targetSheet];
        if (!worksheet) {
          reject(new Error(`Sheet "${targetSheet}" not found in file`));
          return;
        }
        const rows = XLSX.utils.sheet_to_json<T>(worksheet, { defval: '' });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// TODO: Add exportAllModules() that exports all 11 modules to one workbook
// TODO: Add importAllModules() that reads each named sheet and populates all stores
