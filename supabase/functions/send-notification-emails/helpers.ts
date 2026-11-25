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

// String.raw: em string comum '\s' perderia a barra. ADDR = endereço simples, sem espaço, vírgula, ponto e vírgula nem < >.
const ADDR = String.raw`[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+`;
const REPLY_TO_RE = new RegExp(String.raw`^(?:${ADDR}|[^<>@,;\r\n]+<${ADDR}>)$`);

/**
 * EMAIL_REPLY_TO: um único endereço ("suporte@x.com" ou "Nome <suporte@x.com>").
 * Ausente, vazio ou inválido = null (o e-mail sai sem reply-to). Recusa lista e quebra de linha
 * (injeção de cabeçalho): um valor ruim nunca derruba o envio, só é ignorado.
 */
export function parseReplyTo(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim();
  return v && REPLY_TO_RE.test(v) ? v : null;
}

export interface SendBody {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
}

/** Corpo do POST para a API do Resend. `reply_to` só entra quando configurado. */
export function buildSendBody(
  from: string,
  to: string,
  mail: { subject: string; html: string; text: string },
  replyTo: string | null,
): SendBody {
  const body: SendBody = { from, to: [to], subject: mail.subject, html: mail.html, text: mail.text };
  if (replyTo) body.reply_to = replyTo;
  return body;
}

/** Texto de erro gravado em email_outbox.last_error (máx. 500 caracteres). */
export function errorMessage(status: number, body: unknown): string {
  const msg =
    body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string'
      ? (body as { message: string }).message
      : JSON.stringify(body);
  return `HTTP ${status}: ${msg}`.slice(0, 500);
}
