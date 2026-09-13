import * as XLSX from 'xlsx';

/**
 * Reads an uploaded .xlsx/.csv file and returns each data row as an object
 * keyed by its (lower-cased, trimmed) header — matching the column names
 * used by templates.ts and validate.ts. Prefers a sheet literally named
 * "Dados" (that's what our templates use); falls back to the first sheet so
 * a user who renames the tab, or uploads a plain CSV, still works.
 *
 * Rows that are entirely blank are dropped (e.g. the example row left as-is
 * with only whitespace, or trailing empty rows Excel sometimes keeps).
 */
export async function parseImportFile(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  const sheetName = workbook.SheetNames.includes('Dados') ? 'Dados' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (rows.length === 0) return [];

  const headers = (rows[0] as unknown[]).map((h) => String(h ?? '').trim().toLowerCase());

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((header, i) => {
        if (header) obj[header] = String(row[i] ?? '').trim();
      });
      return obj;
    });
}
