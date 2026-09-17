import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Só a origem real do app — nunca "*". Cada função já valida o Bearer token
// internamente, mas CORS aberto facilita phishing/cópia do endpoint por site
// de terceiro.
const ALLOWED_ORIGINS = [
  "https://class-cash-tan.vercel.app",
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
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: "Não autorizado" }, { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify the caller's JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return Response.json({ error: "Não autorizado" }, { status: 401, headers: corsHeaders });
    }

    const email = user.email;
    if (!email) {
      return Response.json({ error: "Email não encontrado no token" }, { status: 400, headers: corsHeaders });
    }

    // Find the most recent pending invitation for this email (service role bypasses RLS)
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("invitations")
      .select("id, school_id, role")
      .eq("email", email)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (inviteError) {
      console.error("invitations select error:", inviteError);
      return Response.json({ error: inviteError.message }, { status: 500, headers: corsHeaders });
    }

    if (!invite) {
      return Response.json({ error: "no_invite", message: "Nenhum convite pendente encontrado para este email" }, { status: 404, headers: corsHeaders });
    }

    // Update profile with school_id
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ school_id: invite.school_id })
      .eq("user_id", user.id);

    if (profileError) {
      console.error("profiles update error:", profileError);
      return Response.json({ error: profileError.message }, { status: 500, headers: corsHeaders });
    }

    // user_roles.role é um enum Postgres (admin/financial/teacher) — "owner"
    // NUNCA foi um valor válido ali. Dono de escola sempre teve permissão via
    // "admin" (checada em toda RLS como role IN ('admin','financial')); quem
    // é de fato dono vem de schools.owner_user_id, não desta coluna. Gravar
    // "owner" aqui direto sempre falhava com erro de tipo, e é exatamente
    // por isso que convites de dono nunca chegavam a ser marcados como
    // aceitos (a função retornava erro antes de chegar lá).
    //
    // onConflict explícito porque a PK de user_roles é `id`, não `user_id`
    // (só tem UNIQUE(user_id)); sem isso um upsert sem conflito detectado na
    // PK vira um INSERT puro, que falha com violação de UNIQUE se a linha
    // já existir.
    const roleToStore = invite.role === "owner" ? "admin" : invite.role;
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: user.id, role: roleToStore }, { onConflict: "user_id" });

    if (roleError) {
      console.error("user_roles upsert error:", roleError);
      return Response.json({ error: roleError.message }, { status: 500, headers: corsHeaders });
    }

    // Mark invitation as accepted
    const { error: acceptError } = await supabaseAdmin
      .from("invitations")
      .update({ status: "accepted" })
      .eq("id", invite.id);

    if (acceptError) {
      console.error("invitations update error:", acceptError);
      // Non-fatal — continue
    }

    return Response.json({ success: true, school_id: invite.school_id, role: invite.role }, { headers: corsHeaders });

  } catch (err: any) {
    console.error("accept-invite error:", err);
    return Response.json(
      { error: err.message ?? "Erro interno" },
      { status: 500, headers: corsHeaders }
    );
  }
});
