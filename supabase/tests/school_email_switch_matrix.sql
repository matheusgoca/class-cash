-- supabase/tests/school_email_switch_matrix.sql
-- Matriz do interruptor de e-mail POR ESCOLA (S6, bloco 1). Migration: 20261126140000_school_email_switch.sql.
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste. NUNCA remova o "rollback;" do final.
-- ATENÇÃO: roda contra PRODUÇÃO, cria escolas de teste, move dois usuários de teste (admin e financeiro) para elas e confirma o e-mail
-- deles dentro da transação. Não rodar perto das 08:00 UTC. Personas por consulta; sem UUIDs nem nomes de escola fixos.
-- Migration ainda NÃO aplicada: trocar a linha marcadora MIGRATION (sozinha na linha) pelo conteúdo da migration.
-- Migration já aplicada: npx supabase@2.117.0 db query --linked -f supabase/tests/school_email_switch_matrix.sql
-- O interruptor GLOBAL (EMAIL_SENDING_ENABLED) vive na Edge Function, antes da reivindicação, e não é coberto aqui (helpers.test.ts).
-- Saída: uma linha por verificação; "ok" deve ser true em TODAS.

begin;

-- @@MIGRATION@@

create temp table t_res (n serial, cenario text, got text, esperado text, ok boolean);

create function pg_temp.run_as(p_uid uuid, p_aal text, p_sql text)
returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'aal', p_aal, 'role', 'authenticated')::text, true);
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

create function pg_temp.claimed(p_now timestamptz, p_only text[] default null) returns text language sql as $f$
  select jsonb_array_length(public.claim_notification_emails(p_now, 40, p_only))::text
$f$;

-- liga/desliga como o usuário via RPC: o jsonb em texto ou o erro
create function pg_temp.toggle(p_uid uuid, p_school uuid, p_on boolean, p_aal text default 'aal2') returns text language sql as $f$
  select pg_temp.run_as(p_uid, p_aal, format('select public.set_school_email_enabled(%L, %L)::text', p_school, p_on))
$f$;

-- UPDATE direto em schools como o usuário: 'barrado' se deu erro ou não alterou nenhuma linha; 'alterou' se passou
create function pg_temp.direct(p_uid uuid, p_aal text, p_school uuid, p_set text) returns text language sql as $f$
  select case when r like 'ERR:%' or r = '0' then 'barrado' else 'alterou' end
    from (select pg_temp.run_as(p_uid, p_aal, format('with u as (update public.schools set %s where id = %L returning 1) select count(*)::text from u', p_set, p_school)) r) z
$f$;

do $$
declare
  u_master uuid; u_admin uuid; u_fin uuid; s_orig uuid;
  d date := date '2031-03-10';
  t_8sp timestamptz := '2031-03-10 11:00:00+00';   -- 08:00 em São Paulo
  t_7sp timestamptz := '2031-03-10 10:59:00+00';   -- 07:59 em São Paulo
  s_x uuid; s_y uuid; e_admin text; id1 uuid; id2 uuid; id3 uuid; v text;
