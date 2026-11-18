-- Matriz do gerador de notificações (S3, etapa 1).
-- Spec: docs/superpowers/specs/2026-11-18-gerador-notificacoes-design.md
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste.
-- ATENÇÃO: roda contra PRODUÇÃO, cria uma escola de teste, move dois usuários de teste para ela,
-- muda papéis e roda o gerador para TODAS as escolas dentro da transação — NUNCA remova o "rollback;" do final.
--
-- Como rodar:
--   Migration já aplicada:  npx supabase@2.117.0 db query --linked -f supabase/tests/notifications_matrix.sql
--   Migration NÃO aplicada: gerar um arquivo que troca a linha marcadora MIGRATION (abaixo, sozinha na linha)
--     pelo conteúdo de supabase/migrations/20261118150000_notifications_generator.sql e rodar esse arquivo.
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

-- linha de um aviso do usuário/evento como texto comparável
create function pg_temp.notif(p_uid uuid, p_event text) returns text language sql as $f$
  select coalesce((
    select item_count::text || '|' || coalesce(total_amount::numeric(12,2)::text, '-') || '|' || details::text
      from public.notifications where user_id = p_uid and event = p_event
     order by reference_date desc limit 1), 'none')
$f$;

do $$
declare
  u_master uuid := '52d00ab5-567f-4537-b33a-22c2bd44e14d'; -- master + owner + admin, Colegio Teste
  u_admin  uuid := 'e0185312-eea9-4273-a9a8-ad9d575d4781'; -- admin, Colegio Teste (movido para a escola X)
  u_fin    uuid := 'b7ba4eb2-c7a2-4129-83a8-de8e7175c446'; -- financeiro, Colegio Teste (movido para a escola X)
  c_now    timestamptz := '2031-03-10 08:00:00+00';       -- 05:00 em São Paulo → "hoje" = 2031-03-10
  d        date := date '2031-03-10';
  s_x uuid; s_y uuid; cly uuid; sty uuid; ky uuid; caty uuid; rny uuid; cl1 uuid; cl2 uuid; st uuid; k1 uuid; k2 uuid; k3 uuid; cat uuid; rn uuid;
  v text; v_id uuid;
