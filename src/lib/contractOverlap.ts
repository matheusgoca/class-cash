// Trava de contrato ativo sobreposto (S6b, bloco C2). Dois contratos ATIVOS do mesmo aluno com períodos que se sobrepõem
// geram cobrança em dobro. Aqui ficam as regras do FRONT (formulário, reativação, importação); os RPCs import_contract e
// renew_contracts repetem a checagem no servidor (migration 20261126130000). Não há constraint no banco: a criação direta
// pela API segue sem barreira (aceito por ora; dívida registrada no STATUS).
// 'suspended' e 'cancelled' NÃO contam; os limites do período são inclusivos (fim = início do outro é sobreposição);
// o sucessor de uma renovação começa no dia seguinte ao fim da origem, então nunca conflita com ela.
import { format } from 'date-fns';
import { parseLocalDate } from '@/lib/dateUtils';

export interface PeriodContract {
  id?: string;
  student_id?: string;
  start_date: string; // 'YYYY-MM-DD'
  end_date: string;
  status?: string;
}

export interface OverlapCandidate {
  student_id: string;
  start_date: string;
  end_date: string;
  excludeId?: string;
}

/** Datas ISO 'YYYY-MM-DD' comparam corretamente como texto. Limites inclusivos. */
export function periodsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Procura, numa lista em memória, um contrato ATIVO do mesmo aluno que se sobreponha ao candidato (usado pela importação). */
export function findOverlap(existing: PeriodContract[], cand: OverlapCandidate): PeriodContract | undefined {
  return existing.find(
    (c) =>
      c.status === 'active' &&
      c.student_id === cand.student_id &&
      (cand.excludeId === undefined || c.id !== cand.excludeId) &&
      periodsOverlap(c.start_date, c.end_date, cand.start_date, cand.end_date),
  );
}

export function overlapMessage(c: { start_date: string; end_date: string }): string {
  const d = (s: string) => format(parseLocalDate(s), 'dd/MM/yyyy');
  return `Este aluno já tem um contrato ativo de ${d(c.start_date)} a ${d(c.end_date)}. Encerre ou ajuste esse contrato antes de criar outro que se sobreponha.`;
}

/**
 * Quando validar no formulário: criação de contrato ativo; edição que REATIVA (suspenso/cancelado para ativo) ou que muda as
 * datas de um contrato ativo. Editar outro campo não revalida (não trava a correção de um cadastro legado).
 */
export function needsOverlapCheck(
  before: { status: string; start_date: string; end_date: string } | null,
  after: { status: string; start_date: string; end_date: string },
): boolean {
  if (after.status !== 'active') return false;
  if (!before) return true;
  return before.status !== 'active' || before.start_date !== after.start_date || before.end_date !== after.end_date;
}

interface QueryClient {
  from: (table: string) => any;
}

/** Consulta o banco: outro contrato ativo do aluno, na escola, que se sobreponha ao candidato (school_id sempre explícito). */
export async function fetchOverlappingContract(
  client: QueryClient,
  schoolId: string,
  cand: OverlapCandidate,
): Promise<{ id: string; start_date: string; end_date: string } | undefined> {
  let q = client
    .from('contracts')
    .select('id, start_date, end_date')
    .eq('school_id', schoolId)
    .eq('student_id', cand.student_id)
    .eq('status', 'active')
    .lte('start_date', cand.end_date)
    .gte('end_date', cand.start_date);
  if (cand.excludeId) q = q.neq('id', cand.excludeId);
  const { data, error } = await q.limit(1);
  if (error) throw error;
  return (data ?? [])[0];
}
