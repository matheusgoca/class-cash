-- supabase/tests/email_job_matrix.sql
-- Verifica o job de e-mail com segredo dedicado (migration 20261126150000_email_job_dedicated_secret.sql). SOMENTE LEITURA:
-- nenhuma escrita, e imprime só verdadeiro/falso (nunca valor de segredo). Termina em ROLLBACK por segurança.
-- Migration ainda NÃO aplicada: trocar a linha marcadora MIGRATION (sozinha na linha) pelo conteúdo dela (vira escrita dentro da
-- transação, desfeita no rollback). Migration aplicada: npx supabase@2.117.0 db query --linked -f supabase/tests/email_job_matrix.sql
-- Saída: uma linha por verificação; "ok" deve ser true em TODAS.

begin;

-- @@MIGRATION@@

create temp table t_res (n serial, cenario text, got text, esperado text, ok boolean);
create function pg_temp.rec(p_c text, p_got text, p_e text) returns void language sql as $f$
  insert into t_res (cenario, got, esperado, ok) values (p_c, p_got, p_e, p_got = p_e) $f$;

do $$
declare j record;
begin
  select * into j from cron.job where jobname = 'send-notification-emails';
  perform pg_temp.rec('1 o job existe (um só)', (select count(*)::text from cron.job where jobname = 'send-notification-emails'), '1');
  perform pg_temp.rec('2 ativo', j.active::text, 'true');
  perform pg_temp.rec('3 horário 0 * * * * (de hora em hora)', j.schedule, '0 * * * *');
  perform pg_temp.rec('4 usa o segredo email_job_secret do Vault', (j.command like '%email_job_secret%')::text, 'true');
  perform pg_temp.rec('5 envia o cabeçalho x-job-secret', (j.command like '%x-job-secret%')::text, 'true');
  perform pg_temp.rec('6 não usa mais o service_role_key', (j.command not like '%service_role_key%')::text, 'true');
  perform pg_temp.rec('7 não manda mais o Authorization', (j.command not like '%Authorization%')::text, 'true');
  perform pg_temp.rec('8 nenhum valor literal de segredo no comando (sem JWT eyJ..., sem hex longo)',
    (j.command !~ 'eyJ[A-Za-z0-9_-]{10,}' and j.command !~ '[0-9a-fA-F]{32,}')::text, 'true');
  perform pg_temp.rec('9 chama a função certa', (j.command like '%/functions/v1/send-notification-emails%')::text, 'true');
  perform pg_temp.rec('10 o dono do job segue postgres', j.username, 'postgres');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
