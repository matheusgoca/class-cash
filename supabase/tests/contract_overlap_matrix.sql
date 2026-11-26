-- supabase/tests/contract_overlap_matrix.sql
-- Matriz da trava de contrato ativo sobreposto nos RPCs (S6b, bloco C2). Migration: 20261126130000_contract_overlap_guard.sql.
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste. NUNCA remova o "rollback;" do final.
-- ATENÇÃO: roda contra PRODUÇÃO, cria escolas de teste, move dois usuários de teste para a escola X, muda papéis dentro da
-- transação. Não rodar perto das 08:00 UTC. Personas por consulta; sem UUIDs nem nomes de escola fixos.
-- Migration ainda NÃO aplicada: trocar a linha marcadora MIGRATION (sozinha na linha) pelo conteúdo da migration.
-- Migration já aplicada: npx supabase@2.117.0 db query --linked -f supabase/tests/contract_overlap_matrix.sql
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

-- import_contract como o usuário: devolve o id (texto) ou o erro
create function pg_temp.imp(p_uid uuid, p_school uuid, p_student uuid, p_start date, p_end date, p_status text default 'active') returns text language sql as $f$
  select pg_temp.run_as(p_uid, 'aal1', format($q$select public.import_contract(%L::jsonb, %L)::text$q$,
    json_build_object('student_id', p_student, 'monthly_amount', 500, 'discount', 0, 'due_day', 10, 'start_date', p_start, 'end_date', p_end, 'status', p_status)::text, p_school))
$f$;

create function pg_temp.ok_id(p text) returns text language sql as $f$ select case when p ~ '^[0-9a-f-]{36}$' then 'ok' else p end $f$;

create function pg_temp.rowsn(p_start date, p_n int, p_amount numeric) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object('due_date', (date_trunc('month', p_start) + make_interval(months => g) + interval '9 days')::date,
                                      'amount', p_amount, 'status', 'pending', 'description', 'Mensalidade ' || (g + 1)) order by g)
    from generate_series(0, p_n - 1) g
$f$;

