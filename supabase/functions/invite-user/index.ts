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
  logRequest("invite-user", req, ALLOWED_ORIGINS);
  const corsHeaders = buildCorsHeaders(req);
  // Toda resposta passa por reply: CORS correto e o status devolvido fica no log.
  const reply = makeReply("invite-user", corsHeaders);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, role, school_id } = await req.json();

    if (!email || !role || !school_id) {
      return reply({ error: "email, role e school_id são obrigatórios" }, 400);
    }
    if (!["admin", "financial"].includes(role)) {
      return reply({ error: "Role inválida" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Valida que quem chama é admin ou owner da escola
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return reply({ error: "Não autorizado" }, 401);
    }

    // Usa o admin client para verificar o JWT do usuário — evita criar segundo client com anon key
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return reply({ error: "Não autorizado" }, 401);
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("school_id, is_master_admin")
      .eq("user_id", user.id)
      .single();

    // Owner da escola: schools.owner_user_id == user.id (NÃO profile.school_id ==
    // school_id — isso dava match pra qualquer membro da escola, não só o owner)
    const { data: targetSchool } = await supabaseAdmin
      .from("schools")
      .select("owner_user_id")
      .eq("id", school_id)
      .single();

    // Membro admin: user_roles.role == 'admin' e profile.school_id == school_id
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    const isMasterAdmin = !!profile?.is_master_admin;
    const isOwner = targetSchool?.owner_user_id === user.id;
    const isAdmin = !!roleRow && profile?.school_id === school_id;

    if (!isMasterAdmin && !isOwner && !isAdmin) {
      return reply({ error: "Apenas admins podem convidar membros" }, 403);
    }

    // Verifica se o email já existe em auth.users ANTES de tentar o convite
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const userAlreadyExists = (existingUsers?.users ?? []).some(
      (u: any) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (userAlreadyExists) {
      // Expira qualquer convite pendente para esse email nessa escola
      await supabaseAdmin
        .from("invitations")
        .update({ status: "expired" })
        .eq("email", email)
        .eq("school_id", school_id)
        .eq("status", "pending");

      return reply(
        { error: "user_exists", message: "Este usuário já possui conta. Use 'Adicionar membro existente'." },
        409
      );
    }

    // Convite duplicado pendente?
    const { data: existing } = await supabaseAdmin
      .from("invitations")
      .select("id")
      .eq("email", email)
      .eq("school_id", school_id)
      .eq("status", "pending")
      .maybeSingle();

    if (existing) {
      return reply({ error: "Já existe um convite pendente para este email" }, 409);
    }

    // Envia convite via Supabase Auth. Cliente dedicado com prazo de 20 s: se o SMTP do Auth pendurar,
    // a requisição é cancelada e respondemos 504 (antes o front ficava em "Enviando" para sempre).
    const guard = timeoutFetch(INVITE_TIMEOUT_MS);
    const inviteClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: guard.fetch } }
    );
    logInviteStart("invite-user", email);
    const inviteStartedAt = Date.now();
    const { error: inviteError } = await inviteClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: authRedirectUrl(Deno.env.get("APP_URL")),
    });
    const inviteMs = Date.now() - inviteStartedAt;

    if (guard.timedOut()) {
      logInviteResult("invite-user", { email, ok: false, status: 504, ms: inviteMs, timeout: true });
      return reply({ error: INVITE_TIMEOUT_CODE, message: INVITE_TIMEOUT_MESSAGE }, 504);
    }

    if (inviteError) {
      const authErr = inviteError as { status?: number; code?: string; name: string };
      logInviteResult("invite-user", {
        email, ok: false, status: authErr.status ?? 400, ms: inviteMs,
        codigo: authErr.code ?? authErr.name,
      });
      return reply({ error: inviteError.message }, 400);
    }
    logInviteResult("invite-user", { email, ok: true, status: 200, ms: inviteMs });

    // Registra convite
    const { error: insertError } = await supabaseAdmin
      .from("invitations")
      .insert({ email, role, school_id, invited_by: user.id, status: "pending" });

    if (insertError) throw insertError;

    return reply({ success: true });

  } catch (err: any) {
    console.error("invite-user error:", err);
    return reply({ error: err.message ?? "Erro interno" }, 500);
  }
});