begin
  perform set_config('request.jwt.claims', '', true);
  select p.user_id, p.school_id into u_master, s_orig from public.profiles p where p.is_master_admin and p.school_id is not null order by p.user_id limit 1;
  select p.user_id into u_admin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_orig and not p.is_master_admin and r.role = 'admin' order by p.user_id limit 1;
  select p.user_id into u_fin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_orig and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  if u_master is null or u_admin is null or u_fin is null then raise exception 'personagens nao encontrados'; end if;

  insert into public.schools (name, owner_user_id) values ('Escola Teste Email X', u_master) returning id into s_x;
  insert into public.schools (name, owner_user_id) values ('Escola Teste Email Y', u_master) returning id into s_y;
  update public.profiles set school_id = s_x where user_id = u_admin;
  update public.profiles set school_id = s_y where user_id = u_fin;
  delete from auth.mfa_factors where user_id in (u_admin, u_fin);
  delete from public.mfa_grace where user_id in (u_admin, u_fin, u_master);
  delete from public.notification_preferences where user_id in (u_admin, u_fin);
  delete from public.notification_settings    where user_id in (u_admin, u_fin);
  delete from public.notifications            where user_id in (u_admin, u_fin);
  delete from public.email_outbox             where user_id in (u_admin, u_fin);
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id in (u_admin, u_fin);
  select email into e_admin from auth.users where id = u_admin;

  -- Tudo o mais aberto: preferências confirmadas, e-mail ligado no evento, aviso do dia (admin em X; financeiro em Y)
  insert into public.notification_settings (school_id, user_id, confirmed_at) values (s_x, u_admin, now()), (s_y, u_fin, now());
  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days) values
    (s_x, u_admin, 'tuition_overdue', true, true, 5), (s_y, u_fin, 'tuition_overdue', true, true, 5);
  insert into public.notifications (school_id, user_id, event, reference_date, offset_days, item_count, total_amount, details) values
    (s_x, u_admin, 'tuition_overdue', d, 5, 12, 6840, '{"class_count": 3}'),
    (s_y, u_fin,   'tuition_overdue', d, 5, 7,  2100, '{"class_count": 1}');

  -- 1. Padrão: desligado para todas
  perform pg_temp.rec('1a escola nova nasce com e-mail DESLIGADO', (select email_enabled::text from public.schools where id = s_x), 'false');
  perform pg_temp.rec('1b as escolas existentes ficam DESLIGADAS (nenhuma ligada por padrão)',
    (select count(*)::text from public.schools where email_enabled and id not in (s_x, s_y)), '0');
  perform pg_temp.rec('1c tudo aberto, mas escola desligada: nada é reivindicado', pg_temp.claimed(t_8sp), '0');
  perform pg_temp.rec('1d nada entrou na fila', (select count(*)::text from public.email_outbox where school_id in (s_x, s_y)), '0');

  -- 2. Quem NÃO consegue ligar
  perform pg_temp.rec('2a admin: UPDATE direto de email_enabled', pg_temp.direct(u_admin, 'aal1', s_x, 'email_enabled = true'), 'barrado');
  perform pg_temp.rec('2b admin: UPDATE direto dos campos de auditoria do interruptor', pg_temp.direct(u_admin, 'aal1', s_x, 'email_enabled_at = now(), email_enabled_by = auth.uid()'), 'barrado');
  perform pg_temp.rec('2c admin: pelo RPC (API)', pg_temp.toggle(u_admin, s_x, true, 'aal1'), 'ERR:42501:NOT_ALLOWED');
  perform pg_temp.rec('2d financeiro: UPDATE direto', pg_temp.direct(u_fin, 'aal1', s_y, 'email_enabled = true'), 'barrado');
  perform pg_temp.rec('2e financeiro: pelo RPC', pg_temp.toggle(u_fin, s_y, true, 'aal1'), 'ERR:42501:NOT_ALLOWED');
  perform pg_temp.rec('2f admin não liga nem em outra escola', pg_temp.toggle(u_admin, s_y, true, 'aal1'), 'ERR:42501:NOT_ALLOWED');
  perform pg_temp.rec('2g admin cria escola já ligada (INSERT direto): barrado',
    case when pg_temp.run_as(u_admin, 'aal1', format($q$with i as (insert into public.schools (name, owner_user_id, email_enabled) values ('Escola Isca', %L, true) returning 1) select count(*)::text from i$q$, u_admin)) like 'ERR:%' then 'barrado' else 'alterou' end, 'barrado');
  perform pg_temp.rec('2h nada mudou nas escolas X e Y', (select count(*)::text from public.schools where email_enabled and id in (s_x, s_y)), '0');
  perform pg_temp.rec('2i master sem 2FA (aal1) pelo RPC: barrado', case when pg_temp.toggle(u_master, s_x, true, 'aal1') like 'ERR:%' then 'barrado' else 'alterou' end, 'barrado');
  perform pg_temp.rec('2j master sem 2FA (aal1) por UPDATE direto: barrado', pg_temp.direct(u_master, 'aal1', s_x, 'email_enabled = true'), 'barrado');
  perform pg_temp.rec('2k ...e continua desligada', (select email_enabled::text from public.schools where id = s_x), 'false');

  -- 3. O master liga (aal2)
  v := pg_temp.toggle(u_master, s_x, true);
  perform pg_temp.rec('3a master liga a escola X pelo RPC', (v::jsonb->>'email_enabled') || '/' || (v::jsonb->>'skipped'), 'true/0');
  perform pg_temp.rec('3b registra quando e quem ligou', (select (email_enabled and email_enabled_at is not null and email_enabled_by = u_master)::text from public.schools where id = s_x), 'true');
  perform pg_temp.rec('3c auditoria da mudança na escola (ação de master, com old_data e new_data)',
    (select (is_master_action and (old_data->>'email_enabled') = 'false' and (new_data->>'email_enabled') = 'true')::text from public.audit_logs
      where table_name = 'schools' and record_id = s_x and action = 'update' and 'email_enabled' = any(changed_fields) order by created_at desc, id desc limit 1), 'true');
  perform pg_temp.rec('3d a escola Y segue desligada', (select email_enabled::text from public.schools where id = s_y), 'false');
  perform pg_temp.rec('3e RPC com escola inexistente: NOT_FOUND', pg_temp.toggle(u_master, gen_random_uuid(), true), 'ERR:22023:NOT_FOUND');

  -- 4. Ligada, as outras travas continuam valendo
  perform pg_temp.rec('4a antes das 08:00 locais: nada', pg_temp.claimed(t_7sp), '0');
  perform pg_temp.rec('4b allowlist com outro e-mail: nada', pg_temp.claimed(t_8sp, array['outro@exemplo.com']), '0');
  update public.notification_settings set confirmed_at = null where user_id = u_admin;
  perform pg_temp.rec('4c sem preferências confirmadas (confirmed_at nulo): nada', pg_temp.claimed(t_8sp), '0');
  update public.notification_settings set confirmed_at = now() where user_id = u_admin;
  update public.notification_preferences set email = false where user_id = u_admin;
  perform pg_temp.rec('4d e-mail desligado no evento: nada', pg_temp.claimed(t_8sp), '0');
  update public.notification_preferences set email = true where user_id = u_admin;
  perform pg_temp.rec('4e allowlist com o e-mail certo: 1 (só a escola X; a Y está desligada)', pg_temp.claimed(t_8sp, array[e_admin]), '1');
  perform pg_temp.rec('4f a fila só tem a escola X', (select string_agg(distinct (school_id = s_x)::text, ',') from public.email_outbox), 'true');
  select id into id1 from public.email_outbox where school_id = s_x;

  -- 5. Checagem no envio (email_may_send)
  perform pg_temp.rec('5a item reivindicado de escola ligada pode sair', public.email_may_send(id1)::text, 'true');
  perform pg_temp.rec('5b o usuário comum não executa email_may_send', case when pg_temp.run_as(u_admin, 'aal1', format($q$select public.email_may_send(%L)::text$q$, id1)) like 'ERR:42501%' then 'negado' else 'executou' end, 'negado');
  perform pg_temp.rec('5c id inexistente: não pode sair', public.email_may_send(gen_random_uuid())::text, 'false');

  -- 6. Desligar pula a fila sem apagar
  insert into public.email_outbox (school_id, user_id, event, reference_date, status, attempts)
    values (s_x, u_admin, 'expense_due', d, 'sent', 1) returning id into id3;
  insert into public.email_outbox (school_id, user_id, event, reference_date, status, attempts)
    values (s_x, u_admin, 'tuition_due', d, 'failed', 1) returning id into id2;
  v := pg_temp.toggle(u_master, s_x, false);
  perform pg_temp.rec('6a master desliga: 2 itens pulados (o reivindicado e o que falhou)', (v::jsonb->>'email_enabled') || '/' || (v::jsonb->>'skipped'), 'false/2');
  perform pg_temp.rec('6b os pulados ficam como skipped com o motivo, sem apagar',
    (select count(*)::text from public.email_outbox where school_id = s_x and status = 'skipped' and skip_reason = 'school_email_disabled'), '2');
  perform pg_temp.rec('6c o item já enviado continua sent', (select status from public.email_outbox where id = id3), 'sent');
  perform pg_temp.rec('6d nada foi apagado (3 linhas)', (select count(*)::text from public.email_outbox where school_id = s_x), '3');
  perform pg_temp.rec('6e desligada: apaga o "quando e quem ligou"', (select (not email_enabled and email_enabled_at is null and email_enabled_by is null)::text from public.schools where id = s_x), 'true');
  perform pg_temp.rec('6f desligada: o item pulado não pode sair', public.email_may_send(id1)::text, 'false');
  perform pg_temp.rec('6g desligada com aviso do dia: nada novo é reivindicado', pg_temp.claimed(t_8sp, array[e_admin]), '0');
  perform pg_temp.rec('6h religar no mesmo dia NÃO reenvia o que já foi pulado', (pg_temp.toggle(u_master, s_x, true) is not null)::text || '/' || pg_temp.claimed(t_8sp, array[e_admin]), 'true/0');

  -- 7. Desligar durante o envio: o item reivindicado e ainda 'sending' não sai
  perform pg_temp.rec('7a (setup) outro dia: 1 reivindicado', (select (select count(*) from public.notifications where school_id = s_x) > 0)::text, 'true');
  update public.email_outbox set status = 'sending' where id = id1;
  update public.schools set email_enabled = false where id = s_x;   -- desligada "por baixo" (script, sem usuário)
  v := public.email_may_send(id1)::text;
  perform pg_temp.rec('7b escola desligada e item ainda "sending": email_may_send nega e marca como pulado', v || '/' || (select status from public.email_outbox where id = id1), 'false/skipped');
  update public.email_outbox set status = 'sending', skip_reason = null where id = id1;
  perform public.mark_email_result(id1, 'skipped', null, 'school_email_disabled');
  perform pg_temp.rec('7c mark_email_result aceita skipped com o motivo', (select status || '/' || skip_reason from public.email_outbox where id = id1), 'skipped/school_email_disabled');
  begin
    perform public.mark_email_result(id1, 'xyz');
    perform pg_temp.rec('7d status inválido segue falhando', 'sem erro', 'ERR:22023');
  exception when others then
    perform pg_temp.rec('7d status inválido segue falhando', 'ERR:' || sqlstate, 'ERR:22023');
  end;

  -- 8. Outra escola não é afetada
  update public.schools set email_enabled = true where id in (s_x, s_y);
  delete from public.email_outbox where school_id in (s_x, s_y);
  perform pg_temp.rec('8a duas escolas ligadas: as duas reivindicam (1 cada)', pg_temp.claimed(t_8sp), '2');
  perform pg_temp.toggle(u_master, s_x, false);
  perform pg_temp.rec('8b desligar X pula só os itens de X', (select string_agg(school_id::text || ':' || status, ',' order by (school_id = s_x) desc) from public.email_outbox) ,
    s_x::text || ':skipped,' || s_y::text || ':sending');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
