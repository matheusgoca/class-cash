// Log estruturado e prazo da chamada de convite (invite-user e invite-school-owner).
// Sem imports de Deno/Supabase (testável no Vitest). NUNCA registra e-mail completo nem token: do e-mail, só o domínio.

/** Espera máxima por inviteUserByEmail (o SMTP padrão do Supabase pode pendurar a chamada). */
export const INVITE_TIMEOUT_MS = 20_000;

/** Código estável devolvido com HTTP 504 quando o envio do convite passa do prazo. */
export const INVITE_TIMEOUT_CODE = 'invite_timeout';
export const INVITE_TIMEOUT_MESSAGE =
  'O serviço de e-mail não respondeu a tempo. O convite não foi enviado; tente novamente em alguns minutos.';

type Log = (line: string) => void;
const defaultLog: Log = (line) => console.log(line);

/** Só o domínio do e-mail (minúsculo); nada do que vem antes do "@". */
export function emailDomain(email: unknown): string {
  if (typeof email !== 'string') return 'desconhecido';
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return 'invalido';
  return email.slice(at + 1).trim().toLowerCase().slice(0, 100) || 'invalido';
}

/** Primeira coisa de cada requisição: método e origem (sem e-mail, sem token, sem corpo). */
export function logRequest(fn: string, req: Request, allowedOrigins: readonly string[], log: Log = defaultLog): void {
  const origin = req.headers.get('origin');
  log(JSON.stringify({ fn, evento: 'requisicao', metodo: req.method, origin, origin_permitida: !!origin && allowedOrigins.includes(origin) }));
}

/** Responde com o CORS da requisição e registra o status devolvido (todo caminho passa por aqui). */
export function makeReply(fn: string, corsHeaders: Record<string, string>, log: Log = defaultLog) {
  return (body: unknown, status = 200): Response => {
    log(JSON.stringify({ fn, evento: 'resposta', status }));
    return Response.json(body, { status, headers: corsHeaders });
  };
}

export function logInviteStart(fn: string, email: unknown, log: Log = defaultLog): void {
  log(JSON.stringify({ fn, evento: 'invite_inicio', dominio: emailDomain(email) }));
}

export function logInviteResult(
  fn: string,
  r: { email: unknown; ok: boolean; status: number; ms: number; codigo?: string | null; timeout?: boolean },
  log: Log = defaultLog,
): void {
  log(JSON.stringify({ fn, evento: 'invite_resultado', ok: r.ok, status: r.status, ms: r.ms, codigo: r.codigo ?? null, timeout: !!r.timeout, dominio: emailDomain(r.email) }));
}

/**
 * fetch com prazo: cancela a requisição de verdade (AbortController) depois de `ms`, em vez de só parar de esperar.
 * Usado num cliente dedicado ao convite; `timedOut()` diz se foi o prazo que derrubou a chamada.
 */
export function timeoutFetch(ms: number, base: typeof fetch = (...a) => fetch(...a)) {
  let timedOut = false;
  const wrapped = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
    init?.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    return base(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  }) as typeof fetch;
  return { fetch: wrapped, timedOut: () => timedOut };
}
