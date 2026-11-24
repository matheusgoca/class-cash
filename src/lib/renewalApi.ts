// src/lib/renewalApi.ts
// Cliente dos RPCs da rematrícula (S4c). school_id só vai de renew_contracts (p_school_id, validado no servidor).
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { chunk, type DecisionReason, type DecisionStatus, type RpcItem } from '@/lib/renewal';

const BATCH_SIZE = 100;

const RPC_MESSAGES: Record<string, string> = {
  MFA_REQUIRED: 'Esta conta precisa da verificação em duas etapas (2FA) para continuar.',
  NOT_ALLOWED: 'Seu perfil não pode alterar a rematrícula.',
  INVALID_STATUS: 'Estado de rematrícula inválido. Recarregue a página e tente de novo.',
  INVALID_CONTRACT: 'Contrato não encontrado, inativo ou já renovado. Recarregue a página.',
  REASON_REQUIRED: 'Informe o motivo de a família não renovar.',
  INVALID_ITEMS: 'O lote precisa ter de 1 a 100 contratos.',
  INVALID_SERVICE: 'A taxa de rematrícula escolhida não está disponível. Escolha outra ou desmarque a taxa.',
};

export function friendlyRenewalError(error: unknown): string {
  const e = error as { message?: string; details?: string } | null;
  const code = (e?.message ?? '').trim();
  if (code === 'INVALID_ITEM') {
    return `Um contrato do lote foi recusado pelo servidor${e?.details ? `: ${e.details}` : '.'}`;
  }
  if (RPC_MESSAGES[code]) return RPC_MESSAGES[code];
  return getFriendlyErrorMessage(error, 'Não foi possível concluir a operação. Tente novamente.');
}

export async function setRenewalDecision(
  contractId: string,
  status: DecisionStatus | 'none',
  reason?: DecisionReason | null,
  note?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_renewal_decision', {
    p_contract_id: contractId,
    p_status: status,
    p_reason: reason ?? undefined,
    p_note: note ?? undefined,
  });
  if (error) throw new Error(friendlyRenewalError(error));
}

export interface RenewResult {
  renewed: number;
  tuitions: number;
  skipped: { source_contract_id: string; reason: string }[];
  processed: number;
  total: number;
  error: string | null;
}

/** Renova em lotes sequenciais de 100 (cada chamada é atômica). Para no 1º erro e devolve o que já passou. */
export async function renewContracts(
  schoolId: string,
  items: RpcItem[],
  feeServiceId?: string | null,
): Promise<RenewResult> {
  const result: RenewResult = { renewed: 0, tuitions: 0, skipped: [], processed: 0, total: items.length, error: null };
  for (const batch of chunk(items, BATCH_SIZE)) {
    try {
      const { data, error } = await supabase.rpc('renew_contracts', {
        p_school_id: schoolId,
        p_items: batch as unknown as Json,
        p_fee_service_id: feeServiceId ?? undefined,
      });
      if (error) {
        result.error = friendlyRenewalError(error);
        return result;
      }
      const d = data as { renewed: number; tuitions: number; skipped: { source_contract_id: string; reason: string }[] } | null;
      if (!d) {
        result.error = friendlyRenewalError(null);
        return result;
      }
      result.renewed += d.renewed;
      result.tuitions += d.tuitions;
      result.skipped.push(...d.skipped);
      result.processed += batch.length;
    } catch (e) {
      result.error = friendlyRenewalError(e);
      return result;
    }
  }
  return result;
}
