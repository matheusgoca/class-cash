export type TuitionStatusFilter = 'all' | 'pending' | 'overdue' | 'paid';

const VALID: TuitionStatusFilter[] = ['pending', 'overdue', 'paid'];

/** Valor inicial do filtro de status vindo de `?status=` (ex.: botões das notificações). */
export function parseStatusParam(raw: string | null): TuitionStatusFilter {
  return VALID.includes(raw as TuitionStatusFilter) ? (raw as TuitionStatusFilter) : 'all';
}