create function pg_temp.mkc(p_school uuid, p_student uuid, p_start date, p_end date, p_status text default 'active') returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.contracts (student_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (p_student, 'meio_periodo', p_start, p_end, 500, 0, 10, p_status, p_school) returning id into v;
  return v;
end $f$;

create function pg_temp.mks(p_school uuid, p_name text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.students (full_name, birth_date, school_id) values (p_name, date '2015-01-01', p_school) returning id into v;
  return v;
end $f$;

-- renova um contrato como o usuário: 'renovados/mensalidades' ou o erro
create function pg_temp.renew(p_uid uuid, p_school uuid, p_src uuid, p_start date, p_end date) returns text language sql as $f$
  select pg_temp.run_as(p_uid, 'aal1', format($q$select (r->>'renewed') || '/' || (r->>'tuitions') from (select public.renew_contracts(%L, %L::jsonb) r) z$q$, p_school,
    jsonb_build_array(jsonb_build_object('source_contract_id', p_src, 'class_id', null, 'monthly_amount', 500, 'start_date', p_start, 'end_date', p_end,
                                          'tuitions', pg_temp.rowsn(p_start, 12, 500)))::text))
$f$;

do $$
declare
  u_master uuid; u_admin uuid; u_fin uuid; s_orig uuid; s_x uuid;
  a uuid; b uuid; d uuid; e uuid; c uuid; kc uuid; kx uuid; v text; v_role text;
begin
  perform set_config('request.jwt.claims', '', true);
  select p.user_id, p.school_id into u_master, s_orig from public.profiles p where p.is_master_admin and p.school_id is not null order by p.user_id limit 1;
  select p.user_id into u_admin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_orig and not p.is_master_admin and r.role = 'admin' order by p.user_id limit 1;
  select p.user_id into u_fin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_orig and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  if u_master is null or u_admin is null or u_fin is null then raise exception 'personagens nao encontrados'; end if;

  insert into public.schools (name, owner_user_id) values ('Escola Teste Sobreposicao X', u_master) returning id into s_x;
  update public.profiles set school_id = s_x where user_id in (u_admin, u_fin);
  delete from auth.mfa_factors where user_id in (u_admin, u_fin);
  delete from public.mfa_grace where user_id in (u_admin, u_fin);
  perform set_config('app.audit_source', '', true);
  a := pg_temp.mks(s_x, 'Aluno A'); b := pg_temp.mks(s_x, 'Aluno B'); d := pg_temp.mks(s_x, 'Aluno D'); e := pg_temp.mks(s_x, 'Aluno E'); c := pg_temp.mks(s_x, 'Aluno C');

  -- 1. import_contract ---------------------------------------------------------------------------------------------
  perform pg_temp.rec('1a 1º contrato ativo do aluno entra', pg_temp.ok_id(pg_temp.imp(u_admin, s_x, a, date '2031-01-01', date '2031-12-31')), 'ok');
  perform pg_temp.rec('1b ativo que se sobrepõe parcialmente: OVERLAP', pg_temp.imp(u_admin, s_x, a, date '2031-06-01', date '2032-05-31'), 'ERR:22023:OVERLAP');
  perform pg_temp.rec('1c ativo contido no período: OVERLAP', pg_temp.imp(u_admin, s_x, a, date '2031-03-01', date '2031-04-30'), 'ERR:22023:OVERLAP');
  perform pg_temp.rec('1d ativo que contém o período: OVERLAP', pg_temp.imp(u_admin, s_x, a, date '2030-06-01', date '2032-06-30'), 'ERR:22023:OVERLAP');
  perform pg_temp.rec('1e começa no mesmo dia em que o outro termina: OVERLAP (limites inclusivos)', pg_temp.imp(u_admin, s_x, a, date '2031-12-31', date '2032-12-30'), 'ERR:22023:OVERLAP');
  perform pg_temp.rec('1f começa no dia seguinte ao fim do outro: entra', pg_temp.ok_id(pg_temp.imp(u_admin, s_x, a, date '2032-01-01', date '2032-12-31')), 'ok');
  perform pg_temp.rec('1g termina no dia anterior ao início do outro: entra', pg_temp.ok_id(pg_temp.imp(u_admin, s_x, a, date '2030-01-01', date '2030-12-31')), 'ok');
  perform pg_temp.rec('1h linha "suspended" sobreposta passa (não cobra)', pg_temp.ok_id(pg_temp.imp(u_admin, s_x, a, date '2031-02-01', date '2031-03-31', 'suspended')), 'ok');
  perform pg_temp.rec('1i linha "cancelled" sobreposta passa', pg_temp.ok_id(pg_temp.imp(u_admin, s_x, a, date '2031-02-01', date '2031-03-31', 'cancelled')), 'ok');
  perform pg_temp.rec('1j outro aluno, mesmo período: entra', pg_temp.ok_id(pg_temp.imp(u_admin, s_x, b, date '2031-01-01', date '2031-12-31')), 'ok');
  perform pg_temp.mkc(s_x, d, date '2031-01-01', date '2031-12-31', 'suspended');
  perform pg_temp.rec('1k contrato existente SUSPENSO não bloqueia um ativo no mesmo período', pg_temp.ok_id(pg_temp.imp(u_admin, s_x, d, date '2031-01-01', date '2031-12-31')), 'ok');
  perform pg_temp.mkc(s_x, e, date '2031-01-01', date '2031-12-31', 'cancelled');
  perform pg_temp.rec('1l contrato existente CANCELADO não bloqueia um ativo no mesmo período', pg_temp.ok_id(pg_temp.imp(u_admin, s_x, e, date '2031-01-01', date '2031-12-31')), 'ok');
  perform pg_temp.rec('1m as recusas não criaram nada (aluno A: 3 ativos de períodos distintos, 1 suspenso, 1 cancelado)',
    (select count(*) filter (where status = 'active')::text || '/' || count(*) filter (where status = 'suspended')::text || '/' || count(*) filter (where status = 'cancelled')::text from public.contracts where student_id = a), '3/1/1');
  perform pg_temp.rec('1n financeiro também é barrado', pg_temp.imp(u_fin, s_x, a, date '2031-06-01', date '2032-05-31'), 'ERR:22023:OVERLAP');
  update public.user_roles set role = 'teacher' where user_id = u_fin;
  perform pg_temp.rec('1o professor segue negado (permissão checada antes)', pg_temp.imp(u_fin, s_x, b, date '2040-01-01', date '2040-12-31'), 'ERR:P0001:Sem permissão');
  update public.user_roles set role = 'financial' where user_id = u_fin;
  perform pg_temp.rec('1p o helper contract_overlaps é interno: usuário comum não executa',
    case when pg_temp.run_as(u_admin, 'aal1', format($q$select public.contract_overlaps(%L, %L, date '2031-01-01', date '2031-12-31')::text$q$, s_x, a)) like 'ERR:42501%' then 'negado' else 'executou' end, 'negado');

  -- 2. renew_contracts -------------------------------------------------------------------------------------------------
  kc := pg_temp.mkc(s_x, c, date '2031-01-01', date '2031-12-31');                           -- origem
  kx := pg_temp.mkc(s_x, c, date '2032-06-01', date '2033-05-31');                           -- outro contrato ativo, futuro
  perform pg_temp.rec('2a sucessor que se sobrepõe a OUTRO ativo do aluno: INVALID_ITEM',
    pg_temp.renew(u_admin, s_x, kc, date '2032-01-01', date '2032-12-31'), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2b ...e nenhum sucessor foi criado', (select count(*)::text from public.contracts where renewed_from_id = kc), '0');
  update public.contracts set status = 'suspended' where id = kx;
  perform pg_temp.rec('2c com o outro contrato SUSPENSO a renovação passa (1 contrato, 12 mensalidades)', pg_temp.renew(u_admin, s_x, kc, date '2032-01-01', date '2032-12-31'), '1/12');
  perform pg_temp.rec('2d o sucessor começa depois do fim da origem e não conflita com ela (origem fora da checagem)',
    (select (start_date = date '2032-01-01' and status = 'active')::text from public.contracts where renewed_from_id = kc), 'true');
  update public.contracts set status = 'active' where id = kx;
  perform pg_temp.rec('2e reativar o outro contrato por UPDATE direto não é barrado pelo banco (dívida registrada; o front valida)', (select status from public.contracts where id = kx), 'active');
  perform pg_temp.rec('2f renovar de novo a mesma origem: ignorado (nada duplica)', pg_temp.renew(u_admin, s_x, kc, date '2032-01-01', date '2032-12-31'), '0/0');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
