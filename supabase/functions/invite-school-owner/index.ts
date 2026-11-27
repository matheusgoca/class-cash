import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authRedirectUrl } from "../_shared/appUrl.ts";
import {
  INVITE_TIMEOUT_CODE, INVITE_TIMEOUT_MESSAGE, INVITE_TIMEOUT_MS,
  logInviteResult, logInviteStart, logRequest, makeReply, timeoutFetch,
} from "../_shared/inviteGuard.ts";

// Só a origem real do app — nunca "*". Cada função já valida o Bearer token
// internamente, mas CORS aberto facilita phishing/cópia do endpoint por site
// de terceiro.
const ALLOWED_ORIGINS = [
  "https://class-cash-tan.vercel.app",
  "https://app.classcash.com.br",
  "http://localhost:8080",
  "http://localhost:8081",
];

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  // Primeira coisa: registra a chegada (método e origem; sem e-mail, sem token).
  logRequest("invite-school-owner", req, ALLOWED_ORIGINS);
  const corsHeaders = buildCorsHeaders(req);
  // Toda resposta passa por reply: CORS correto e o status devolvido fica no log.
  const reply = makeReply("invite-school-owner", corsHeaders);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, school_name, segments, plan } = await req.json();

    if (!email || !school_name || !Array.isArray(segments) || segments.length === 0) {
      return reply({ error: "email, school_name e segments são obrigatórios" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Validate caller is master admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return reply({ error: "Não autorizado" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return reply({ error: "Não autorizado" }, 401);
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_master_admin")
      .eq("user_id", user.id)
      .single();

    if (!profile?.is_master_admin) {
      return reply({ error: "Apenas master admin pode convidar donos de escola" }, 403);
    }

    // Verifica se o email já existe em auth.users ANTES de tentar o convite
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const userAlreadyExists = (existingUsers?.users ?? []).some(
      (u: any) => u.email?.toLowerCase() === email.toLowerCase(),
    );

    if (userAlreadyExists) {
      // Expira qualquer convite de dono pendente para esse email
      await supabaseAdmin
        .from("invitations")
        .update({ status: "expired" })
        .eq("email", email)
        .eq("role", "owner")
        .eq("status", "pending");

      return reply({ error: "user_exists", message: "Este e-mail já possui conta no Class Cash." }, 409);
    }

    // Convite de dono já pendente para esse email?
    const { data: existingInvite } = await supabaseAdmin
      .from("invitations")
      .select("id")
      .eq("email", email)
      .eq("role", "owner")
      .eq("status", "pending")
      .maybeSingle();

    if (existingInvite) {
      return reply({ error: "invite_pending", message: "Já existe um convite pendente para este e-mail." }, 409);
    }

    // Embed school data in invite metadata — Onboarding will auto-create the school on first login.
    // Cliente dedicado com prazo de 20 s: se o SMTP do Auth pendurar, cancela a requisição e responde 504.
    const guard = timeoutFetch(INVITE_TIMEOUT_MS);
    const inviteClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: guard.fetch } },
    );
    logInviteStart("invite-school-owner", email);
    const inviteStartedAt = Date.now();
    const { error: inviteError } = await inviteClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: authRedirectUrl(Deno.env.get("APP_URL")),
      data: {
        pending_school_name: school_name,
        pending_school_segments: segments,
        pending_school_plan: plan ?? "starter",
      },
    });
    const inviteMs = Date.now() - inviteStartedAt;

    if (guard.timedOut()) {
      logInviteResult("invite-school-owner", { email, ok: false, status: 504, ms: inviteMs, timeout: true });
      return reply({ error: INVITE_TIMEOUT_CODE, message: INVITE_TIMEOUT_MESSAGE }, 504);
    }

    if (inviteError) {
      const authErr = inviteError as { status?: number; code?: string; name: string };
      logInviteResult("invite-school-owner", {
        email, ok: false, status: authErr.status ?? 400, ms: inviteMs,
        codigo: authErr.code ?? authErr.name,
      });
      return reply({ error: inviteError.message }, 400);
    }
    logInviteResult("invite-school-owner", { email, ok: true, status: 200, ms: inviteMs });

    // Registra o convite para o Painel Master poder ver/reenviar
    const { error: insertError } = await supabaseAdmin
      .from("invitations")
      .insert({
        email,
        role: "owner",
        school_id: null,
        invited_by: user.id,
        status: "pending",
        pending_school_name: school_name,
        pending_school_segments: segments,
        pending_school_plan: plan ?? "starter",
      });

    if (insertError) throw insertError;

    return reply({ success: true });
  } catch (err: any) {
    console.error("invite-school-owner error:", err);
    return reply({ error: err.message ?? "Erro interno" }, 500);
  }
});
