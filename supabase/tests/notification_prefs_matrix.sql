-- Matriz das preferências de notificação (S3). Spec: docs/superpowers/specs/2026-11-18-preferencias-notificacao-design.md
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste.
-- ATENÇÃO: roda contra PRODUÇÃO e apaga fatores de 2FA, um usuário de teste e liga require_2fa dentro da transação — NUNCA remova o "rollback;" do final.
--
-- Como rodar:
--   Migration já aplicada:  npx supabase@2.117.0 db query --linked -f supabase/tests/notification_prefs_matrix.sql
--   Migration NÃO aplicada: gerar um arquivo que troca a linha marcadora MIGRATION (abaixo) pelo conteúdo de
--     supabase/migrations/20261118120000_notification_preferences.sql e rodar esse arquivo.
-- Saída: uma linha por verificação; "ok" deve ser true em TODAS.

begin;

-- @@MIGRATION@@

create temp table t_res (n serial, cenario text, got text, esperado text, ok boolean);

create function pg_temp.run_as(p_uid uuid, p_aal text, p_sql text)
returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'aal', p_aal, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;

create function pg_temp.rec(p_cenario text, p_got text, p_esperado text) returns void language sql as $f$
  insert into t_res (cenario, got, esperado, ok)
  values (p_cenario, p_got, p_esperado, coalesce(p_got = p_esperado or (p_esperado like 'ERR:%' and p_got like p_esperado || '%'), false))
$f$;

do $$
declare
  u_master  uuid := '52d00ab5-567f-4537-b33a-22c2bd44e14d'; -- master + owner + admin, Colegio Teste
  u_admin_t uuid := 'e0185312-eea9-4273-a9a8-ad9d575d4781'; -- admin, Colegio Teste
  u_fin_t   uuid := 'b7ba4eb2-c7a2-4129-83a8-de8e7175c446'; -- financeiro, Colegio Teste
  u_owner_p uuid := '03065019-c9b4-4163-a4c9-b89a6cd12986'; -- owner + admin, Colégio Pensar
  s_teste   uuid := 'aaaf9993-908f-43f2-9d3d-dc12357d7468';
  s_pensar  uuid := '2b1e5eba-6cf9-4cb1-a742-eecca53ab5d5';

  q_ensure     text := 'select jsonb_array_length(public.ensure_notification_preferences()->''preferences'')::text';
  q_count_mine text := 'select count(*)::text from public.notification_preferences where user_id = auth.uid()';
  q_email_on   text := 'select count(*)::text from public.notification_preferences where user_id = auth.uid() and email';
  q_confirmed  text := 'select (confirmed_at is not null)::text from public.notification_settings where user_id = auth.uid()';
  q_has_reenr  text := $q$select (public.ensure_notification_preferences()->'preferences' @> '[{"event":"reenrollment"}]')::text$q$;
  q_save_ok    text := $q$select (public.save_notification_preferences(
       '[{"event":"tuition_overdue","in_app":true,"email":true,"offset_days":10}]'::jsonb,
       true, '08:00'::time, 'America/Sao_Paulo')->'settings'->>'digest_time')$q$;
  q_save_bad_offset text := $q$select public.save_notification_preferences(
       '[{"event":"tuition_due","in_app":true,"email":false,"offset_days":4}]'::jsonb,
       false, '07:00'::time, 'America/Sao_Paulo')::text$q$;
  q_save_reenr text := $q$select public.save_notification_preferences(
       '[{"event":"reenrollment","in_app":true,"email":true,"offset_days":45}]'::jsonb,
       false, '07:00'::time, 'America/Sao_Paulo')::text$q$;
  q_save_bad_tz text := $q$select public.save_notification_preferences('[]'::jsonb, false, '07:00'::time, 'Marte/Olympus')::text$q$;
  q_save_bad_hr text := $q$select public.save_notification_preferences('[]'::jsonb, true, '21:00'::time, 'America/Sao_Paulo')::text$q$;
  q_direct_ins  text := format($q$with x as (insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
       values (%L, auth.uid(), 'tuition_due', true, true, 3) returning 1) select count(*)::text from x$q$, s_teste);
  q_direct_upd  text := 'with x as (update public.notification_preferences set email = true where user_id = auth.uid() returning 1) select count(*)::text from x';
  q_read_admin_t text := format('select count(*)::text from public.notification_preferences where user_id = %L', 'e0185312-eea9-4273-a9a8-ad9d575d4781');
  v_before text;
