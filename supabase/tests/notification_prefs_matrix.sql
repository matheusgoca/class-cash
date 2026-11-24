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
  -- personagens: escolhidos por consulta no início do bloco (nenhum id fixo no arquivo)
  u_master  uuid; -- master (profiles.is_master_admin); a escola A é a escola do perfil dele
  u_admin_a uuid; -- admin, não-master, da escola A
  u_fin_a   uuid; -- financeiro da escola A
  u_owner_b uuid; -- owner + admin de OUTRA escola (B), não-master
  s_a       uuid;
  s_b       uuid;

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
  q_save_email_sem_sistema text := $q$select public.save_notification_preferences(
       '[{"event":"tuition_overdue","in_app":false,"email":true,"offset_days":5}]'::jsonb,
       false, '07:00'::time, 'America/Sao_Paulo')::text$q$;
  q_direct_ins  text;
  q_direct_upd  text := 'with x as (update public.notification_preferences set email = true where user_id = auth.uid() returning 1) select count(*)::text from x';
  q_read_admin_a text;
  v_before text;
begin
  select p.user_id, p.school_id into u_master, s_a
    from public.profiles p where p.is_master_admin and p.school_id is not null order by p.user_id limit 1;
  select p.user_id into u_admin_a from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_a and not p.is_master_admin and r.role = 'admin' order by p.user_id limit 1;
  select p.user_id into u_fin_a from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_a and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  select s.id, s.owner_user_id into s_b, u_owner_b from public.schools s
    join public.profiles p on p.user_id = s.owner_user_id and p.school_id = s.id
    join public.user_roles r on r.user_id = p.user_id and r.role = 'admin'
   where s.id <> s_a and not p.is_master_admin order by s.id limit 1;
  if u_master is null or u_admin_a is null or u_fin_a is null or u_owner_b is null then
    raise exception 'personagens não encontrados em produção (master/admin/financeiro da escola A, owner da escola B)';
  end if;
  q_direct_ins := format($q$with x as (insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
       values (%L, auth.uid(), 'tuition_due', true, true, 3) returning 1) select count(*)::text from x$q$, s_a);
  q_read_admin_a := format('select count(*)::text from public.notification_preferences where user_id = %L', u_admin_a);

  -- estado controlado: sem fatores, sem carência, sem exigência; nenhuma preferência prévia
  perform set_config('request.jwt.claims', '', true);
  delete from auth.mfa_factors where user_id in (u_master, u_admin_a, u_fin_a, u_owner_b);
  delete from public.mfa_grace  where user_id in (u_master, u_admin_a, u_fin_a, u_owner_b);
  update public.schools set require_2fa = false where id in (s_a, s_b);
  delete from public.notification_preferences where user_id in (u_master, u_admin_a, u_fin_a, u_owner_b);
  delete from public.notification_settings    where user_id in (u_master, u_admin_a, u_fin_a, u_owner_b);

  -- 1. ensure: 5 para admin/owner, 4 para financeiro; e-mail desligado; confirmed_at nulo
  perform pg_temp.rec('1a ensure admin → 5 eventos',        pg_temp.run_as(u_admin_a, 'aal1', q_ensure), '5');
  perform pg_temp.rec('1b ensure owner outra escola → 5 eventos',  pg_temp.run_as(u_owner_b, 'aal1', q_ensure), '5');
  perform pg_temp.rec('1c ensure financeiro → 4 eventos',    pg_temp.run_as(u_fin_a,   'aal1', q_ensure), '4');
  perform pg_temp.rec('1d financeiro sem linha reenrollment', pg_temp.run_as(u_fin_a,  'aal1', q_count_mine), '4');
  perform pg_temp.rec('1e e-mail desligado em tudo (admin)', pg_temp.run_as(u_admin_a, 'aal1', q_email_on), '0');
  perform pg_temp.rec('1f confirmed_at nulo após ensure',    pg_temp.run_as(u_admin_a, 'aal1', q_confirmed), 'false');

  -- 2. ensure idempotente
  -- xmin muda em qualquer UPDATE, mesmo dentro da mesma transação (now() é constante aqui)
  v_before := (select string_agg(id::text || xmin::text, ',' order by event) from public.notification_preferences where user_id = u_admin_a);
  perform pg_temp.run_as(u_admin_a, 'aal1', q_ensure);
  perform pg_temp.rec('2a ensure 2x não duplica',            pg_temp.run_as(u_admin_a, 'aal1', q_count_mine), '5');
  perform pg_temp.rec('2b ensure 2x não altera linhas',
    ((select string_agg(id::text || xmin::text, ',' order by event) from public.notification_preferences where user_id = u_admin_a) = v_before)::text, 'true');

  -- 3. save grava e confirma; 2º save não muda confirmed_at
  perform pg_temp.rec('3a save devolve horário salvo',       pg_temp.run_as(u_admin_a, 'aal1', q_save_ok), '08:00');
  perform pg_temp.rec('3b save preenche confirmed_at',       pg_temp.run_as(u_admin_a, 'aal1', q_confirmed), 'true');
  perform pg_temp.rec('3c e-mail ligado só no evento salvo', pg_temp.run_as(u_admin_a, 'aal1', q_email_on), '1');
  -- now() é constante na transação: recua confirmed_at 1 dia (como superusuário) para que now() != valor atual
  perform set_config('request.jwt.claims', '', true);
  update public.notification_settings set confirmed_at = confirmed_at - interval '1 day' where user_id = u_admin_a;
  v_before := (select confirmed_at::text from public.notification_settings where user_id = u_admin_a);
  perform pg_temp.run_as(u_admin_a, 'aal1', q_save_ok);
  perform pg_temp.rec('3d 2º save mantém confirmed_at',
    ((select confirmed_at::text from public.notification_settings where user_id = u_admin_a) = v_before)::text, 'true');

  -- 4. save rejeita entradas inválidas
  perform pg_temp.rec('4a offset fora da lista',             pg_temp.run_as(u_admin_a, 'aal1', q_save_bad_offset), 'ERR:22023:INVALID_OFFSET');
  perform pg_temp.rec('4b reenrollment pelo financeiro',     pg_temp.run_as(u_fin_a,   'aal1', q_save_reenr),      'ERR:42501:EVENT_NOT_ALLOWED');
  perform pg_temp.rec('4c fuso inválido',                    pg_temp.run_as(u_admin_a, 'aal1', q_save_bad_tz),     'ERR:22023:INVALID_TIMEZONE');
  perform pg_temp.rec('4d horário fora da faixa',            pg_temp.run_as(u_admin_a, 'aal1', q_save_bad_hr),     'ERR:22023:INVALID_DIGEST_TIME');
  -- regra de produto (19/11): o e-mail acompanha o aviso no sistema
  perform pg_temp.rec('4e e-mail sem "No sistema" rejeitado', pg_temp.run_as(u_admin_a, 'aal1', q_save_email_sem_sistema), 'ERR:22023:EMAIL_REQUIRES_IN_APP');

  -- 5. RLS de leitura
  perform pg_temp.rec('5a financeiro não lê linhas do admin', pg_temp.run_as(u_fin_a,   'aal1', q_read_admin_a), '0');
  perform pg_temp.rec('5b owner de outra escola não lê',      pg_temp.run_as(u_owner_b, 'aal1', q_read_admin_a), '0');
  perform pg_temp.rec('5c master aal2 lê',                    pg_temp.run_as(u_master,  'aal2', q_read_admin_a), '5');
  perform pg_temp.rec('5d master aal1 sem carência não lê',   pg_temp.run_as(u_master,  'aal1', q_read_admin_a), '0');

  -- 6. escrita direta bloqueada (sem policy de escrita)
  perform pg_temp.rec('6a INSERT direto falha',               pg_temp.run_as(u_admin_a, 'aal1', q_direct_ins), 'ERR:42501');
  perform pg_temp.rec('6b UPDATE direto não afeta linhas',    pg_temp.run_as(u_admin_a, 'aal1', q_direct_upd), '0');

  -- 7. gate: escola exige 2FA
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_a;
  delete from public.mfa_grace where user_id in (u_admin_a, u_fin_a);
  perform pg_temp.rec('7a admin aal1 sem carência bloqueado', pg_temp.run_as(u_admin_a, 'aal1', q_ensure), 'ERR:42501:MFA_REQUIRED');
  perform pg_temp.rec('7b financeiro passa',                  pg_temp.run_as(u_fin_a,   'aal1', q_ensure), '4');
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = false where id = s_a;

  -- 8. rebaixado de admin para financeiro
  perform set_config('request.jwt.claims', '', true);
  update public.user_roles set role = 'financial' where user_id = u_admin_a;
  perform pg_temp.rec('8a rebaixado: ensure devolve 4',       pg_temp.run_as(u_admin_a, 'aal1', q_ensure), '4');
  perform pg_temp.rec('8b rebaixado: sem reenrollment',       pg_temp.run_as(u_admin_a, 'aal1', q_has_reenr), 'false');
  perform pg_temp.rec('8c rebaixado: linha antiga mantida, nenhuma nova',
    (select count(*)::text from public.notification_preferences where user_id = u_admin_a), '5');
  perform pg_temp.rec('8d rebaixado: save de reenrollment rejeitado', pg_temp.run_as(u_admin_a, 'aal1', q_save_reenr), 'ERR:42501:EVENT_NOT_ALLOWED');

  -- 9. FK cascade: apagar o usuário remove as linhas dele
  perform set_config('request.jwt.claims', '', true);
  delete from auth.users where id = u_fin_a;
  perform pg_temp.rec('9a cascade em notification_preferences',
    (select count(*)::text from public.notification_preferences where user_id = u_fin_a), '0');
  perform pg_temp.rec('9b cascade em notification_settings',
    (select count(*)::text from public.notification_settings where user_id = u_fin_a), '0');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
