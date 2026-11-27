// supabase/functions/_shared/appUrl.ts
// Origem do app para os links dos convites (redirectTo). Antes era um link FIXO na Vercel em cada função; agora vem do secret APP_URL
// (o mesmo que os e-mails de aviso usam), mas só se a origem estiver na lista permitida, para nunca virar um redirecionamento aberto.
//
// ALLOWED_ORIGINS é a MESMA lista do CORS das 5 funções (invite-user, invite-school-owner, accept-invite, remove-user, reset-user-mfa);
// um teste garante que elas não divergem. A origem nova do app entra na lista ANTES de qualquer troca de APP_URL.

export const FALLBACK_ORIGIN = "https://class-cash-tan.vercel.app";

export const ALLOWED_ORIGINS: readonly string[] = [
  FALLBACK_ORIGIN,
  "https://app.classcash.com.br",
  "http://localhost:8080",
  "http://localhost:8081",
];

/**
 * redirectTo dos convites: `<origem do APP_URL>/auth`. Só a ORIGEM do APP_URL é usada (caminho, query e fragmento são ignorados);
 * origem fora da lista, ausente ou inválida cai na origem da Vercel. O resultado SEMPRE termina em /auth: é lá que o Auth.tsx lê
 * type=invite/recovery do fragmento para mostrar a tela de definir senha.
 */
export function authRedirectUrl(appUrl: string | undefined | null): string {
  let origin = FALLBACK_ORIGIN;
  try {
    const candidate = new URL((appUrl ?? "").trim()).origin;
    if (ALLOWED_ORIGINS.includes(candidate)) origin = candidate;
  } catch {
    // vazio ou inválido: fica o fallback
  }
  return `${origin}/auth`;
}