begin
  perform set_config('request.jwt.claims', '', true);

  -- Escola de teste isolada: contagens exatas, sem dados reais misturados.
  insert into public.schools (name, owner_user_id) values ('Escola Teste Notificações', u_master) returning id into s_x;
  update public.profiles set school_id = s_x where user_id in (u_admin, u_fin);
  delete from auth.mfa_factors where user_id in (u_admin, u_fin);
  delete from public.mfa_grace  where user_id in (u_admin, u_fin);
  delete from public.notification_preferences where user_id in (u_admin, u_fin);
  delete from public.notification_settings    where user_id in (u_admin, u_fin);
  delete from public.notifications            where user_id in (u_admin, u_fin);

  insert into public.classes (name, school_id) values ('Turma A', s_x) returning id into cl1;
  insert into public.classes (name, school_id) values ('Turma B', s_x) returning id into cl2;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Teste', date '2015-01-01', s_x) returning id into st;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount)
    values (st, cl1, s_x, date '2031-01-01', d + 45, 'active', 100) returning id into k1;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount)
    values (st, cl2, s_x, date '2031-01-01', d + 45, 'active', 200) returning id into k2;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, renewed_from_id)
    values (st, cl2, s_x, d + 46, d + 400, 'active', 200, k2) returning id into k3;   -- renova k2

  -- tuition_due (N=3): 2 itens, R$ 300, 2 turmas. Pago e cancelado não contam.
  insert into public.tuitions (student_id, contract_id, school_id, description, amount, due_date, status) values
    (st, k1, s_x, 'Mensalidade', 100, d + 3, 'pending'),
    (st, k2, s_x, 'Mensalidade', 200, d + 3, 'pending'),
    (st, k1, s_x, 'Mensalidade', 999, d + 3, 'paid'),
    (st, k1, s_x, 'Mensalidade', 999, d + 3, 'cancelled'),
    (st, k1, s_x, 'Mensalidade',  10, d + 5, 'pending');   -- só para quem usa N=5 (caso 4)
  -- tuition_overdue (N=5, acumulado): d-6 (R$ 50) e d-20 (final_amount R$ 70) contam; d-5 não (exatamente N).
  insert into public.tuitions (student_id, contract_id, school_id, description, amount, final_amount, due_date, status) values
    (st, k1, s_x, 'Mensalidade',  50, null, d - 6,  'overdue'),
    (st, k1, s_x, 'Mensalidade',  60,   70, d - 20, 'overdue'),
    (st, k1, s_x, 'Mensalidade', 999, null, d - 5,  'overdue');
  -- renegotiation_installment (N=1): 1 parcela de R$ 80.
  insert into public.renegotiations (student_id, school_id, original_amount, new_installment_amount, installments, total_renegotiated, first_due_date)
    values (st, s_x, 160, 80, 2, 160, d + 1) returning id into rn;
  insert into public.tuitions (student_id, school_id, description, amount, due_date, status, renegotiation_id) values
    (st, s_x, 'Parcela 1/2', 80, d + 1, 'pending', rn);
  -- expense_due (N=2): 1 despesa "Aluguel" R$ 4200; paga não conta.
  insert into public.expense_categories (school_id, name) values (s_x, 'Infraestrutura') returning id into cat;
  insert into public.expenses (school_id, category_id, description, amount, due_date, status) values
    (s_x, cat, 'Aluguel', 4200, d + 2, 'pending'),
    (s_x, cat, 'Luz', 300, d + 2, 'paid');

  -- Escola Y (decoys): mesmas datas, valores 7777, sem nenhum destinatário. Se algum filtro de school_id
  -- sumir do gerador, os totais/contagens de 1a-1e e 5b da escola X vazam e quebram.
  insert into public.schools (name, owner_user_id) values ('Escola Teste Notificações Y', u_master) returning id into s_y;
  insert into public.classes (name, school_id) values ('Turma Y', s_y) returning id into cly;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Y', date '2015-01-01', s_y) returning id into sty;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount)
    values (sty, cly, s_y, date '2031-01-01', d + 45, 'active', 7777) returning id into ky;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, renewed_from_id)
    values (sty, cly, s_y, d + 46, d + 400, 'active', 7777, k1);   -- aponta para o contrato da escola X
  insert into public.tuitions (student_id, contract_id, school_id, description, amount, due_date, status) values
    (sty, ky, s_y, 'Mensalidade', 7777, d + 3, 'pending'),
    (sty, ky, s_y, 'Mensalidade', 7777, d - 6, 'overdue');
  insert into public.renegotiations (student_id, school_id, original_amount, new_installment_amount, installments, total_renegotiated, first_due_date)
    values (sty, s_y, 7777, 7777, 1, 7777, d + 1) returning id into rny;
  insert into public.tuitions (student_id, school_id, description, amount, due_date, status, renegotiation_id) values
    (sty, s_y, 'Parcela 1/1', 7777, d + 1, 'pending', rny);
  insert into public.expense_categories (school_id, name) values (s_y, 'Infraestrutura Y') returning id into caty;
  insert into public.expenses (school_id, category_id, description, amount, due_date, status) values
    (s_y, caty, 'Aluguel Y', 7777, d + 2, 'pending');

  -- caso 3/4: financeiro desliga despesas no sistema e usa N=5 em mensalidade a vencer
  insert into public.notification_preferences (school_id, user_id, event, in_app, email, offset_days) values
    (s_x, u_fin, 'expense_due', false, false, 2),
    (s_x, u_fin, 'tuition_due', true, false, 5);

  perform public.generate_daily_notifications(c_now);

  -- 1. Cada evento para o admin (padrões)
  perform pg_temp.rec('1a admin tuition_due',     pg_temp.notif(u_admin, 'tuition_due'),     '2|300.00|{"class_count": 2}');
  perform pg_temp.rec('1b admin tuition_overdue', pg_temp.notif(u_admin, 'tuition_overdue'), '2|120.00|{"class_count": 1}');
  perform pg_temp.rec('1c admin renegotiation',   pg_temp.notif(u_admin, 'renegotiation_installment'), '1|80.00|{}');
  perform pg_temp.rec('1d admin expense_due',     pg_temp.notif(u_admin, 'expense_due'),     '1|4200.00|{"description": "Aluguel"}');
  perform pg_temp.rec('1e admin reenrollment',    pg_temp.notif(u_admin, 'reenrollment'),    '2|-|{"renewed_count": 1}');
  perform pg_temp.rec('1f reference_date = hoje SP',
    (select string_agg(distinct reference_date::text, ',') from public.notifications where user_id = u_admin), '2031-03-10');
  perform pg_temp.rec('1g offset_days do padrão gravado',
    (select offset_days::text from public.notifications where user_id = u_admin and event = 'reenrollment'), '45');

  -- 2. Atraso: exatamente N dias não conta (o R$ 999 de d-5 ficou de fora)
  perform pg_temp.rec('2a d-5 fora do acumulado', (pg_temp.notif(u_admin, 'tuition_overdue') not like '%999%')::text, 'true');

  -- 3/4/5. Preferências e papéis
  perform pg_temp.rec('3a financeiro com despesa desligada', pg_temp.notif(u_fin, 'expense_due'), 'none');
  perform pg_temp.rec('4a financeiro com N=5',               pg_temp.notif(u_fin, 'tuition_due'), '1|10.00|{"class_count": 1}');
  perform pg_temp.rec('5a financeiro sem rematrícula',       pg_temp.notif(u_fin, 'reenrollment'), 'none');
  perform pg_temp.rec('5b financeiro recebe atraso',         pg_temp.notif(u_fin, 'tuition_overdue'), '2|120.00|{"class_count": 1}');
  perform pg_temp.rec('5c master não recebe da escola X',
    (select count(*)::text from public.notifications where user_id = u_master and school_id = s_x), '0');

  -- 8. Isolamento: nenhuma linha dos dois usuários fora da escola X
  perform pg_temp.rec('8a linhas só da escola X',
    (select count(*)::text from public.notifications where user_id in (u_admin, u_fin) and school_id <> s_x), '0');

  perform pg_temp.rec('8b escola Y (sem destinatários) não gera linhas',
    (select count(*)::text from public.notifications where school_id = s_y), '0');

  -- 9. RPCs (como usuário, RLS real)
  perform pg_temp.rec('9a list admin: total',  pg_temp.run_as(u_admin, 'aal1', 'select (public.list_notifications()->>''total'')'), '5');
  perform pg_temp.rec('9b list admin: unread', pg_temp.run_as(u_admin, 'aal1', 'select (public.list_notifications()->>''unread'')'), '5');
  perform pg_temp.rec('9c list cobranca',      pg_temp.run_as(u_admin, 'aal1',
    'select (public.list_notifications(0, 20, ''cobranca'')->>''filtered_total'')'), '2');
  perform pg_temp.rec('9d list categoria inválida', pg_temp.run_as(u_admin, 'aal1',
    'select public.list_notifications(0, 20, ''xyz'')::text'), 'ERR:22023:INVALID_CATEGORY');
  perform pg_temp.rec('9e list limite inválido', pg_temp.run_as(u_admin, 'aal1',
    'select public.list_notifications(0, 0)::text'), 'ERR:22023:INVALID_LIMIT');
  perform pg_temp.rec('9f paginação: 2 itens com limit 2', pg_temp.run_as(u_admin, 'aal1',
    'select jsonb_array_length(public.list_notifications(0, 2)->''items'')::text'), '2');
  v_id := (select id from public.notifications where user_id = u_admin and event = 'tuition_due');
  perform pg_temp.rec('9g financeiro não marca aviso do admin', pg_temp.run_as(u_fin, 'aal1',
    format('select public.mark_notifications_read(array[%L]::uuid[])::text', v_id)), '0');
  perform pg_temp.rec('9h admin marca o próprio', pg_temp.run_as(u_admin, 'aal1',
    format('select public.mark_notifications_read(array[%L]::uuid[])::text', v_id)), '1');
  perform pg_temp.rec('9i unread caiu para 4', pg_temp.run_as(u_admin, 'aal1', 'select (public.list_notifications()->>''unread'')'), '4');
  perform pg_temp.rec('9j financeiro só vê os próprios', pg_temp.run_as(u_fin, 'aal1',
    format('select count(*)::text from public.notifications where user_id = %L', u_admin)), '0');

  -- 10. Escrita direta bloqueada
  perform pg_temp.rec('10a INSERT direto falha', pg_temp.run_as(u_admin, 'aal1', format(
    $q$with x as (insert into public.notifications (school_id, user_id, event, reference_date, offset_days, item_count)
       values (%L, auth.uid(), 'tuition_due', current_date, 3, 1) returning 1) select count(*)::text from x$q$, s_x)), 'ERR:42501');
  perform pg_temp.rec('10b UPDATE direto não afeta', pg_temp.run_as(u_admin, 'aal1',
    'with x as (update public.notifications set read_at = now() where user_id = auth.uid() returning 1) select count(*)::text from x'), '0');

  -- 9. Gate de 2FA nos RPCs
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_x;
  delete from public.mfa_grace where user_id in (u_admin, u_fin);
  perform pg_temp.rec('9k admin aal1 sem carência bloqueado', pg_temp.run_as(u_admin, 'aal1',
    'select public.list_notifications()::text'), 'ERR:42501:MFA_REQUIRED');
  perform pg_temp.rec('9l financeiro passa', pg_temp.run_as(u_fin, 'aal1',
    'select (public.list_notifications()->>''total'')'), '3');
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = false where id = s_x;

  -- 6. Idempotência
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('6a reexecução não duplica',
    (select count(*)::text from public.notifications where user_id = u_admin), '5');
  perform pg_temp.rec('6b read_at preservado',
    (select (read_at is not null)::text from public.notifications where id = v_id), 'true');
  update public.tuitions set status = 'paid' where school_id = s_x and due_date = d + 3;   -- zera tuition_due (o lido)
  update public.expenses set status = 'paid' where school_id = s_x;                       -- zera expense_due (não lido)
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('6c zerado e lido: mantém',
    (select count(*)::text from public.notifications where id = v_id), '1');
  perform pg_temp.rec('6d zerado e não lido: apaga', pg_temp.notif(u_admin, 'expense_due'), 'none');

  -- 5. Papel atual: admin rebaixado a financeiro perde a rematrícula não lida; professor não recebe nada
  update public.user_roles set role = 'financial' where user_id = u_admin;
  update public.user_roles set role = 'teacher'   where user_id = u_fin;
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('5d rebaixado sem rematrícula', pg_temp.notif(u_admin, 'reenrollment'), 'none');
  perform pg_temp.rec('5e professor sem avisos novos (não lidos apagados)',
    (select count(*)::text from public.notifications where user_id = u_fin and read_at is null), '0');
  update public.user_roles set role = 'admin'     where user_id = u_admin;
  update public.user_roles set role = 'financial' where user_id = u_fin;

  -- 7. Fuso: financeiro em Honolulu (UTC-10) → "hoje" = 2031-03-09
  delete from public.notifications where user_id = u_fin;
  insert into public.notification_settings (school_id, user_id, timezone) values (s_x, u_fin, 'Pacific/Honolulu');
  perform public.generate_daily_notifications(c_now);
  perform pg_temp.rec('7a reference_date no fuso do usuário',
    (select string_agg(distinct reference_date::text, ',') from public.notifications where user_id = u_fin), '2031-03-09');
  perform pg_temp.rec('7b atraso calculado no "hoje" dele', pg_temp.notif(u_fin, 'tuition_overdue'), '1|70.00|{"class_count": 1}');

  -- 11. Job agendado
  perform pg_temp.rec('11a job às 08:00 UTC',
    (select schedule from cron.job where jobname = 'generate-daily-notifications'), '0 8 * * *');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
