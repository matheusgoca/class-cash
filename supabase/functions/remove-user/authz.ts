// Decisão de autorização da Edge Function remove-user, isolada e SEM imports de Deno/Supabase para poder ser
// testada no Vitest. A função só busca os dados e delega para cá. A escola considerada é SEMPRE a do perfil do
// alvo (nunca um school_id vindo do cliente).

export interface RemovalInput {
  callerId: string;
  targetId: string;
  /** Claim `aal` do JWT de quem chama. */
  callerAal: string;
  caller: { isMaster: boolean; schoolId: string | null; isAdminRole: boolean };
  /** null = perfil do alvo não encontrado. */
  target: { schoolId: string | null; isMaster: boolean; isAdminRole: boolean } | null;
  /** Escola do ALVO. */
  school: { ownerUserId: string | null; require2fa: boolean } | null;
  /** Quantos OUTROS admins (além do alvo) a escola do alvo tem. */
  otherAdmins: number;
}

export type RemovalResult =
  | { ok: true; actorRole: "master" | "admin" }
  | { ok: false; status: number; error: string };

const deny = (status: number, error: string): RemovalResult => ({ ok: false, status, error });

export function authorizeRemoval(i: RemovalInput): RemovalResult {
  if (!i.target) return deny(404, "Usuário não encontrado.");

  if (i.callerId === i.targetId) return deny(403, "Você não pode remover a si mesmo.");

  // O master do Class Cash nunca é removido por esta função (nem por outro master).
  if (i.target.isMaster) return deny(403, "Contas master não podem ser removidas por aqui.");

  if (i.school?.ownerUserId && i.school.ownerUserId === i.targetId) {
    return deny(403, "O owner da escola não pode ser removido.");
  }

  if (i.caller.isMaster) return { ok: true, actorRole: "master" };

  if (!i.target.schoolId || i.caller.schoolId !== i.target.schoolId) {
    return deny(403, "Apenas admins da escola podem remover membros.");
  }
  const isOwner = !!i.school?.ownerUserId && i.school.ownerUserId === i.callerId;
  if (!isOwner && !i.caller.isAdminRole) {
    return deny(403, "Apenas admins da escola podem remover membros.");
  }

  // Escola que exige 2FA: quem chama precisa ter provado o segundo fator na sessão atual.
  if (i.school?.require2fa && i.callerAal !== "aal2") {
    return deny(403, "Confirme o seu 2FA para executar esta ação.");
  }

  if (i.target.isAdminRole && i.otherAdmins < 1) {
    return deny(403, "A escola precisa ter ao menos um admin.");
  }

  return { ok: true, actorRole: "admin" };
}
