import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { user_id, school_id } = await req.json();

    if (!user_id || !school_id) {
      return Response.json(
        { error: "user_id e school_id são obrigatórios" },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verifica quem está chamando
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: "Não autorizado" }, { status: 401, headers: corsHeaders });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !caller) {
      return Response.json({ error: "Não autorizado" }, { status: 401, headers: corsHeaders });
    }

    // Não pode remover a si mesmo
    if (caller.id === user_id) {
      return Response.json({ error: "Você não pode remover a si mesmo." }, { status: 403, headers: corsHeaders });
    }

    // Verifica se o alvo é o owner da escola
    const { data: school } = await supabaseAdmin
      .from("schools")
      .select("owner_user_id")
      .eq("id", school_id)
      .single();

    if (school?.owner_user_id === user_id) {
      return Response.json({ error: "O owner da escola não pode ser removido." }, { status: 403, headers: corsHeaders });
    }

    // Verifica que quem chama é admin ou owner da escola
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("school_id")
      .eq("user_id", caller.id)
      .single();

    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    const isOwner = school?.owner_user_id === caller.id;
    const isAdmin = !!callerRole && callerProfile?.school_id === school_id;

    if (!isOwner && !isAdmin) {
      return Response.json(
        { error: "Apenas admins podem remover membros." },
        { status: 403, headers: corsHeaders }
      );
    }

    // 1. Remove roles
    await supabaseAdmin.from("user_roles").delete().eq("user_id", user_id);

    // 2. Remove profile
    await supabaseAdmin.from("profiles").delete().eq("user_id", user_id);

    // 3. Deleta do Auth
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id);
    if (deleteError) throw deleteError;

    return Response.json({ success: true }, { headers: corsHeaders });

  } catch (err: any) {
    console.error("remove-user error:", err);
    return Response.json(
      { error: err.message ?? "Erro interno" },
      { status: 500, headers: corsHeaders }
    );
  }
});
