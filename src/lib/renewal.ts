// src/lib/renewal.ts
// Regras puras da rematrícula (S4c). Sem acesso a rede: tudo testável no Vitest.
import { parseLocalDate, toDateStr } from '@/lib/dateUtils';
import { buildTuitionRows } from '@/lib/tuitionRows';

export type DecisionStatus = 'contacted' | 'will_renew' | 'will_not_renew';
export type DecisionReason = 'moved_city' | 'price' | 'changed_school' | 'other';
export type RenewalState = 'none' | 'renewed' | DecisionStatus;

export const STATE_LABELS: Record<RenewalState, string> = {
  none: 'Sem resposta',
  contacted: 'Contatado',
  will_renew: 'Vai renovar',
  will_not_renew: 'Não vai renovar',
  renewed: 'Renovado',
};

export const REASON_LABELS: Record<DecisionReason, string> = {
  moved_city: 'Mudança de cidade',
  price: 'Preço',
  changed_school: 'Mudou de escola',
  other: 'Outro',
};

export interface RenewalContract {
  id: string;
  student_id: string;
  student_name: string;
  class_id: string | null;
  class_name: string | null;
  start_date: string;
  end_date: string;
  monthly_amount: number;
  discount: number;
  due_day: number;
  period: string;
}

export interface DecisionRow {
  contract_id: string;
  status: DecisionStatus;
  reason: DecisionReason | null;
  note: string | null;
}

export interface RenewalClass {
  id: string;
  name: string;
  max_capacity: number | null;
}

export interface RpcTuition {
  due_date: string;
  amount: number;
  status: 'pending' | 'overdue';
  description: string;
}

export interface RpcItem {
  source_contract_id: string;
  class_id: string | null;
  monthly_amount: number;
  start_date: string;
  end_date: string;
  tuitions: RpcTuition[];
}

export interface PlanRow {
  contractId: string;
  studentName: string;
  fromClassId: string | null;
  toClassId: string | null;
  currentMonthly: number;
  newMonthly: number;
  monthlyEdited: boolean;
  classChanged: boolean;
  start: string;
  end: string;
  tuitionCount: number;
  error: 'INVALID_AMOUNT' | 'AMOUNT_TOO_HIGH' | 'NO_TUITIONS' | null;
}

export interface PlanOptions {
  pct: number;
  classMap: Record<string, string | null>;
  overrides: Record<string, { classId?: string | null; monthly?: number }>;
  today: Date;
}

/** Chave de turma de origem; "sem turma" usa a string vazia. */
export const classKey = (id: string | null): string => id ?? '';

/**
 * Teto da mensalidade de um contrato renovado (R$). A validação "de verdade" é a prévia do lote (AMOUNT_TOO_HIGH);
 * o RPC renew_contracts só confirma. MANTER IGUAL a c_max_monthly em
 * supabase/migrations/20261125120000_renew_contracts_hardening.sql.
 */
export const MAX_MONTHLY_AMOUNT = 30000;

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const applyAdjustment = (value: number, pct: number): number => round2(value * (1 + pct / 100));

/** Espelha a coluna gerada contracts.final_amount; no banco ela vale round(..., 2) desde a migration 20261125130000 (item I), por isso quem grava mensalidade deve aplicar round2 ao resultado. */
export const finalAmountOf = (monthly: number, discount: number | null | undefined): number =>
  monthly * (1 - (discount ?? 0) / 100);

/** Mesma regra de ContractForm.handleRenew: começa no dia seguinte, termina no último dia do 12º mês. */
export function nextTerm(sourceEndDate: string): { start: string; end: string } {
  const end0 = parseLocalDate(sourceEndDate);
  const start = new Date(end0.getFullYear(), end0.getMonth(), end0.getDate() + 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 12, 0);
  return { start: toDateStr(start), end: toDateStr(end) };
}

export function buildRenewalPlan(sources: RenewalContract[], opts: PlanOptions) {
  const rows: PlanRow[] = [];
  const items: RpcItem[] = [];

  for (const s of sources) {
    const ov = opts.overrides[s.id] ?? {};
    const key = classKey(s.class_id);
    const toClassId: string | null =
      ov.classId !== undefined ? ov.classId : key in opts.classMap ? opts.classMap[key] : s.class_id;
    const monthlyEdited = ov.monthly !== undefined;
    const newMonthly = round2(monthlyEdited ? (ov.monthly as number) : applyAdjustment(s.monthly_amount, opts.pct));
    const { start, end } = nextTerm(s.end_date);

    let error: PlanRow['error'] = null;
    let tuitions: RpcTuition[] = [];
    if (!(newMonthly > 0)) {
      error = 'INVALID_AMOUNT';
    } else if (newMonthly > MAX_MONTHLY_AMOUNT) {
      error = 'AMOUNT_TOO_HIGH';
    } else {
      tuitions = buildTuitionRows(
        { startDate: start, endDate: end, dueDay: s.due_day, finalAmount: round2(finalAmountOf(newMonthly, s.discount)) },
        opts.today,
      );
      if (tuitions.length === 0) error = 'NO_TUITIONS';
    }

    rows.push({
      contractId: s.id,
      studentName: s.student_name,
      fromClassId: s.class_id,
      toClassId,
      currentMonthly: s.monthly_amount,
      newMonthly,
      monthlyEdited,
      classChanged: toClassId !== s.class_id,
      start,
      end,
      tuitionCount: tuitions.length,
      error,
    });
    if (!error) {
      items.push({
        source_contract_id: s.id,
        class_id: toClassId, // null ou uuid; nunca string vazia
        monthly_amount: newMonthly,
        start_date: start,
        end_date: end,
        tuitions: tuitions.map((t) => ({ due_date: t.due_date, amount: t.amount, status: t.status, description: t.description })),
      });
    }
  }

  const valid = rows.filter((r) => !r.error);
  return {
    rows,
    items,
    totals: {
      contracts: valid.length,
      tuitions: valid.reduce((n, r) => n + r.tuitionCount, 0),
      monthlyTotal: round2(valid.reduce((n, r) => n + r.newMonthly, 0)),
    },
  };
}

/** Turmas de destino que passariam da capacidade (contratos ativos − quem sai + quem chega). */
export function capacityWarnings(rows: PlanRow[], classes: RenewalClass[], activeByClass: Record<string, number>) {
  const valid = rows.filter((r) => !r.error);
  const out: { classId: string; className: string; projected: number; max: number }[] = [];
  for (const c of classes) {
    if (c.max_capacity == null) continue;
    const leaving = valid.filter((r) => r.fromClassId === c.id && r.toClassId !== c.id).length;
    const arriving = valid.filter((r) => r.toClassId === c.id && r.fromClassId !== c.id).length;
    const projected = (activeByClass[c.id] ?? 0) - leaving + arriving;
    if (arriving > 0 && projected > c.max_capacity) {
      out.push({ classId: c.id, className: c.name, projected, max: c.max_capacity });
    }
  }
  return out;
}

export function renewalState(
  contractId: string,
  decisions: Record<string, DecisionRow>,
  renewedIds: Set<string>,
): RenewalState {
  if (renewedIds.has(contractId)) return 'renewed';
  return decisions[contractId]?.status ?? 'none';
}

export function summarizeWindow(
  contracts: RenewalContract[],
  decisions: Record<string, DecisionRow>,
  renewedIds: Set<string>,
): Record<RenewalState, number> {
  const out: Record<RenewalState, number> = { none: 0, contacted: 0, will_renew: 0, will_not_renew: 0, renewed: 0 };
  for (const c of contracts) out[renewalState(c.id, decisions, renewedIds)] += 1;
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
