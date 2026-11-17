/**
 * Turns a raw Supabase/Postgres error into a short, user-facing message in
 * Portuguese (QA #6: duplicate teacher email surfaced Postgres's raw
 * "duplicate key value violates unique constraint..." message instead of
 * something a non-technical user can act on).
 *
 * Falls back to the provided fallback (or the raw message) when the error
 * shape isn't recognized — better an ugly-but-truthful message than a wrong
 * friendly one.
 */
export function getFriendlyErrorMessage(error: any, fallback?: string): string {
  const code = error?.code;
  const message: string = error?.message ?? '';

  // Postgres unique_violation (raised by e.g. teachers_email_unique)
  if (code === '23505' || /duplicate key value violates unique constraint/i.test(message)) {
    if (/email/i.test(message)) {
      return 'Esse e-mail já está cadastrado.';
    }
    return 'Já existe um registro com esse valor.';
  }

  // Supabase Auth (login/cadastro/recuperação) — mensagens em inglês da GoTrue
  if (/invalid login credentials/i.test(message)) {
    return 'E-mail ou senha incorretos.';
  }
  if (/user already registered/i.test(message)) {
    return 'Este e-mail já possui uma conta. Tente entrar ou recuperar sua senha.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'Confirme seu e-mail antes de entrar — verifique sua caixa de entrada.';
  }
  if (/password should be at least/i.test(message)) {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }
  if (/for security purposes.*after/i.test(message)) {
    return 'Aguarde um momento antes de tentar novamente.';
  }

  // Postgres check_violation (ex: due_day fora de 1-28, discount fora de 0-100)
  if (code === '23514' || /violates check constraint/i.test(message)) {
    return 'Um dos valores informados está fora do permitido — confira os campos e tente novamente.';
  }

  return fallback ?? message ?? 'Ocorreu um erro inesperado.';
}

/**
 * Erros de MFA (TOTP) do Supabase Auth em português. Nunca devolve o texto cru
 * do erro: ele pode carregar detalhes que não queremos expor nem logar.
 */
export function getFriendlyMfaError(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string; status?: number };
  const code = e.code ?? '';
  const message = e.message ?? '';

  if (code === 'mfa_verification_failed' || /invalid totp code/i.test(message)) {
    return 'Código incorreto ou expirado. Confira o horário do celular e tente de novo.';
  }
  if (code === 'mfa_challenge_expired') {
    return 'O código expirou. Digite o novo código que aparece no aplicativo.';
  }
  if (code === 'over_request_rate_limit' || e.status === 429) {
    return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
  }
  if (code === 'mfa_factor_not_found' || message === 'no-factor') {
    return 'Nenhum autenticador encontrado para esta conta.';
  }
  return 'Não foi possível verificar o código. Tente novamente.';
}

/** Erros da troca de senha (Supabase Auth) em português, sem vazar o texto cru. */
export function getFriendlyPasswordError(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string; status?: number };
  const code = e.code ?? '';
  const message = e.message ?? '';

  if (code === 'same_password' || /different from the old password/i.test(message)) {
    return 'A nova senha precisa ser diferente da atual.';
  }
  if (code === 'weak_password') {
    return 'Essa senha é fraca ou já apareceu em vazamentos. Escolha outra.';
  }
  if (code === 'reauthentication_needed') {
    return 'Por segurança, saia e entre novamente antes de trocar a senha.';
  }
  if (code === 'over_request_rate_limit' || e.status === 429) {
    return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
  }
  return 'Não foi possível alterar a senha. Tente novamente.';
}
