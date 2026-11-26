// supabase/functions/send-notification-emails/index.ts
// S4a: envia por e-mail os avisos do dia. Chamada só pelo pg_cron (via pg_net), de hora em hora.
// Toda a regra de quem recebe o quê e quando está no RPC claim_notification_emails (SQL).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildNotificationEmail } from "../_shared/notificationEmail.ts";
import { bearerMatches, buildSendBody, errorMessage, isSendingEnabled, mayShip, parseAllowlist, parseReplyTo } from "./helpers.ts";

const BATCH = 40;
const PAUSE_MS = 600; // limite do Resend: 2 requisições por segundo
const DEFAULT_APP_URL = "https://class-cash-tan.vercel.app";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!bearerMatches(req.headers.get("Authorization"), serviceKey)) {
    return json({ error: "Não autorizado" }, 401);
  }

  // E9: desligado = não reivindica nada (a fila não acumula).
  if (!isSendingEnabled(Deno.env.get("EMAIL_SENDING_ENABLED"))) {
    return json({ skipped: "disabled" });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (!apiKey || !from) return json({ error: "RESEND_API_KEY e EMAIL_FROM são obrigatórios" }, 500);
  const appUrl = Deno.env.get("APP_URL") || DEFAULT_APP_URL;
  // Opcional. Valor inválido é ignorado (com aviso, sem o valor no log): nunca derruba o envio.
  const rawReplyTo = Deno.env.get("EMAIL_REPLY_TO");
  const replyTo = parseReplyTo(rawReplyTo);
  if (rawReplyTo && rawReplyTo.trim() && !replyTo) console.warn("EMAIL_REPLY_TO inválido: ignorado");

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: items, error: claimError } = await supabase.rpc("claim_notification_emails", {
    p_now: new Date().toISOString(),
    p_limit: BATCH,
    p_only_emails: parseAllowlist(Deno.env.get("EMAIL_ALLOWLIST")),
  });
  if (claimError) {
    console.error("claim_notification_emails falhou:", claimError.message);
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
    if (i > 0) await sleep(PAUSE_MS);

    let status: "sent" | "failed" = "failed";
    let providerId: string | null = null;
    let error: string | null = null;
    try {
      const mail = buildNotificationEmail(item, { appUrl, schoolName: item.school_name });
      const res = await fetch("https://api.resend.com/emails", {
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
    if (markError) console.error("mark_email_result falhou:", markError.message);
    if (status === "sent") {
      sent++;
    } else {
      failed++;
    }
  }

  // Só contagens no log: nunca endereços de e-mail.
  console.log(JSON.stringify({ claimed: list.length, sent, failed, skipped }));
  return json({ claimed: list.length, sent, failed, skipped });
});
