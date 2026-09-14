// Parses a 'YYYY-MM-DD' date string as a LOCAL date, never UTC.
// `new Date('YYYY-MM-DD')` is parsed as midnight UTC by the JS spec — in any
// timezone behind UTC (e.g. Brazil, UTC-3) that rolls back to the previous
// day once converted to local time. This bit multiple screens across the
// project independently (StudentForm, ExpenseForm, Reports, DashboardCharts,
// CSV import) before being consolidated here.
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Formats a Date as 'YYYY-MM-DD' using its local fields — the write-side
// counterpart to parseLocalDate. Never toISOString(), which converts to UTC
// first and can shift the date by a day.
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
