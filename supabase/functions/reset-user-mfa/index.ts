import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeMfaReset, jwtAal } from "./authz.ts";

// Só a origem real do app — nunca "*" (mesmo padrão das demais functions).
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

// Remove o(s) fator(es) 2FA de um usuário que perdeu o aparelho. Precisa da
// service role (por isso roda aqui e não no navegador). A decisão de QUEM pode
// fazer isso está em authz.ts, coberta por testes.
serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const userId: unknown = body?.user_id;
    if (typeof userId !== "string" || userId.length === 0) return fail("user_id é obrigatório", 400);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("Não autorizado", 401);
    const token = authHeader.replace("Bearer ", "");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user: caller }, error: authError } = await admin.auth.getUser(token);
    if (authError || !caller) return fail("Não autorizado", 401);

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("school_id, is_master_admin")
      .eq("user_id", caller.id)
      .maybeSingle();

    const { data: callerRole } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    const { data: targetProfile } = await admin
      .from("profiles")
      .select("school_id, is_master_admin, full_name")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: school } = targetProfile?.school_id
      ? await admin.from("schools").select("owner_user_id, require_2fa").eq("id", targetProfile.school_id).maybeSingle()
      : { data: null };

    const decision = authorizeMfaReset({
      callerId: caller.id,
      targetId: userId,
      callerAal: jwtAal(token),
      caller: {
        isMaster: !!callerProfile?.is_master_admin,
        schoolId: callerProfile?.school_id ?? null,
        isAdminRole: !!callerRole,
      },
      target: targetProfile
        ? { schoolId: targetProfile.school_id ?? null, isMaster: !!targetProfile.is_master_admin }
        : null,
      school: school ? { ownerUserId: school.owner_user_id ?? null, require2fa: !!school.require_2fa } : null,
    });
    if (!decision.ok) return fail(decision.error, decision.status);

    const { data: factorsData, error: listError } = await admin.auth.admin.mfa.listFactors({ userId });
    if (listError) throw listError;
    const factors = factorsData?.factors ?? [];

    // Nada a remover: não muda estado, não grava histórico e NÃO renova a
    // carência (senão um admin poderia estender a carência de alguém à vontade).
    if (factors.length === 0) {
      return Response.json({ success: true, removed: 0 }, { headers: cors });
    }

    // Remover um fator verificado também encerra todas as sessões do usuário.
    for (const f of factors) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
      if (error) throw error;
    }
    await admin.from("mfa_grace").delete().eq("user_id", userId); // recomeça a carência

    const { error: auditError } = await admin.from("audit_logs").insert({
      table_name: "mfa_factors",
      action: "update", // audit_logs_action_check só aceita insert|update|delete
      record_id: userId,
      school_id: targetProfile!.school_id,
      actor_user_id: caller.id,
      actor_role: decision.actorRole,
      is_master_action: decision.actorRole === "master",
      changed_fields: ["mfa_reset"],
      new_data: { target_name: targetProfile!.full_name, removed_factors: factors.length },
      source: "manual",
    });
    if (auditError) {
      console.error("reset-user-mfa: falha ao gravar audit_logs:", auditError.code);
      return fail("O 2FA foi redefinido, mas não foi possível registrar no histórico. Avise o suporte.", 500);
    }

    return Response.json({ success: true, removed: factors.length }, { headers: cors });
  } catch (err) {
    // Nunca devolver nem logar o corpo/tokens; só o código do erro.
    console.error("reset-user-mfa error:", (err as { code?: string })?.code ?? "erro");
    return fail("Erro interno ao redefinir o 2FA.", 500);
  }
});
