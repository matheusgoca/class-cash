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

  return fallback ?? message ?? 'Ocorreu um erro inesperado.';
}
