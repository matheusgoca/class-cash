-- S4a: de hora em hora chama a Edge Function de e-mail (spec E4). A chave de serviço vem do
-- Vault (segredo "service_role_key") em tempo de execução: nunca fica nesta migration.
-- Se o segredo ainda não existir, o Bearer vai nulo, a função responde 401 e nada acontece (falha segura).
-- Aplicar SÓ DEPOIS de a função estar implantada.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-notification-emails') then
    perform cron.unschedule('send-notification-emails');
  end if;
end $$;

select cron.schedule(
  'send-notification-emails',
  '0 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://rzkguvbdyaukfzgolpqi.supabase.co/functions/v1/send-notification-emails',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1), '')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
