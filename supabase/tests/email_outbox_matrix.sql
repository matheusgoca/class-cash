-- supabase/tests/email_outbox_matrix.sql
-- Matriz do envio de e-mails por evento (S4a). Spec: docs/superpowers/specs/2026-11-19-s4a-email-notificacoes-design.md
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste.
-- ATENÇÃO: roda contra PRODUÇÃO, cria uma escola de teste, move dois usuários de teste para ela e
-- confirma o e-mail deles dentro da transação — NUNCA remova o "rollback;" do final.
--
-- Como rodar (migrations ainda NÃO aplicadas): gerar um arquivo que troca a linha marcadora MIGRATION
-- (sozinha na linha) pelo conteúdo de 20261119130100_email_outbox.sql seguido de 20261119130200_email_claim_rpcs.sql.
-- Migrations já aplicadas: npx supabase@2.117.0 db query --linked -f supabase/tests/email_outbox_matrix.sql
-- Requer a migration 20261126140000_school_email_switch.sql (S6 bloco 1): o setup liga as escolas de teste (email_enabled).
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
  values (p_cenario, p_got, p_esperado,
          coalesce(p_got = p_esperado or (p_esperado like 'ERR:%' and p_got like p_esperado || '%'), false))
$f$;

-- quantos itens a reivindicação devolveu
create function pg_temp.claimed(p_now timestamptz, p_only text[] default null) returns text language sql as $f$
  select jsonb_array_length(public.claim_notification_emails(p_now, 40, p_only))::text
$f$;

do $$
declare
  -- personagens: escolhidos por consulta no início do bloco (nenhum id fixo no arquivo)
  u_master uuid; -- master (profiles.is_master_admin); só é dono das escolas de teste
  u_admin  uuid; -- admin, não-master, de uma escola existente (movido para a escola X)
  u_fin    uuid; -- financeiro, não-master, da mesma escola (movido para a escola X)
  s_orig   uuid; -- escola do perfil do master (de onde se escolhem admin e financeiro)
  d        date := date '2031-03-10';
  t_8sp    timestamptz := '2031-03-10 11:00:00+00';   -- 08:00 em São Paulo (UTC-3)
  t_7sp    timestamptz := '2031-03-10 10:59:00+00';   -- 07:59 em São Paulo
  t_8hnl   timestamptz := '2031-03-10 18:00:00+00';   -- 08:00 em Honolulu (UTC-10)
  s_x uuid; s_y uuid;
  e_admin text; id_ad_over uuid; id_ad_re uuid; id_fin_over uuid;
  v text;
