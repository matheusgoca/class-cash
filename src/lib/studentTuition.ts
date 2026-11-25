// src/lib/studentTuition.ts
// Item I (opção A): o contrato é a fonte única do valor da mensalidade. O aluno não digita valor;
// a tela dele mostra o valor do contrato vigente ou, sem contrato, a referência da turma (meio período).
// Spec: docs/superpowers/specs/2026-11-25-item-i-contrato-fonte-unica-design.md

/** Rótulos distintos de propósito (ajuste do PM): "valor do contrato" nunca pode ser confundido com a referência da turma. */
export const CONTRACT_VALUE_LABEL = 'Valor do contrato';
export const CLASS_REFERENCE_LABEL = 'Referência da turma (meio período)';
export const NO_CONTRACT_NOTE = 'Sem contrato ativo. O valor definitivo é definido ao criar o contrato.';

export interface StudentContract {
  id: string;
  student_id: string;
  status: string;
  start_date: string; // 'YYYY-MM-DD'
  end_date: string; // 'YYYY-MM-DD'
  final_amount: number | string | null;
  discount?: number | string | null;
}

export type StudentTuitionView =
  | { kind: 'contract'; value: number; discount: number; start: string; end: string; contractId: string }
  | { kind: 'class_reference'; value: number }
  | { kind: 'none' };

const toNumber = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * R4: contrato vigente = `status = 'active'` cujo período contém `today` ('YYYY-MM-DD', as duas pontas contam).
 * Se vários contêm hoje, vence o de `start_date` mais recente. Se nenhum contém (ativo já vencido ou futuro),
 * o ativo de `start_date` mais recente. Desempate final por id, para o resultado não depender da ordem da lista.
 */
export function pickCurrentContract<T extends StudentContract>(contracts: T[], today: string): T | null {
  const active = contracts.filter((c) => c.status === 'active');
  if (active.length === 0) return null;
  const newestFirst = (a: T, b: T) =>
    a.start_date === b.start_date ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.start_date < b.start_date ? 1 : -1;
  const covering = active.filter((c) => c.start_date <= today && today <= c.end_date).sort(newestFirst);
  return (covering.length > 0 ? covering : [...active].sort(newestFirst))[0];
}

/** R5: sem contrato, a referência é `classes.monthly_fee` (meio período); sem valor útil na turma, nada. */
export function studentTuitionView(
  contract: StudentContract | null,
  classMonthlyFee: number | string | null | undefined,
): StudentTuitionView {
  if (contract) {
    return {
      kind: 'contract',
      value: toNumber(contract.final_amount),
      discount: toNumber(contract.discount),
      start: contract.start_date,
      end: contract.end_date,
      contractId: contract.id,
    };
  }
  const fee = toNumber(classMonthlyFee);
  return fee > 0 ? { kind: 'class_reference', value: fee } : { kind: 'none' };
}
