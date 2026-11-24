// src/lib/tuitionRows.ts
// Regra ÚNICA de geração das mensalidades de um contrato (extraída de generateTuitions.ts).
// Usada pela geração individual e pela renovação em lote (prévia + RPC): nunca reimplementar.
import { parseLocalDate, toDateStr } from '@/lib/dateUtils';

export interface TuitionRowInput {
  startDate: string; // 'YYYY-MM-DD'
  endDate: string;   // 'YYYY-MM-DD'
  dueDay: number;    // dia do mês do vencimento
  finalAmount: number;
}

export interface BuiltTuitionRow {
  due_date: string;
  amount: number;
  status: 'pending' | 'overdue';
  description: string;
}

/**
 * Monta as mensalidades de um contrato, mês a mês.
 * @param today meia-noite local de "hoje" (vencida = vencimento anterior a hoje)
 * @param existingDates vencimentos que já existem; são pulados (idempotência)
 */
export function buildTuitionRows(
  input: TuitionRowInput,
  today: Date,
  existingDates: Set<string> = new Set(),
): BuiltTuitionRow[] {
  const start = parseLocalDate(input.startDate);
  const end = parseLocalDate(input.endDate);
  const rows: BuiltTuitionRow[] = [];

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (
    cursor.getFullYear() < end.getFullYear() ||
    (cursor.getFullYear() === end.getFullYear() && cursor.getMonth() <= end.getMonth())
  ) {
    // Vencimento no último dia do mês quando o dia não existe (ex.: dia 31 em fevereiro).
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const day = Math.min(input.dueDay, lastDay);
    const dueDate = new Date(cursor.getFullYear(), cursor.getMonth(), day);

    // Só vale o mês cujo vencimento cai dentro do contrato (um contrato que começa dia 20 com
    // vencimento dia 5 não ganha uma mensalidade vencida antes da matrícula).
    if (dueDate >= start && dueDate <= end) {
      const dueDateStr = toDateStr(dueDate);
      if (!existingDates.has(dueDateStr)) {
        rows.push({
          due_date: dueDateStr,
          amount: input.finalAmount,
          status: dueDate < today ? 'overdue' : 'pending',
          description: `Mensalidade ${cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
        });
      }
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return rows;
}
