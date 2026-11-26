// supabase/functions/send-notification-emails/helpers.ts
// Regras puras da Edge Function, sem imports de Deno (testáveis no Vitest).

/** Tamanho mínimo do segredo do job (hex de 64 caracteres recomendado). Abaixo disso a função recusa tudo (falha fechada). */
export const MIN_JOB_SECRET_LENGTH = 32;

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * Autentica o job (pg_cron via pg_net) pelo segredo dedicado EMAIL_JOB_SECRET, enviado no cabeçalho x-job-secret.
 * Falha FECHADA: segredo configurado ausente ou com menos de MIN_JOB_SECRET_LENGTH caracteres, ou cabeçalho ausente = false.
 * Compara o SHA-256 dos dois lados byte a byte, sem sair cedo (tempo constante, sem vazar nem o tamanho). Espaço e quebra de linha
 * nas pontas são ignorados dos dois lados (o valor é hexadecimal).
 */
export async function jobAuthorized(header: string | null, secret: string | undefined | null): Promise<boolean> {
  const configured = (secret ?? '').trim();
  if (configured.length < MIN_JOB_SECRET_LENGTH) return false;
  const given = (header ?? '').trim();
  if (!given) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(configured)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
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

/**
 * Interruptor de e-mail por escola (S6, bloco 1): o RPC email_may_send(outbox_id) é consultado imediatamente antes de cada envio.
 * Falha fechada: só um `true` sem erro libera; erro, nulo ou qualquer outro valor NÃO envia (o item volta à fila do próprio claim).
 */
export function mayShip(res: { data: unknown; error: unknown } | undefined | null): boolean {
  return !!res && !res.error && res.data === true;
}
