// Propagação da edição de valor/desconto do contrato para as mensalidades abertas (S6b, bloco B).
// O RPC update_contract_amounts (migration 20261126120000) faz a conta; com p_dry_run devolve o que MUDARIA, e este módulo
// só descreve o resultado para o aviso de confirmação.
import { SCHOLARSHIP_LABEL } from '@/lib/scholarship';

export interface AmountsResult {
  dry_run: boolean;
  old_final: number;
  new_final: number;
  changed: boolean;
  upcoming: number;
  overdue: number;
  to_scholarship: number;
  reopened_upcoming: number;
  reopened_overdue: number;
  updated: number;
  unchanged: { adjusted: number; renegotiated: number; paid: number; cancelled: number };
}

export function amountsChanged(
  contract: { monthly_amount: number | string; discount: number | string },
  next: { monthly_amount: number; discount: number },
): boolean {
  return Number(contract.monthly_amount) !== next.monthly_amount || Number(contract.discount) !== next.discount;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function propagationSummary(r: AmountsResult): { headline: string; unchanged: string | null } {
  let headline: string;
  if (r.to_scholarship > 0) {
    headline = `${plural(r.to_scholarship, 'mensalidade aberta', 'mensalidades abertas')} (${r.upcoming} a vencer e ${r.overdue} vencidas) ${r.to_scholarship === 1 ? 'vira' : 'viram'} ${SCHOLARSHIP_LABEL} e ${r.to_scholarship === 1 ? 'fica quitada' : 'ficam quitadas'}.`;
  } else if (r.reopened_upcoming + r.reopened_overdue > 0) {
    const n = r.reopened_upcoming + r.reopened_overdue;
    headline = `${plural(n, 'mensalidade de bolsa reabre', 'mensalidades de bolsa reabrem')} com o novo valor (${r.reopened_upcoming} a vencer e ${r.reopened_overdue} vencidas).`;
  } else if (r.upcoming + r.overdue > 0) {
    const parts: string[] = [];
    if (r.upcoming > 0) parts.push(`${r.upcoming} a vencer`);
    if (r.overdue > 0) parts.push(`${r.overdue} ${r.overdue === 1 ? 'vencida' : 'vencidas'}`);
    const total = r.upcoming + r.overdue;
    headline = `${parts.join(' e ')} ${total === 1 ? 'será atualizada' : 'serão atualizadas'} para o novo valor.`;
  } else {
    headline = 'Nenhuma mensalidade será alterada; só o contrato.';
  }

  const u = r.unchanged;
  const reasons: string[] = [];
  if (u.adjusted > 0) reasons.push(`${u.adjusted} ${u.adjusted === 1 ? 'ajustada manualmente' : 'ajustadas manualmente'}`);
  if (u.renegotiated > 0) reasons.push(`${u.renegotiated} ${u.renegotiated === 1 ? 'renegociada' : 'renegociadas'}`);
  if (u.paid > 0) reasons.push(`${u.paid} ${u.paid === 1 ? 'paga' : 'pagas'}`);
  if (u.cancelled > 0) reasons.push(`${u.cancelled} ${u.cancelled === 1 ? 'cancelada' : 'canceladas'}`);
  return { headline, unchanged: reasons.length > 0 ? `Não serão alteradas: ${reasons.join(', ')}.` : null };
}
