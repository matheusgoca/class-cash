// supabase/functions/send-notification-emails/handler.ts
// Corpo da Edge Function (sem imports de Deno/https): as dependências entram por parâmetro, então tudo é testável no Vitest sem rede.
// Ordem das travas (nada muda além da autenticação): 1) segredo do job; 2) modo saúde (só com o segredo); 3) envio global
// (EMAIL_SENDING_ENABLED); 4) secrets do Resend; 5) claim (allowlist, preferências, interruptor por escola, horário) e, por item,
// email_may_send (escola ainda ligada) antes de enviar.
import { buildNotificationEmail } from "../_shared/notificationEmail.ts";
import { buildSendBody, errorMessage, isSendingEnabled, jobAuthorized, mayShip, parseAllowlist, parseReplyTo } from "./helpers.ts";

const BATCH = 40;
const PAUSE_MS = 600; // limite do Resend: 2 requisições por segundo
const DEFAULT_APP_URL = "https://app.classcash.com.br";

type RpcResult = { data: unknown; error: unknown };
export interface SupabaseLike {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

export interface HandlerDeps {
  env(name: string): string | undefined;
  createClient(url: string, key: string): SupabaseLike;
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  // 1. Autenticação: segredo dedicado do job (EMAIL_JOB_SECRET) no cabeçalho x-job-secret. Só POST. Falha fechada, resposta idêntica
  //    para qualquer motivo (sem pista) e antes de qualquer trabalho (sem banco, sem Resend). O Authorization não é mais aceito.
  if (req.method !== "POST" || !(await jobAuthorized(req.headers.get("x-job-secret"), deps.env("EMAIL_JOB_SECRET")))) {
    return json({ error: "Não autorizado" }, 401);
  }

  // 2. Modo saúde: prova que o cliente interno (chave de serviço injetada pelo Supabase) fala com o banco, sem enviar nada e sem
  //    depender de EMAIL_SENDING_ENABLED. email_may_send com um UUID aleatório devolve false e não tem efeito colateral.
  if (req.headers.get("x-job-mode") === "health") {
    const url = deps.env("SUPABASE_URL");
    const key = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ health: "falha" }, 500);
    try {
      const { data, error } = await deps.createClient(url, key).rpc("email_may_send", { p_outbox_id: crypto.randomUUID() });
      // Nunca devolve a mensagem de erro do banco: só o resultado.
      return !error && data === false ? json({ health: "ok" }) : json({ health: "falha" }, 500);
    } catch {
      return json({ health: "falha" }, 500);
    }
  }

  // 3. Interruptor global (E9): desligado = não reivindica nada (a fila não acumula).
  if (!isSendingEnabled(deps.env("EMAIL_SENDING_ENABLED"))) {
    return json({ skipped: "disabled" });
  }

  // 4. Secrets do Resend
  const apiKey = deps.env("RESEND_API_KEY");
  const from = deps.env("EMAIL_FROM");
  if (!apiKey || !from) return json({ error: "RESEND_API_KEY e EMAIL_FROM são obrigatórios" }, 500);
  const appUrl = deps.env("APP_URL") || DEFAULT_APP_URL;
  // Opcional. Valor inválido é ignorado (com aviso, sem o valor no log): nunca derruba o envio.
  const rawReplyTo = deps.env("EMAIL_REPLY_TO");
  const replyTo = parseReplyTo(rawReplyTo);
  if (rawReplyTo && rawReplyTo.trim() && !replyTo) console.warn("EMAIL_REPLY_TO inválido: ignorado");

  const supabase = deps.createClient(deps.env("SUPABASE_URL")!, deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  // 5. Reivindicação: allowlist, preferências confirmadas, e-mail ligado no evento, interruptor por escola e horário local
  //    estão no RPC claim_notification_emails (SQL).
  const { data: items, error: claimError } = await supabase.rpc("claim_notification_emails", {
    p_now: new Date().toISOString(),
    p_limit: BATCH,
    p_only_emails: parseAllowlist(deps.env("EMAIL_ALLOWLIST")),
  });
  if (claimError) {
    console.error("claim_notification_emails falhou");
    return json({ error: "Falha ao reivindicar avisos" }, 500);
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const list = (items ?? []) as Array<Record<string, unknown>>;

  for (let i = 0; i < list.length; i++) {
    const item = list[i] as {
      outbox_id: string; to_email: string; school_name: string; event: never;
      reference_date: string; offset_days: number; item_count: number;
      total_amount: number | null; details: Record<string, unknown>;
    };
    // Interruptor por escola: a escola pode ter sido desligada depois da reivindicação. Falha fechada (erro = não envia).
    // Se a escola foi desligada, o próprio RPC já marca o item como 'skipped'; senão ele fica 'sending' e o claim o retoma depois.
    if (!mayShip(await supabase.rpc("email_may_send", { p_outbox_id: item.outbox_id }))) {
      skipped++;
      continue;
    }
    if (i > 0) await deps.sleep(PAUSE_MS);

    let status: "sent" | "failed" = "failed";
    let providerId: string | null = null;
    let error: string | null = null;
    try {
      const mail = buildNotificationEmail(item, { appUrl, schoolName: item.school_name });
      const res = await deps.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // Reenvio após queda não duplica o e-mail (válida por 24 h no Resend).
          "Idempotency-Key": item.outbox_id,
        },
        body: JSON.stringify(buildSendBody(from, item.to_email, mail, replyTo)),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body && typeof body.id === "string") {
        status = "sent";
        providerId = body.id;
      } else {
        error = errorMessage(res.status, body);
      }
    } catch (e) {
      error = `exceção: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
    }

    const { error: markError } = await supabase.rpc("mark_email_result", {
      p_outbox_id: item.outbox_id,
      p_status: status,
      p_provider_id: providerId,
      p_error: error,
    });
    if (markError) console.error("mark_email_result falhou");
    if (status === "sent") {
      sent++;
    } else {
      failed++;
    }
  }

  // Só contagens no log: nunca endereços de e-mail.
  console.log(JSON.stringify({ claimed: list.length, sent, failed, skipped }));
  return json({ claimed: list.length, sent, failed, skipped });
}
