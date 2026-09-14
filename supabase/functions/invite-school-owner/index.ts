import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, school_name, segments, plan } = await req.json();

    if (!email || !school_name || !Array.isArray(segments) || segments.length === 0) {
      return Response.json(
        { error: "email, school_name e segments são obrigatórios" },
        { status: 400, headers: corsHeaders },
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Validate caller is master admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: "Não autorizado" }, { status: 401, headers: corsHeaders });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return Response.json({ error: "Não autorizado" }, { status: 401, headers: corsHeaders });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_master_admin")
      .eq("user_id", user.id)
      .single();

    if (!profile?.is_master_admin) {
      return Response.json(
        { error: "Apenas master admin pode convidar donos de escola" },
        { status: 403, headers: corsHeaders },
      );
    }

    // Embed school data in invite metadata — Onboarding will auto-create the school on first login
    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://class-cash-tan.vercel.app/auth",
      data: {
        pending_school_name: school_name,
        pending_school_segments: segments,
        pending_school_plan: plan ?? "starter",
      },
    });

    if (inviteError) {
      return Response.json({ error: inviteError.message }, { status: 400, headers: corsHeaders });
    }

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (err: any) {
    console.error("invite-school-owner error:", err);
    return Response.json(
      { error: err.message ?? "Erro interno" },
      { status: 500, headers: corsHeaders },
    );
  }
});
