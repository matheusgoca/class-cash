// Decisão de autorização da Edge Function reset-user-mfa, isolada e SEM imports
// de Deno/Supabase para poder ser testada no Vitest (não há Deno/Docker na
// máquina de desenvolvimento). A função só busca os dados e delega para cá.

export interface AuthzInput {
  callerId: string;
  targetId: string;
  /** Claim `aal` do JWT de quem chama. */
  callerAal: string;
  caller: { isMaster: boolean; schoolId: string | null; isAdminRole: boolean };
  /** null = perfil do alvo não encontrado. */
  target: { schoolId: string | null; isMaster: boolean } | null;
  /** Escola do ALVO. */
  school: { ownerUserId: string | null; require2fa: boolean } | null;
}

export type AuthzResult =
  | { ok: true; actorRole: "master" | "admin" }
  | { ok: false; status: number; error: string };

const deny = (status: number, error: string): AuthzResult => ({ ok: false, status, error });

export function authorizeMfaReset(i: AuthzInput): AuthzResult {
  if (!i.target?.schoolId) return deny(404, "Usuário não encontrado.");

  if (i.callerId === i.targetId && !i.caller.isMaster) {
    return deny(403, "Peça a outro administrador (ou ao suporte) para redefinir o seu 2FA.");
  }

  if (i.caller.isMaster) return { ok: true, actorRole: "master" };

  // O master do Class Cash também pode ser owner/admin de uma escola. Sem esta
  // regra, qualquer admin dela removeria o 2FA do master.
  if (i.target.isMaster) {
    return deny(403, "Apenas o suporte Class Cash pode redefinir o 2FA de uma conta master.");
  }

  const sameSchool = i.caller.schoolId === i.target.schoolId;
  const isOwner = !!i.school?.ownerUserId && i.school.ownerUserId === i.callerId;
  if (!sameSchool || (!isOwner && !i.caller.isAdminRole)) {
    return deny(403, "Apenas admins da escola podem redefinir o 2FA de um membro.");
  }

  // Se a escola exige 2FA, quem chama precisa ter provado o segundo fator na
  // sessão atual; senão uma senha roubada bastaria para tirar o 2FA dos outros.
  if (i.school?.require2fa && i.callerAal !== "aal2") {
    return deny(403, "Confirme o seu 2FA para executar esta ação.");
  }

  return { ok: true, actorRole: "admin" };
}

/** Lê o claim `aal` do payload do JWT (sem validar assinatura: o token já passou por auth.getUser). */
export function jwtAal(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "aal1";
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const aal = JSON.parse(json)?.aal;
    return typeof aal === "string" ? aal : "aal1";
  } catch {
    return "aal1";
  }
}
