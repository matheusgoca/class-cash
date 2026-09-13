// Small parsing helpers shared by every entity validator. Kept separate from
// the CurrencyInput/PhoneInput UI components (src/components/ui/) because
// here we're parsing values coming from a spreadsheet cell (string, number,
// or Date, depending on how the user filled it in Excel/Sheets), not from a
// controlled text input.

/**
 * Accepts "650,00", "650.00", "R$ 650,00", or an already-numeric cell and
 * returns a plain number. Returns undefined for an empty cell.
 */
export function parseCurrencyBR(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return value;
  const cleaned = String(value)
    .replace(/[^\d,.-]/g, '') // strip "R$", spaces, etc.
    .trim();
  if (cleaned === '') return undefined;
  // If both separators are present, the last one is the decimal separator.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (lastComma > -1) {
    normalized = cleaned.replace(',', '.');
  }
  const parsed = parseFloat(normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Accepts a JS Date (from Excel's date cells) or a "DD/MM/AAAA" string. */
export function parseDateBR(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return undefined;
  const [, dd, mm, yyyy] = match;
  const year = yyyy.length === 2 ? Number(`20${yyyy}`) : Number(yyyy);
  const date = new Date(year, Number(mm) - 1, Number(dd));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function parsePercent(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const num = parseCurrencyBR(value);
  return num;
}

export function parseIntSafe(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = parseInt(String(value).replace(/\D/g, ''), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

export function splitEmails(value: unknown): string[] {
  return normalizeText(value)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const STATUS_MAP: Record<string, string> = {
  ativo: 'active',
  ativa: 'active',
  active: 'active',
  inativo: 'inactive',
  inativa: 'inactive',
  inactive: 'inactive',
  suspenso: 'suspended',
  suspended: 'suspended',
  cancelado: 'cancelled',
  cancelled: 'cancelled',
  sim: 'yes',
  não: 'no',
  nao: 'no',
  yes: 'yes',
  no: 'no',
};

/** Normalizes free-typed Portuguese status words ("Ativo", "ativa") to the DB's English enum values. */
export function normalizeEnumWord(value: unknown, fallback: string): string {
  const text = normalizeText(value).toLowerCase();
  if (!text) return fallback;
  return STATUS_MAP[text] ?? text;
}

// Reused so imported classes without an explicit color still get a
// consistent, distinguishable palette rather than all defaulting to the
// same blue.
const CLASS_COLOR_PALETTE = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
];

export function randomClassColor(seed: number): string {
  return CLASS_COLOR_PALETTE[seed % CLASS_COLOR_PALETTE.length];
}
