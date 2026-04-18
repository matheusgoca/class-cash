import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
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

    // Upsert user role
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: user.id, role: invite.role });

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
