import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, role, school_id } = await req.json();

    if (!email || !role || !school_id) {
      return Response.json(
        { error: "email, role e school_id são obrigatórios" },
        { status: 400, headers: corsHeaders }
      );
    }
    if (!["admin", "financial"].includes(role)) {
      return Response.json({ error: "Role inválida" }, { status: 400, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Valida que quem chama é admin ou owner da escola
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: "Não autorizado" }, { status: 401, headers: corsHeaders });
    }

    // Usa o admin client para verificar o JWT do usuário — evita criar segundo client com anon key
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return Response.json({ error: "Não autorizado" }, { status: 401, headers: corsHeaders });
    }

    // Owner da escola: profile.school_id == school_id
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("school_id")
      .eq("user_id", user.id)
      .single();

    // Membro admin: user_roles.role == 'admin' e profile.school_id == school_id
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    const isOwner = profile?.school_id === school_id;
    const isAdmin = !!roleRow && profile?.school_id === school_id;

    if (!isOwner && !isAdmin) {
      return Response.json(
        { error: "Apenas admins podem convidar membros" },
        { status: 403, headers: corsHeaders }
      );
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

      return Response.json(
        { error: "user_exists", message: "Este usuário já possui conta. Use 'Adicionar membro existente'." },
        { status: 409, headers: corsHeaders }
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
      return Response.json(
        { error: "Já existe um convite pendente para este email" },
        { status: 409, headers: corsHeaders }
      );
    }

    // Envia convite via Supabase Auth
    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://class-cash-tan.vercel.app/auth",
    });

    if (inviteError) {
      return Response.json({ error: inviteError.message }, { status: 400, headers: corsHeaders });
    }

    // Registra convite
    const { error: insertError } = await supabaseAdmin
      .from("invitations")
      .insert({ email, role, school_id, invited_by: user.id, status: "pending" });

    if (insertError) throw insertError;

    return Response.json({ success: true }, { headers: corsHeaders });

  } catch (err: any) {
    console.error("invite-user error:", err);
    return Response.json(
      { error: err.message ?? "Erro interno" },
      { status: 500, headers: corsHeaders }
    );
  }
});
