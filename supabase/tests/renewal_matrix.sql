-- supabase/tests/renewal_matrix.sql
-- Matriz da rematrícula (S4c, etapa 1). Spec: docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste.
-- ATENÇÃO: roda contra PRODUÇÃO, cria duas escolas de teste, move dois usuários de teste para a escola X,
-- muda papéis e liga/desliga require_2fa dentro da transação — NUNCA remova o "rollback;" do final.
-- Não rodar perto das 08:00 UTC.
--
-- Como rodar (migrations ainda NÃO aplicadas): gerar um arquivo que troca a linha marcadora MIGRATION
-- (sozinha na linha) pelo conteúdo, em ordem, de 20261119140000_renewal_decisions.sql,
-- 20261119140100_set_renewal_decision.sql e (depois da Task 2) 20261119140200_renew_contracts.sql.
-- Migrations já aplicadas: npx supabase@2.117.0 db query --linked -f supabase/tests/renewal_matrix.sql
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

-- chama set_renewal_decision como o usuário e devolve '1' (ok) ou o erro
create function pg_temp.decide(p_uid uuid, p_contract uuid, p_status text, p_reason text default null, p_note text default null)
returns text language sql as $f$
  select pg_temp.run_as(p_uid, 'aal1',
    format('select count(*)::text from (select public.set_renewal_decision(%L, %L, %L, %L)) x',
           p_contract, p_status, p_reason, p_note))
$f$;

do $$
declare
  u_master uuid := '52d00ab5-567f-4537-b33a-22c2bd44e14d'; -- master + owner + admin, Colegio Teste
  u_admin  uuid := 'e0185312-eea9-4273-a9a8-ad9d575d4781'; -- admin (movido para a escola X)
  u_fin    uuid := 'b7ba4eb2-c7a2-4129-83a8-de8e7175c446'; -- financeiro (movido para a escola X)
  s_x uuid; s_y uuid; cl1 uuid; cl2 uuid; cly uuid; st uuid; sty uuid;
  k1 uuid; k2 uuid; k3 uuid; k4 uuid; k5 uuid; k6 uuid; kdead uuid; ky uuid;
  svc uuid; svc_m uuid; svc_off uuid; svcy uuid;
  v text; r jsonb; item jsonb; v_role text;
