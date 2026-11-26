-- Job de e-mail com segredo DEDICADO (go-live do e-mail, 26/11/2026).
--
-- Antes: o job mandava Authorization: Bearer <service_role_key do Vault> e a função comparava com o SUPABASE_SERVICE_ROLE_KEY dela;
-- os dois valores nunca batiam (401 toda hora). Agora o job manda o cabeçalho x-job-secret com o segredo dedicado email_job_secret
-- (Vault), e a função valida contra o secret EMAIL_JOB_SECRET (mesmo valor, gerado e cadastrado pelo PM; nunca aparece aqui).
-- O valor é lido do Vault em tempo de execução: não fica nesta migration nem no comando do cron.job. Segredo ausente vira '' e a função
-- responde 401 (falha segura).
-- cron.alter_job mantém o job (mesmo id, dono e horário 0 * * * *); se o job não existir, agenda.
-- Rollback: recriar o comando antigo (Authorization com service_role_key) ou cron.unschedule('send-notification-emails').
-- NÃO liga o envio global, não altera secrets, allowlist nem o interruptor por escola.

do $$
declare
  v_id bigint;
  v_cmd constant text := $cron$
  select net.http_post(
    url     := 'https://rzkguvbdyaukfzgolpqi.supabase.co/functions/v1/send-notification-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-job-secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'email_job_secret' limit 1), '')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$;
begin
  select jobid into v_id from cron.job where jobname = 'send-notification-emails';
  if v_id is null then
    perform cron.schedule('send-notification-emails', '0 * * * *', v_cmd);
  else
    perform cron.alter_job(v_id, schedule := '0 * * * *', command := v_cmd);
  end if;
end $$;
