import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jwtAal } from "../reset-user-mfa/authz.ts";
import { authorizeRemoval } from "./authz.ts";

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

// Remove um membro (papel, perfil e conta). A decisão de QUEM pode remover QUEM está em authz.ts (coberta por
// testes) e usa SEMPRE a escola do perfil do alvo — o school_id do corpo só é conferido, nunca decide.
serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const userId: unknown = body?.user_id;
    const claimedSchoolId: unknown = body?.school_id;

    if (typeof userId !== "string" || userId.length === 0) {
      return fail("user_id é obrigatório", 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verifica quem está chamando
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("Não autorizado", 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !caller) return fail("Não autorizado", 401);

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("school_id, is_master_admin")
      .eq("user_id", caller.id)
      .maybeSingle();

    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    // Alvo: a escola vem do PERFIL DELE, nunca do corpo da requisição.
    const { data: targetProfile } = await supabaseAdmin
      .from("profiles")
      .select("school_id, is_master_admin")
      .eq("user_id", userId)
      .maybeSingle();

    if (typeof claimedSchoolId === "string" && targetProfile && targetProfile.school_id !== claimedSchoolId) {
      return fail("O usuário não pertence à escola informada.", 400);
    }

    const { data: targetRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    const { data: school } = targetProfile?.school_id
      ? await supabaseAdmin.from("schools").select("owner_user_id, require_2fa").eq("id", targetProfile.school_id).maybeSingle()
      : { data: null };

    // Quantos OUTROS admins a escola do alvo tem
    let otherAdmins = 0;
    if (targetProfile?.school_id) {
      const { data: colleagues } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .eq("school_id", targetProfile.school_id)
        .neq("user_id", userId);
      const ids = (colleagues ?? []).map((c: { user_id: string }) => c.user_id);
      if (ids.length > 0) {
        const { count } = await supabaseAdmin
          .from("user_roles")
          .select("user_id", { count: "exact", head: true })
          .in("user_id", ids)
          .eq("role", "admin");
        otherAdmins = count ?? 0;
      }
    }

    const decision = authorizeRemoval({
      callerId: caller.id,
      targetId: userId,
      callerAal: jwtAal(token),
      caller: {
        isMaster: !!callerProfile?.is_master_admin,
        schoolId: callerProfile?.school_id ?? null,
        isAdminRole: !!callerRole,
      },
      target: targetProfile
        ? { schoolId: targetProfile.school_id ?? null, isMaster: !!targetProfile.is_master_admin, isAdminRole: !!targetRole }
        : null,
      school: school ? { ownerUserId: school.owner_user_id ?? null, require2fa: !!school.require_2fa } : null,
      otherAdmins,
    });
    if (!decision.ok) return fail(decision.error, decision.status);

    // 1. Remove roles
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);

    // 2. Remove profile
    await supabaseAdmin.from("profiles").delete().eq("user_id", userId);

    // 3. Deleta do Auth
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    // Nunca devolver nem logar corpo/tokens; só o código do erro.
    console.error("remove-user error:", (err as { code?: string })?.code ?? "erro");
    return fail("Erro interno ao remover o usuário.", 500);
  }
});