begin
  perform set_config('request.jwt.claims', '', true);

  -- Escolas de teste isoladas.
  insert into public.schools (name, owner_user_id) values ('Escola Teste Rematrícula X', u_master) returning id into s_x;
  insert into public.schools (name, owner_user_id) values ('Escola Teste Rematrícula Y', u_master) returning id into s_y;
  update public.profiles set school_id = s_x where user_id in (u_admin, u_fin);
  delete from auth.mfa_factors where user_id in (u_admin, u_fin);
  delete from public.mfa_grace  where user_id in (u_admin, u_fin);

  insert into public.classes (name, school_id) values ('Turma 1', s_x) returning id into cl1;
  insert into public.classes (name, school_id) values ('Turma 2', s_x) returning id into cl2;
  insert into public.classes (name, school_id) values ('Turma Y', s_y) returning id into cly;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Teste', date '2015-01-01', s_x) returning id into st;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Y', date '2015-01-01', s_y) returning id into sty;

  -- Contratos de origem (todos terminam em 2031-02-28; o sucessor começa em 2031-03-01).
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 100, 10, 5, 'integral') returning id into k1;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 200, 0, 10, 'meio_periodo') returning id into k2;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 300, 0, 10, 'meio_periodo') returning id into k3;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 400, 0, 10, 'meio_periodo') returning id into k4;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 500, 0, 10, 'meio_periodo') returning id into k5;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'active', 600, 0, 10, 'meio_periodo') returning id into k6;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl1, s_x, date '2030-03-01', date '2031-02-28', 'cancelled', 100, 0, 10, 'meio_periodo') returning id into kdead;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (sty, cly, s_y, date '2030-03-01', date '2031-02-28', 'active', 100, 0, 10, 'meio_periodo') returning id into ky;

  insert into public.school_services (school_id, name, price, type, active) values (s_x, 'Taxa de rematrícula', 150, 'avulso', true) returning id into svc;
  insert into public.school_services (school_id, name, price, type, active) values (s_x, 'Mensalidade extra', 80, 'mensal', true) returning id into svc_m;
  insert into public.school_services (school_id, name, price, type, active) values (s_x, 'Taxa antiga', 90, 'avulso', false) returning id into svc_off;
  insert into public.school_services (school_id, name, price, type, active) values (s_y, 'Taxa Y', 70, 'avulso', true) returning id into svcy;

  -- 1. set_renewal_decision ---------------------------------------------------------------
  perform pg_temp.rec('1a admin marca "contatado"', pg_temp.decide(u_admin, k1, 'contacted'), '1');
  perform pg_temp.rec('1b linha gravada com autor e sem motivo',
    (select (status = 'contacted' and reason is null and decided_by = u_admin and school_id = s_x)::text
       from public.renewal_decisions where contract_id = k1), 'true');
  perform pg_temp.rec('1c auditoria da decisão (source manual)',
    (select string_agg(distinct source, ',') from public.audit_logs
      where table_name = 'renewal_decisions' and school_id = s_x), 'manual');
  perform pg_temp.rec('1d financeiro marca "vai renovar" (R6)', pg_temp.decide(u_fin, k2, 'will_renew'), '1');
  perform pg_temp.rec('1e "não vai renovar" sem motivo falha', pg_temp.decide(u_admin, k3, 'will_not_renew'), 'ERR:22023:REASON_REQUIRED');
  perform pg_temp.rec('1f "não vai renovar" com motivo inválido falha', pg_temp.decide(u_admin, k3, 'will_not_renew', 'xyz'), 'ERR:22023:REASON_REQUIRED');
  perform pg_temp.rec('1g "não vai renovar" com motivo e observação', pg_temp.decide(u_admin, k3, 'will_not_renew', 'price', '  Achou caro  '), '1');
  perform pg_temp.rec('1h motivo e observação (aparada) gravados',
    (select (reason = 'price' and note = 'Achou caro')::text from public.renewal_decisions where contract_id = k3), 'true');
  perform pg_temp.rec('1i motivo enviado com outro estado é ignorado', pg_temp.decide(u_admin, k1, 'will_renew', 'price'), '1');
  perform pg_temp.rec('1j ...e a linha fica sem motivo',
    (select (status = 'will_renew' and reason is null)::text from public.renewal_decisions where contract_id = k1), 'true');
  perform pg_temp.rec('1k mudar de "não vai" para outro estado limpa o motivo', pg_temp.decide(u_admin, k3, 'contacted'), '1');
  perform pg_temp.rec('1l ...motivo some',
    (select (status = 'contacted' and reason is null)::text from public.renewal_decisions where contract_id = k3), 'true');
  perform pg_temp.rec('1m "none" apaga a decisão', pg_temp.decide(u_admin, k3, 'none'), '1');
  perform pg_temp.rec('1n ...linha apagada', (select count(*)::text from public.renewal_decisions where contract_id = k3), '0');
  perform pg_temp.rec('1o um registro por contrato (upsert, não duplica)',
    (select count(*)::text from public.renewal_decisions where contract_id = k1), '1');
  perform pg_temp.rec('1p status inválido', pg_temp.decide(u_admin, k1, 'xyz'), 'ERR:22023:INVALID_STATUS');
  perform pg_temp.rec('1q contrato de outra escola', pg_temp.decide(u_admin, ky, 'contacted'), 'ERR:22023:INVALID_CONTRACT');
  perform pg_temp.rec('1r contrato inexistente', pg_temp.decide(u_admin, gen_random_uuid(), 'contacted'), 'ERR:22023:INVALID_CONTRACT');
  perform pg_temp.rec('1s contrato cancelado', pg_temp.decide(u_admin, kdead, 'contacted'), 'ERR:22023:INVALID_CONTRACT');

  -- Leitura e escrita direta
  perform pg_temp.rec('1t admin lê só as decisões da própria escola', pg_temp.run_as(u_admin, 'aal1',
    'select count(*)::text from public.renewal_decisions'),
    (select count(*)::text from public.renewal_decisions where school_id = s_x));
  perform pg_temp.rec('1u INSERT direto falha', pg_temp.run_as(u_admin, 'aal1', format(
    $q$with x as (insert into public.renewal_decisions (school_id, contract_id, status) values (%L, %L, 'contacted') returning 1) select count(*)::text from x$q$, s_x, k4)), 'ERR:42501');
  perform pg_temp.rec('1v UPDATE direto não afeta', pg_temp.run_as(u_admin, 'aal1',
    'with x as (update public.renewal_decisions set status = ''will_renew'' returning 1) select count(*)::text from x'), '0');
  perform pg_temp.rec('1w anon não executa o RPC',
    has_function_privilege('anon', 'public.set_renewal_decision(uuid,text,text,text)', 'execute')::text, 'false');

  -- Papel: professor é negado
  update public.user_roles set role = 'teacher' where user_id = u_fin;
  perform pg_temp.rec('1x professor é negado', pg_temp.decide(u_fin, k4, 'contacted'), 'ERR:42501:NOT_ALLOWED');
  update public.user_roles set role = 'financial' where user_id = u_fin;

  -- Papel: usuário sem nenhuma linha em user_roles é negado (fail closed)
  select role::text into v_role from public.user_roles where user_id = u_fin;
  delete from public.user_roles where user_id = u_fin;
  perform pg_temp.rec('1x2 usuário sem papel é negado', pg_temp.decide(u_fin, k4, 'contacted'), 'ERR:42501:NOT_ALLOWED');
  insert into public.user_roles (user_id, role) values (u_fin, v_role::public.app_role);

  -- Gate de 2FA
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_x;
  delete from public.mfa_grace where user_id in (u_admin, u_fin);
  perform pg_temp.rec('1y admin aal1 sem carência bloqueado', pg_temp.decide(u_admin, k4, 'contacted'), 'ERR:42501:MFA_REQUIRED');
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = false where id = s_x;

  -- @@PART2@@
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