begin
  perform set_config('request.jwt.claims', '', true);

  select p.user_id, p.school_id into u_master, s_orig
    from public.profiles p where p.is_master_admin and p.school_id is not null order by p.user_id limit 1;
  select p.user_id into u_admin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_orig and not p.is_master_admin and r.role = 'admin' order by p.user_id limit 1;
  select p.user_id into u_fin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_orig and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  if u_master is null or u_admin is null or u_fin is null then
    raise exception 'personagens não encontrados em produção (master, admin e financeiro não-master de uma escola)';
  end if;

  insert into public.schools (name, owner_user_id) values ('Escola Teste S4a X', u_master) returning id into s_x;
  insert into public.schools (name, owner_user_id) values ('Escola Teste S4a Y', u_master) returning id into s_y;
  -- S6 bloco 1: o freio por escola nasce desligado; estas escolas de teste precisam estar ligadas para o claim as enxergar
  update public.schools set email_enabled = true where id in (s_x, s_y);
  update public.profiles set school_id = s_x where user_id in (u_admin, u_fin);
  delete from auth.mfa_factors where user_id in (u_admin, u_fin);
  delete from public.mfa_grace  where user_id in (u_admin, u_fin);
  delete from public.notification_preferences where user_id in (u_admin, u_fin);
  delete from public.notification_settings    where user_id in (u_admin, u_fin);
  delete from public.notifications            where user_id in (u_admin, u_fin);
  delete from public.email_outbox             where user_id in (u_admin, u_fin);
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id in (u_admin, u_fin);
  select email into e_admin from auth.users where id = u_admin;

  -- Os dois confirmaram a tela e ligaram e-mail em atraso e rematrícula (fin tem linha de rematrícula
  -- de propósito: o financeiro NÃO é destinatário desse evento).
  insert into public.notification_settings (school_id, user_id, confirmed_at) values (s_x, u_admin, now()), (s_x, u_fin, now());
  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days) values
    (s_x, u_admin, 'tuition_overdue', true, true, 5), (s_x, u_admin, 'reenrollment', true, true, 45),
    (s_x, u_fin,   'tuition_overdue', true, true, 5), (s_x, u_fin,   'reenrollment', true, true, 45);

  insert into public.notifications (school_id, user_id, event, reference_date, offset_days, item_count, total_amount, details) values
    (s_x, u_admin, 'tuition_overdue', d, 5, 12, 6840, '{"class_count": 3}'),
    (s_x, u_admin, 'reenrollment',    d, 45, 18, null, '{"renewed_count": 6}'),
    (s_x, u_fin,   'tuition_overdue', d, 5, 12, 6840, '{"class_count": 3}'),
    (s_x, u_fin,   'reenrollment',    d, 45, 18, null, '{"renewed_count": 6}'),
    (s_y, u_admin, 'tuition_overdue', d, 5, 99, 1,    '{"class_count": 1}');   -- escola Y: admin não tem perfil lá (isca)

  -- 1. Horário local
  perform pg_temp.rec('1a antes das 08:00 locais: nada',           pg_temp.claimed(t_7sp), '0');
  perform pg_temp.rec('1b às 08:00 locais: admin(2) + fin(1) — fin não recebe rematrícula', pg_temp.claimed(t_8sp), '3');
  perform pg_temp.rec('1c fila tem exatamente esses 3',
    (select string_agg(x, ',' order by x) from (
       select case user_id when u_admin then 'admin' else 'fin' end || ':' || event as x
         from public.email_outbox where school_id = s_x) t),
    'admin:reenrollment,admin:tuition_overdue,fin:tuition_overdue');
  perform pg_temp.rec('1d escola Y (sem vínculo do admin) não gera fila',
    (select count(*)::text from public.email_outbox where school_id = s_y), '0');

  -- 2. Não duplica
  perform pg_temp.rec('2a segunda chamada imediata: nada (já reivindicado)', pg_temp.claimed(t_8sp), '0');
  perform pg_temp.rec('2b tentativas = 1 em todas',
    (select string_agg(distinct attempts::text, ',') from public.email_outbox where school_id = s_x), '1');

  -- 3. Payload (reivindicação filtrada para o admin, 1º item)
  delete from public.email_outbox where school_id = s_x;
  perform pg_temp.rec('3a payload traz nome da escola e e-mail',
    (select ((it ->> 'school_name') || '|' || (it ->> 'to_email') = 'Escola Teste S4a X|' || e_admin)::text
       from (select (public.claim_notification_emails(t_8sp, 40, array[e_admin])) -> 0 as it) q), 'true');
  delete from public.email_outbox where school_id = s_x;

  -- 4. Resultado e tentativas
  perform pg_temp.claimed(t_8sp);                                   -- 3 linhas 'sending'
  select id into id_ad_over from public.email_outbox where user_id = u_admin and event = 'tuition_overdue';
  select id into id_fin_over from public.email_outbox where user_id = u_fin   and event = 'tuition_overdue';
  perform public.mark_email_result(id_ad_over, 'sent', 're_123', null);
  perform pg_temp.rec('4a sent grava id do provedor e sent_at',
    (select (status = 'sent' and provider_message_id = 're_123' and sent_at is not null)::text
       from public.email_outbox where id = id_ad_over), 'true');
  begin
    perform public.mark_email_result(id_fin_over, 'xyz');
    perform pg_temp.rec('4b status inválido falha', 'sem erro', 'ERR:22023');
  exception when others then
    perform pg_temp.rec('4b status inválido falha', 'ERR:' || sqlstate, 'ERR:22023');
  end;
  perform public.mark_email_result(id_fin_over, 'failed', null, 'boom');
  perform pg_temp.rec('4c failed grava o erro', (select last_error from public.email_outbox where id = id_fin_over), 'boom');
  perform pg_temp.rec('4d failed com 1 tentativa volta à fila', pg_temp.claimed(t_8sp), '1');
  perform pg_temp.rec('4e tentativas = 2 após o reenvio', (select attempts::text from public.email_outbox where id = id_fin_over), '2');
  perform public.mark_email_result(id_fin_over, 'failed', null, 'boom 2');
  perform pg_temp.rec('4f falha com 2 tentativas volta (3ª)', pg_temp.claimed(t_8sp), '1');
  perform public.mark_email_result(id_fin_over, 'failed', null, 'boom 3');
  perform pg_temp.rec('4g falha com 3 tentativas NÃO volta mais', pg_temp.claimed(t_8sp), '0');
  perform public.mark_email_result(id_ad_over, 'failed', null, 'tardio');   -- já 'sent': resultado tardio não sobrescreve
  perform pg_temp.rec('4h resultado tardio não altera linha que não está em sending',
    (select status from public.email_outbox where id = id_ad_over), 'sent');

  -- 5. 'sending' parado volta; recente não
  select id into id_ad_re from public.email_outbox where user_id = u_admin and event = 'reenrollment';
  perform pg_temp.rec('5a sending recente não volta', pg_temp.claimed(t_8sp), '0');
  alter table public.email_outbox disable trigger update_email_outbox_updated_at;
  update public.email_outbox set updated_at = now() - interval '1 hour' where id = id_ad_re;
  alter table public.email_outbox enable trigger update_email_outbox_updated_at;
  perform pg_temp.rec('5b sending parado há 1h volta', pg_temp.claimed(t_8sp), '1');
  perform pg_temp.rec('5c tentativas = 2 após o reclaim', (select attempts::text from public.email_outbox where id = id_ad_re), '2');

  -- 6. Fuso: financeiro em Honolulu
  delete from public.email_outbox where school_id = s_x;
  update public.notification_settings set timezone = 'Pacific/Honolulu' where user_id = u_fin;
  perform pg_temp.rec('6a Honolulu 01:00 locais: fin não recebe (admin sim: 2)', pg_temp.claimed(t_8sp), '2');
  perform pg_temp.rec('6b Honolulu 08:00 locais: fin recebe', pg_temp.claimed(t_8hnl), '1');
  update public.notification_settings set timezone = 'America/Sao_Paulo' where user_id = u_fin;

  -- 7. Só o aviso do próprio dia
  delete from public.email_outbox where school_id = s_x;
  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
    values (s_x, u_fin, 'tuition_due', true, true, 3);
  insert into public.notifications (school_id, user_id, event, reference_date, offset_days, item_count, total_amount, details)
    values (s_x, u_fin, 'tuition_due', d - 1, 3, 2, 100, '{"class_count": 1}');   -- aviso de ONTEM
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('7a aviso de ontem nunca vira e-mail',
    (select count(*)::text from public.email_outbox where user_id = u_fin and event = 'tuition_due'), '0');

  -- 8. Sem confirmed_at
  delete from public.email_outbox where school_id = s_x;
  update public.notification_settings set confirmed_at = null where user_id = u_fin;
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('8a tela não confirmada: sem e-mail', (select count(*)::text from public.email_outbox where user_id = u_fin), '0');
  update public.notification_settings set confirmed_at = now() where user_id = u_fin;

  -- 9. Canal e-mail desligado / sem linha de preferência
  delete from public.email_outbox where school_id = s_x;
  update public.notification_preferences set email = false where user_id = u_fin and event = 'tuition_overdue';
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('9a email = false: sem e-mail', (select count(*)::text from public.email_outbox where user_id = u_fin), '0');
  update public.notification_preferences set email = true where user_id = u_fin and event = 'tuition_overdue';
  delete from public.notification_preferences where user_id = u_fin and event = 'tuition_overdue';
  delete from public.email_outbox where school_id = s_x;
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('9b sem linha de preferência: sem e-mail', (select count(*)::text from public.email_outbox where user_id = u_fin), '0');
  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days)
    values (s_x, u_fin, 'tuition_overdue', true, true, 5);

  -- 10. E-mail não confirmado
  delete from public.email_outbox where school_id = s_x;
  update auth.users set email_confirmed_at = null where id = u_fin;
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('10a e-mail não confirmado: sem envio', (select count(*)::text from public.email_outbox where user_id = u_fin), '0');
  update auth.users set email_confirmed_at = now() where id = u_fin;

  -- 11. Papel atual
  delete from public.email_outbox where school_id = s_x;
  update public.user_roles set role = 'teacher' where user_id = u_fin;
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('11a financeiro virou professor: sem envio', (select count(*)::text from public.email_outbox where user_id = u_fin), '0');
  update public.user_roles set role = 'financial' where user_id = u_fin;

  -- 12. Allowlist e limite
  delete from public.email_outbox where school_id = s_x;
  perform pg_temp.rec('12a allowlist (case-insensitive) só deixa passar o admin: 2', pg_temp.claimed(t_8sp, array[upper(e_admin)]), '2');
  delete from public.email_outbox where school_id = s_x;
  perform pg_temp.rec('12b p_limit = 1 devolve 1', (select jsonb_array_length(public.claim_notification_emails(t_8sp, 1))::text), '1');
  begin
    perform public.claim_notification_emails(t_8sp, 0);
    perform pg_temp.rec('12c p_limit = 0 falha', 'sem erro', 'ERR:22023');
  exception when others then
    perform pg_temp.rec('12c p_limit = 0 falha', 'ERR:' || sqlstate, 'ERR:22023');
  end;

  -- 13. Permissões e RLS
  perform pg_temp.rec('13a usuário comum não chama o RPC', pg_temp.run_as(u_admin, 'aal1',
    'select public.claim_notification_emails()::text'), 'ERR:42501');
  delete from public.email_outbox where school_id = s_x;
  perform pg_temp.claimed(t_8sp);
  perform pg_temp.rec('13b admin vê só as próprias linhas na fila', pg_temp.run_as(u_admin, 'aal1',
    'select count(*)::text from public.email_outbox'),
    (select count(*)::text from public.email_outbox where user_id = u_admin));
  perform pg_temp.rec('13c admin não vê linhas do financeiro', pg_temp.run_as(u_admin, 'aal1', format(
    'select count(*)::text from public.email_outbox where user_id = %L', u_fin)), '0');
  perform pg_temp.rec('13d INSERT direto na fila falha', pg_temp.run_as(u_admin, 'aal1', format(
    $q$with x as (insert into public.email_outbox (school_id, user_id, event, reference_date, status)
       values (%L, auth.uid(), 'tuition_due', current_date, 'sent') returning 1) select count(*)::text from x$q$, s_x)), 'ERR:42501');
  perform pg_temp.rec('13e UPDATE direto não afeta', pg_temp.run_as(u_admin, 'aal1',
    'with x as (update public.email_outbox set status = ''sent'' where user_id = auth.uid() returning 1) select count(*)::text from x'), '0');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
