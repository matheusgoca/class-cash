// supabase/functions/send-notification-emails/helpers.ts
// Regras puras da Edge Function, sem imports de Deno (testáveis no Vitest).

/** Compara o Authorization recebido com a chave de serviço, em tempo constante. */
export function bearerMatches(header: string | null, key: string): boolean {
  if (!header || !key || !header.startsWith('Bearer ')) return false;
  const given = header.slice('Bearer '.length);
  if (given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

/** Interruptor global (E9): só o texto exato "true" liga. */
export function isSendingEnabled(raw: string | undefined | null): boolean {
  return raw === 'true';
}

/** EMAIL_ALLOWLIST: "a@x.com, b@y.com" → lista; vazio → null (sem filtro). */
export function parseAllowlist(raw: string | undefined | null): string[] | null {
  const list = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

/** Texto de erro gravado em email_outbox.last_error (máx. 500 caracteres). */
export function errorMessage(status: number, body: unknown): string {
  const msg =
    body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string'
      ? (body as { message: string }).message
      : JSON.stringify(body);
  return `HTTP ${status}: ${msg}`.slice(0, 500);
}
