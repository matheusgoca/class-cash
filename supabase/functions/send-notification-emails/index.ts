// supabase/functions/send-notification-emails/index.ts
// S4a: envia por e-mail os avisos do dia. Chamada só pelo pg_cron (via pg_net), de hora em hora, autenticada pelo segredo
// dedicado EMAIL_JOB_SECRET (cabeçalho x-job-secret). Toda a lógica está em handler.ts (testável sem rede);
// a regra de quem recebe o quê e quando está no RPC claim_notification_emails (SQL).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleRequest } from "./handler.ts";

serve((req) =>
  handleRequest(req, {
    env: (name) => Deno.env.get(name),
    createClient: (url, key) => createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }),
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }),
);