begin
  -- estado controlado: sem fatores, sem carência, sem exigência; nenhuma preferência prévia
  perform set_config('request.jwt.claims', '', true);
  delete from auth.mfa_factors where user_id in (u_master, u_admin_t, u_fin_t, u_owner_p);
  delete from public.mfa_grace  where user_id in (u_master, u_admin_t, u_fin_t, u_owner_p);
  update public.schools set require_2fa = false where id in (s_teste, s_pensar);
  delete from public.notification_preferences where user_id in (u_master, u_admin_t, u_fin_t, u_owner_p);
  delete from public.notification_settings    where user_id in (u_master, u_admin_t, u_fin_t, u_owner_p);

  -- 1. ensure: 5 para admin/owner, 4 para financeiro; e-mail desligado; confirmed_at nulo
  perform pg_temp.rec('1a ensure admin → 5 eventos',        pg_temp.run_as(u_admin_t, 'aal1', q_ensure), '5');
  perform pg_temp.rec('1b ensure owner Pensar → 5 eventos',  pg_temp.run_as(u_owner_p, 'aal1', q_ensure), '5');
  perform pg_temp.rec('1c ensure financeiro → 4 eventos',    pg_temp.run_as(u_fin_t,   'aal1', q_ensure), '4');
  perform pg_temp.rec('1d financeiro sem linha reenrollment', pg_temp.run_as(u_fin_t,  'aal1', q_count_mine), '4');
  perform pg_temp.rec('1e e-mail desligado em tudo (admin)', pg_temp.run_as(u_admin_t, 'aal1', q_email_on), '0');
  perform pg_temp.rec('1f confirmed_at nulo após ensure',    pg_temp.run_as(u_admin_t, 'aal1', q_confirmed), 'false');

  -- 2. ensure idempotente
  -- xmin muda em qualquer UPDATE, mesmo dentro da mesma transação (now() é constante aqui)
  v_before := (select string_agg(id::text || xmin::text, ',' order by event) from public.notification_preferences where user_id = u_admin_t);
  perform pg_temp.run_as(u_admin_t, 'aal1', q_ensure);
  perform pg_temp.rec('2a ensure 2x não duplica',            pg_temp.run_as(u_admin_t, 'aal1', q_count_mine), '5');
  perform pg_temp.rec('2b ensure 2x não altera linhas',
    ((select string_agg(id::text || xmin::text, ',' order by event) from public.notification_preferences where user_id = u_admin_t) = v_before)::text, 'true');

  -- 3. save grava e confirma; 2º save não muda confirmed_at
  perform pg_temp.rec('3a save devolve horário salvo',       pg_temp.run_as(u_admin_t, 'aal1', q_save_ok), '08:00');
  perform pg_temp.rec('3b save preenche confirmed_at',       pg_temp.run_as(u_admin_t, 'aal1', q_confirmed), 'true');
  perform pg_temp.rec('3c e-mail ligado só no evento salvo', pg_temp.run_as(u_admin_t, 'aal1', q_email_on), '1');
  -- now() é constante na transação: recua confirmed_at 1 dia (como superusuário) para que now() != valor atual
  perform set_config('request.jwt.claims', '', true);
  update public.notification_settings set confirmed_at = confirmed_at - interval '1 day' where user_id = u_admin_t;
  v_before := (select confirmed_at::text from public.notification_settings where user_id = u_admin_t);
  perform pg_temp.run_as(u_admin_t, 'aal1', q_save_ok);
  perform pg_temp.rec('3d 2º save mantém confirmed_at',
    ((select confirmed_at::text from public.notification_settings where user_id = u_admin_t) = v_before)::text, 'true');

  -- 4. save rejeita entradas inválidas
  perform pg_temp.rec('4a offset fora da lista',             pg_temp.run_as(u_admin_t, 'aal1', q_save_bad_offset), 'ERR:22023:INVALID_OFFSET');
  perform pg_temp.rec('4b reenrollment pelo financeiro',     pg_temp.run_as(u_fin_t,   'aal1', q_save_reenr),      'ERR:42501:EVENT_NOT_ALLOWED');
  perform pg_temp.rec('4c fuso inválido',                    pg_temp.run_as(u_admin_t, 'aal1', q_save_bad_tz),     'ERR:22023:INVALID_TIMEZONE');
  perform pg_temp.rec('4d horário fora da faixa',            pg_temp.run_as(u_admin_t, 'aal1', q_save_bad_hr),     'ERR:22023:INVALID_DIGEST_TIME');

  -- 5. RLS de leitura
  perform pg_temp.rec('5a financeiro não lê linhas do admin', pg_temp.run_as(u_fin_t,   'aal1', q_read_admin_t), '0');
  perform pg_temp.rec('5b owner de outra escola não lê',      pg_temp.run_as(u_owner_p, 'aal1', q_read_admin_t), '0');
  perform pg_temp.rec('5c master aal2 lê',                    pg_temp.run_as(u_master,  'aal2', q_read_admin_t), '5');
  perform pg_temp.rec('5d master aal1 sem carência não lê',   pg_temp.run_as(u_master,  'aal1', q_read_admin_t), '0');

  -- 6. escrita direta bloqueada (sem policy de escrita)
  perform pg_temp.rec('6a INSERT direto falha',               pg_temp.run_as(u_admin_t, 'aal1', q_direct_ins), 'ERR:42501');
  perform pg_temp.rec('6b UPDATE direto não afeta linhas',    pg_temp.run_as(u_admin_t, 'aal1', q_direct_upd), '0');

  -- 7. gate: escola exige 2FA
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_teste;
  delete from public.mfa_grace where user_id in (u_admin_t, u_fin_t);
  perform pg_temp.rec('7a admin aal1 sem carência bloqueado', pg_temp.run_as(u_admin_t, 'aal1', q_ensure), 'ERR:42501:MFA_REQUIRED');
  perform pg_temp.rec('7b financeiro passa',                  pg_temp.run_as(u_fin_t,   'aal1', q_ensure), '4');
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = false where id = s_teste;

  -- 8. rebaixado de admin para financeiro
  perform set_config('request.jwt.claims', '', true);
  update public.user_roles set role = 'financial' where user_id = u_admin_t;
  perform pg_temp.rec('8a rebaixado: ensure devolve 4',       pg_temp.run_as(u_admin_t, 'aal1', q_ensure), '4');
  perform pg_temp.rec('8b rebaixado: sem reenrollment',       pg_temp.run_as(u_admin_t, 'aal1', q_has_reenr), 'false');
  perform pg_temp.rec('8c rebaixado: linha antiga mantida, nenhuma nova',
    (select count(*)::text from public.notification_preferences where user_id = u_admin_t), '5');
  perform pg_temp.rec('8d rebaixado: save de reenrollment rejeitado', pg_temp.run_as(u_admin_t, 'aal1', q_save_reenr), 'ERR:42501:EVENT_NOT_ALLOWED');

  -- 9. FK cascade: apagar o usuário remove as linhas dele
  perform set_config('request.jwt.claims', '', true);
  delete from auth.users where id = u_fin_t;
  perform pg_temp.rec('9a cascade em notification_preferences',
    (select count(*)::text from public.notification_preferences where user_id = u_fin_t), '0');
  perform pg_temp.rec('9b cascade em notification_settings',
    (select count(*)::text from public.notification_settings where user_id = u_fin_t), '0');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
