-- supabase/tests/renewal_matrix.sql
-- Matriz da rematrícula (S4c, etapa 1). Spec: docs/superpowers/specs/2026-11-19-s4c-rematricula-design.md
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste.
-- ATENÇÃO: roda contra PRODUÇÃO, cria duas escolas de teste, move dois usuários de teste para a escola X,
-- muda papéis e liga/desliga require_2fa dentro da transação — NUNCA remova o "rollback;" do final.
-- Não rodar perto das 08:00 UTC.
--
-- Como rodar (migrations ainda NÃO aplicadas): gerar um arquivo que troca a linha marcadora MIGRATION
-- (sozinha na linha) pelo conteúdo, em ordem, de 20261119135900_audit_source_nullif.sql,
-- 20261119140000_renewal_decisions.sql, 20261119140100_set_renewal_decision.sql e
-- 20261119140200_renew_contracts.sql.
-- Migrations já aplicadas: npx supabase@2.117.0 db query --linked -f supabase/tests/renewal_matrix.sql
-- Saída: uma linha por verificação; "ok" deve ser true em TODAS.

begin;

-- @@MIGRATION@@

create temp table t_res (n serial, cenario text, got text, esperado text, ok boolean);

create function pg_temp.run_as(p_uid uuid, p_aal text, p_sql text)
returns text language plpgsql as $f$
declare v text; v_d text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'aal', p_aal, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v;
  exception when others then
    get stacked diagnostics v_d = pg_exception_detail;
    v := 'ERR:' || sqlstate || ':' || sqlerrm || '|' || coalesce(v_d, '');
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
create function pg_temp.decide(p_uid uuid, p_contract uuid, p_status text, p_reason text default null, p_note text default null,
                               p_aal text default 'aal1')
returns text language sql as $f$
  select pg_temp.run_as(p_uid, p_aal,
    format('select count(*)::text from (select public.set_renewal_decision(%L, %L, %L, %L)) x',
           p_contract, p_status, p_reason, p_note))
$f$;

-- 12 mensalidades mensais a partir de p_start, vencendo em p_due_day, todas com o valor p_amount
create function pg_temp.rows12(p_start date, p_due_day int, p_amount numeric) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object(
           'due_date', (date_trunc('month', p_start) + make_interval(months => g) + make_interval(days => p_due_day - 1))::date,
           'amount', p_amount, 'status', 'pending', 'description', 'Mensalidade ' || (g + 1)))
    from generate_series(0, 11) g
$f$;

-- um item de lote; o contrato novo vai de p_start a p_end (padrão: 2031-03-01 a 2032-02-29)
create function pg_temp.item(p_src uuid, p_class uuid, p_monthly numeric, p_amount numeric, p_due int default 5,
                             p_start date default date '2031-03-01', p_end date default date '2032-02-29')
returns jsonb language sql as $f$
  select jsonb_build_object('source_contract_id', p_src, 'class_id', p_class, 'monthly_amount', p_monthly,
                            'start_date', p_start, 'end_date', p_end, 'tuitions', pg_temp.rows12(p_start, p_due, p_amount))
$f$;

-- chama renew_contracts como o usuário e devolve o jsonb em texto ou o erro
create function pg_temp.renew(p_uid uuid, p_school uuid, p_items jsonb, p_fee uuid default null, p_aal text default 'aal1')
returns text language sql as $f$
  select pg_temp.run_as(p_uid, p_aal,
    format('select public.renew_contracts(%L, %L::jsonb, %L)::text', p_school, p_items::text, p_fee))
$f$;

-- n mensalidades mensais a partir de p_start (mesmo dia do mês), todas com p_amount e p_status
create function pg_temp.rowsn(p_start date, p_n int, p_amount numeric, p_status text default 'pending') returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object('due_date', (p_start + make_interval(months => g))::date,
                                      'amount', p_amount, 'status', p_status, 'description', 'Mensalidade ' || (g + 1)) order by g)
    from generate_series(0, p_n - 1) g
$f$;

-- item de lote com as mensalidades dadas (jsonb) em vez das 12 padrão
create function pg_temp.item_t(p_src uuid, p_class uuid, p_monthly numeric, p_start date, p_end date, p_rows jsonb)
returns jsonb language sql as $f$
  select jsonb_build_object('source_contract_id', p_src, 'class_id', p_class, 'monthly_amount', p_monthly,
                            'start_date', p_start, 'end_date', p_end, 'tuitions', p_rows)
$f$;

-- como renew, mas devolve 'renovados|mensalidades' quando dá certo (e o erro quando não dá), sem quebrar o bloco
create function pg_temp.renew_s(p_uid uuid, p_school uuid, p_items jsonb, p_fee uuid default null, p_aal text default 'aal1')
returns text language sql as $f$
  select case when t like 'ERR:%' then t else (t::jsonb->>'renewed') || '|' || (t::jsonb->>'tuitions') end
    from (select pg_temp.renew(p_uid, p_school, p_items, p_fee, p_aal) as t) x
$f$;

-- contrato ativo de teste que termina em p_end (começa 1 ano antes)
create function pg_temp.mk(p_school uuid, p_student uuid, p_class uuid, p_end date, p_monthly numeric default 100, p_discount numeric default 0)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (p_student, p_class, p_school, (p_end - interval '1 year' + interval '1 day')::date, p_end, 'active', p_monthly, p_discount, 10, 'meio_periodo')
    returning id into v;
  return v;
end $f$;

do $$
declare
  -- personagens: escolhidos por consulta no início do bloco (nenhum id fixo no arquivo)
  u_master uuid; -- master (profiles.is_master_admin); só é dono das escolas de teste
  u_admin  uuid; -- admin, não-master, de uma escola existente (movido para a escola X)
  u_fin    uuid; -- financeiro, não-master, da mesma escola (movido para a escola X)
  s_orig   uuid; -- escola do perfil do master (de onde se escolhem admin e financeiro)
  s_x uuid; s_y uuid; cl1 uuid; cl2 uuid; cly uuid; st uuid; sty uuid;
  k1 uuid; k2 uuid; k3 uuid; k4 uuid; k5 uuid; k6 uuid; kdead uuid; ky uuid;
  svc uuid; svc_m uuid; svc_off uuid; svcy uuid;
  s_z uuid; clz uuid; stz uuid; kz uuid; -- escola de OUTRO dono (seção 3: master em escola alheia)
  h uuid[]; hx uuid; hy uuid; hz uuid; hw uuid; hd uuid; lo uuid; hi uuid; got text; -- seção 4 (endurecimento)
  hk1 uuid; hk2 uuid; hk3 uuid; hk4 uuid; -- seção 5 (item I: final_amount arredondado)
  v text; r jsonb; item jsonb; v_role text;
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

  -- Simula o '' que sobra na conexão do pool depois de uma transação que usou set_config(..., true).
  -- Com o audit_trigger_fn antigo, a primeira escrita auditada abaixo falharia com 23514.
  perform set_config('app.audit_source', '', true);

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
  -- Uma decisão na escola Y (como dono da transação) para o isolamento de 1t não ser vácuo.
  insert into public.renewal_decisions (school_id, contract_id, status) values (s_y, ky, 'contacted');
  perform pg_temp.rec('1t admin lê só as decisões da própria escola', pg_temp.run_as(u_admin, 'aal1',
    'select count(*)::text from public.renewal_decisions'),
    (select count(*)::text from public.renewal_decisions where school_id = s_x));
  update public.user_roles set role = 'teacher' where user_id = u_fin;
  perform pg_temp.rec('1t2 professor não lê decisões', pg_temp.run_as(u_fin, 'aal1',
    'select count(*)::text from public.renewal_decisions'), '0');
  update public.user_roles set role = 'financial' where user_id = u_fin;
  perform pg_temp.rec('1t3 financeiro lê as da escola', pg_temp.run_as(u_fin, 'aal1',
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

  -- Escola: admin sem escola (profiles.school_id NULL) não decide em contrato de outra escola nem da antiga
  update public.profiles set school_id = null where user_id = u_admin;
  perform pg_temp.rec('1x3 admin sem escola não decide em contrato de outra escola',
    pg_temp.decide(u_admin, ky, 'will_not_renew', 'price'), 'ERR:22023:INVALID_CONTRACT');
  perform pg_temp.rec('1x3b ...nem em contrato da escola anterior',
    pg_temp.decide(u_admin, k4, 'contacted'), 'ERR:22023:INVALID_CONTRACT');
  update public.profiles set school_id = s_x where user_id = u_admin;

  -- Gate de 2FA
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_x;
  delete from public.mfa_grace where user_id in (u_admin, u_fin);
  perform pg_temp.rec('1y admin aal1 sem carência bloqueado', pg_temp.decide(u_admin, k4, 'contacted'), 'ERR:42501:MFA_REQUIRED');
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = false where id = s_x;

  -- 2. renew_contracts --------------------------------------------------------------------
  -- 2a. lote válido: k1 reajustada (100 → 110 com desconto 10% = 99,00) e promovida de turma, k2 igual; com taxa
  r := (pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k1, cl2, 110, 99), pg_temp.item(k2, cl1, 200, 200, 10)), svc))::jsonb;
  perform pg_temp.rec('2a lote renova 2 contratos e cria 24 mensalidades, sem pulados',
    (r->>'renewed') || '|' || (r->>'tuitions') || '|' || jsonb_array_length(r->'skipped'), '2|24|0');
  perform pg_temp.rec('2b contrato novo de k1: valores, turma, período e herança',
    (select (monthly_amount = 110 and discount = 10 and due_day = 5 and period = 'integral' and class_id = cl2
             and start_date = date '2031-03-01' and end_date = date '2032-02-29' and status = 'active' and school_id = s_x
             and student_id = st)::text
       from public.contracts where renewed_from_id = k1), 'true');
  perform pg_temp.rec('2c 12 mensalidades do novo k1 a R$ 99,00, final_amount nulo, na escola certa',
    (select count(*)::text from public.tuitions t join public.contracts c on c.id = t.contract_id
      where c.renewed_from_id = k1 and t.amount = 99 and t.final_amount is null and t.school_id = s_x
        and t.student_id = st and t.status = 'pending'), '12');
  perform pg_temp.rec('2d 2 cobranças de taxa de R$ 150 pendentes no início do contrato novo',
    (select count(*)::text from public.service_charges
      where school_id = s_x and service_id = svc and amount = 150 and status = 'pending' and due_date = date '2031-03-01'), '2');
  perform pg_temp.rec('2e auditoria do lote marcada como generated',
    (select string_agg(distinct source, ',') from public.audit_logs
      where table_name = 'tuitions' and school_id = s_x
        and (new_data->>'contract_id')::uuid in (select id from public.contracts where renewed_from_id in (k1, k2))), 'generated');

  -- 2f/2g. já renovado: pulado; lote misto
  r := (pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k1, cl2, 110, 99)), null))::jsonb;
  perform pg_temp.rec('2f origem já renovada é pulada e listada',
    (r->>'renewed') || '|' || (r->'skipped'->0->>'reason'), '0|ALREADY_RENEWED');
  perform pg_temp.rec('2g ...e não criou contrato novo', (select count(*)::text from public.contracts where renewed_from_id = k1), '1');
  r := (pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k1, cl2, 110, 99), pg_temp.item(k3, cl1, 300, 300, 10)), null))::jsonb;
  perform pg_temp.rec('2h lote misto: 1 renovado, 1 pulado',
    (r->>'renewed') || '|' || jsonb_array_length(r->'skipped'), '1|1');
  r := (pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k4, cl1, 400, 400, 10), pg_temp.item(k4, cl1, 400, 400, 10)), null))::jsonb;
  perform pg_temp.rec('2i duplicata no mesmo lote: 1 renovado, 1 pulado',
    (r->>'renewed') || '|' || jsonb_array_length(r->'skipped'), '1|1');
  perform pg_temp.rec('2i2 ...e só um contrato novo foi criado',
    (select count(*)::text from public.contracts where renewed_from_id = k4), '1');

  -- 2j. atomicidade: um item inválido aborta o lote inteiro (k5 válido não pode ser renovado)
  perform pg_temp.rec('2j item inválido aborta o lote inteiro',
    pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10), pg_temp.item(k6, cl1, 600, 999, 10)), null),
    'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2k ...e k5 NÃO foi renovada (nada gravado)',
    (select count(*)::text from public.contracts where renewed_from_id in (k5, k6)), '0');
  perform pg_temp.rec('2l ...nem mensalidades órfãs',
    (select count(*)::text from public.tuitions where school_id = s_x and contract_id in (select id from public.contracts where renewed_from_id in (k5, k6))), '0');

  -- 2m. validações de item
  perform pg_temp.rec('2m início diferente de fim + 1', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10, date '2031-03-02', date '2032-03-01')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2n duração acima de 24 meses', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10, date '2031-03-01', date '2033-03-02')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2o mensalidade fora do período', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(jsonb_set(pg_temp.item(k5, cl1, 500, 500, 10), '{tuitions,0,due_date}', '"2033-01-01"')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2p valor da mensalidade não confere', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 499)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2q vencimentos repetidos', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(jsonb_set(pg_temp.item(k5, cl1, 500, 500, 10), '{tuitions,1,due_date}', (pg_temp.item(k5, cl1, 500, 500, 10)->'tuitions'->0->'due_date'))), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2r valor mensal zero', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 0, 0)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2s sem mensalidades', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(jsonb_set(pg_temp.item(k5, cl1, 500, 500), '{tuitions}', '[]')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2t status de mensalidade inválido', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(jsonb_set(pg_temp.item(k5, cl1, 500, 500, 10), '{tuitions,0,status}', '"paid"')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2u origem de outra escola', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(ky, cl1, 100, 100, 10)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2v turma de destino de outra escola', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cly, 500, 500, 10)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2w origem cancelada', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(kdead, cl1, 100, 100, 10)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('2x lote vazio', pg_temp.renew(u_admin, s_x, '[]'::jsonb, null), 'ERR:22023:INVALID_ITEMS');
  perform pg_temp.rec('2y lote com 101 itens', pg_temp.renew(u_admin, s_x,
    (select jsonb_agg(pg_temp.item(k5, cl1, 500, 500, 10)) from generate_series(1, 101)), null), 'ERR:22023:INVALID_ITEMS');
  perform pg_temp.rec('2z serviço de outra escola', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), svcy), 'ERR:22023:INVALID_SERVICE');
  perform pg_temp.rec('2za serviço mensal (não avulso)', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), svc_m), 'ERR:22023:INVALID_SERVICE');
  perform pg_temp.rec('2zb serviço inativo', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), svc_off), 'ERR:22023:INVALID_SERVICE');

  -- 2zc. permissões
  perform pg_temp.rec('2zc escola Y por quem é da escola X', pg_temp.renew(u_admin, s_y,
    jsonb_build_array(pg_temp.item(ky, cly, 100, 100, 10)), null), 'ERR:42501:NOT_ALLOWED');
  update public.user_roles set role = 'teacher' where user_id = u_fin;
  perform pg_temp.rec('2zd professor é negado', pg_temp.renew(u_fin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), null), 'ERR:42501:NOT_ALLOWED');
  update public.user_roles set role = 'financial' where user_id = u_fin;
  -- 2zd2. usuário sem nenhuma linha em user_roles é negado (fail closed)
  select role::text into v_role from public.user_roles where user_id = u_fin;
  delete from public.user_roles where user_id = u_fin;
  perform pg_temp.rec('2zd2 usuário sem papel é negado', pg_temp.renew(u_fin, s_x,
    jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), null), 'ERR:42501:NOT_ALLOWED');
  insert into public.user_roles (user_id, role) values (u_fin, v_role::public.app_role);
  perform pg_temp.rec('2ze financeiro renova (R6)',
    (((pg_temp.renew(u_fin, s_x, jsonb_build_array(pg_temp.item(k5, cl1, 500, 500, 10)), null))::jsonb)->>'renewed'), '1');
  perform pg_temp.rec('2zf anon não executa o RPC',
    has_function_privilege('anon', 'public.renew_contracts(uuid,jsonb,uuid)', 'execute')::text, 'false');

  -- 2zg. renovação cancelada libera nova renovação; decisão em contrato já renovado é bloqueada
  update public.contracts set status = 'cancelled' where renewed_from_id = k1;
  r := (pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(k1, cl2, 110, 99)), null))::jsonb;
  perform pg_temp.rec('2zg sucessor cancelado não conta: k1 pode ser renovada de novo', (r->>'renewed'), '1');
  perform pg_temp.rec('2zh decisão em contrato já renovado é bloqueada', pg_temp.decide(u_admin, k2, 'contacted'), 'ERR:22023:INVALID_CONTRACT');

  -- 2zi. gate de 2FA
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_x;
  delete from public.mfa_grace where user_id in (u_admin, u_fin);
  perform pg_temp.rec('2zi admin aal1 sem carência bloqueado', pg_temp.renew(u_admin, s_x,
    jsonb_build_array(pg_temp.item(k6, cl1, 600, 600, 10)), null), 'ERR:42501:MFA_REQUIRED');
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = false where id = s_x;

  -- 2zj. isolamento: nada foi criado na escola Y
  perform pg_temp.rec('2zj escola Y intacta',
    (select count(*)::text from public.contracts where school_id = s_y and renewed_from_id is not null), '0');

  -- 3. Master em escola alheia -------------------------------------------------------------
  -- Escola de OUTRO dono: o dono é u_admin, cujo perfil está na escola X; o perfil do master está em s_orig.
  -- Ser dono não dá acesso (quem decide é profiles.school_id + papel); o master entra por is_master_admin().
  -- O master exige 2FA sempre: as chamadas dele usam aal2.
  insert into public.schools (name, owner_user_id) values ('Escola Teste Rematrícula Z', u_admin) returning id into s_z;
  insert into public.classes (name, school_id) values ('Turma Z', s_z) returning id into clz;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Z', date '2015-01-01', s_z) returning id into stz;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (stz, clz, s_z, date '2030-03-01', date '2031-02-28', 'active', 100, 0, 10, 'meio_periodo') returning id into kz;
  delete from public.mfa_grace where user_id = u_master;

  perform pg_temp.rec('3a master marca decisão em contrato de escola alheia',
    pg_temp.decide(u_master, kz, 'will_not_renew', 'price', null, 'aal2'), '1');
  perform pg_temp.rec('3b ...gravada na escola do contrato, não na do perfil do master',
    (select (school_id = s_z and status = 'will_not_renew' and decided_by = u_master)::text
       from public.renewal_decisions where contract_id = kz), 'true');
  perform pg_temp.rec('3c ...e nada na escola do perfil do master',
    (select count(*)::text from public.renewal_decisions where school_id = s_orig and contract_id = kz), '0');
  perform pg_temp.rec('3d master renova na escola alheia',
    (((pg_temp.renew(u_master, s_z, jsonb_build_array(pg_temp.item(kz, clz, 100, 100, 10)), null, 'aal2'))::jsonb)->>'renewed'), '1');
  perform pg_temp.rec('3e ...contrato novo e 12 mensalidades na escola alheia',
    (select count(*)::text from public.contracts c join public.tuitions t on t.contract_id = c.id
      where c.renewed_from_id = kz and c.school_id = s_z and t.school_id = s_z), '12');
  perform pg_temp.rec('3f ...e nada vazou para a escola do perfil do master',
    (select ((select count(*) from public.contracts where school_id = s_orig and renewed_from_id = kz)
          + (select count(*) from public.tuitions where school_id = s_orig and contract_id in (select id from public.contracts where renewed_from_id = kz))
          + (select count(*) from public.service_charges where school_id = s_orig and student_id = stz))::text), '0');
  perform pg_temp.rec('3g auditoria do lote do master cai na escola alheia',
    (select count(*)::text from public.audit_logs where table_name = 'tuitions' and school_id = s_orig
        and (new_data->>'contract_id')::uuid in (select id from public.contracts where renewed_from_id = kz)), '0');
  perform pg_temp.rec('3g2 ...e existe na escola alheia, como generated (contraprova, evita vácuo)',
    (select count(*)::text || ':' || string_agg(distinct source, ',') from public.audit_logs where table_name = 'tuitions' and school_id = s_z
        and (new_data->>'contract_id')::uuid in (select id from public.contracts where renewed_from_id = kz)), '12:generated');
  perform pg_temp.rec('3h master em aal1 sem carência é bloqueado (2FA sempre)',
    pg_temp.renew(u_master, s_z, jsonb_build_array(pg_temp.item(kz, clz, 100, 100, 10)), null, 'aal1'), 'ERR:42501:MFA_REQUIRED');
  perform pg_temp.rec('3i master: origem de outra escola (s_x) com p_school_id = s_z é item inválido',
    pg_temp.renew(u_master, s_z, jsonb_build_array(pg_temp.item(k5, clz, 500, 500, 10)), null, 'aal2'), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('3j master: turma de destino de outra escola (cl1) é item inválido',
    pg_temp.renew(u_master, s_x, jsonb_build_array(pg_temp.item(k6, clz, 600, 600, 10)), null, 'aal2'), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('3k master em contrato inexistente', pg_temp.decide(u_master, gen_random_uuid(), 'contacted', null, null, 'aal2'),
    'ERR:22023:INVALID_CONTRACT');
  -- dono de outra escola, sem ser master, não ganha acesso à escola de que é dono
  perform pg_temp.rec('3l dono (u_admin) da escola Z, com perfil na X, não renova na Z',
    pg_temp.renew(u_admin, s_z, jsonb_build_array(pg_temp.item(kz, clz, 100, 100, 10)), null), 'ERR:42501:NOT_ALLOWED');
  perform pg_temp.rec('3m ...nem decide em contrato da Z', pg_temp.decide(u_admin, kz, 'contacted'), 'ERR:22023:INVALID_CONTRACT');

  -- 4. Endurecimento de renew_contracts (desenho 2026-11-25, H1-H5 e lacunas) ----------------
  -- Escritos ANTES da migration: 4b, 4d, 4d1, 4e-4i, 4k e 4o devem falhar contra o schema anterior ao endurecimento.
  h  := array(select pg_temp.mk(s_x, st, cl1, date '2031-02-28') from generate_series(1, 16));
  hx := pg_temp.mk(s_x, st, cl1, date '2025-02-28');   -- ativo e já vencido (renovação retroativa)
  hy := pg_temp.mk(s_x, st, cl1, date '2025-02-28');
  hz := pg_temp.mk(s_x, st, cl1, current_date - 1);    -- termina ontem: o sucessor começa hoje
  hw := pg_temp.mk(s_x, st, cl1, current_date - 1);
  hd := pg_temp.mk(s_x, st, cl1, date '2031-02-28', 333.33, 10);

  -- H1: teto de 25 mensalidades por contrato (24 meses + o dia final)
  perform pg_temp.rec('4a (H1) 25 mensalidades são aceitas', pg_temp.renew_s(u_admin, s_x, jsonb_build_array(
    pg_temp.item_t(h[1], cl1, 100, date '2031-03-01', date '2033-03-01', pg_temp.rowsn(date '2031-03-01', 25, 100))), null), '1|25');
  perform pg_temp.rec('4b (H1) 26 mensalidades são recusadas', pg_temp.renew(u_admin, s_x, jsonb_build_array(
    pg_temp.item_t(h[2], cl1, 100, date '2031-03-01', date '2033-03-01',
      pg_temp.rowsn(date '2031-03-01', 25, 100) || jsonb_build_object('due_date', '2031-03-15', 'amount', 100, 'status', 'pending', 'description', 'Extra'))), null),
    'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('4b2 ...e nada foi gravado', (select count(*)::text from public.contracts where renewed_from_id = h[2]), '0');

  -- H2: overdue só com vencimento que não é futuro; renovação retroativa preserva as vencidas
  perform pg_temp.rec('4c (H2) contrato ativo já vencido renova com as 12 mensalidades vencidas', pg_temp.renew_s(u_admin, s_x, jsonb_build_array(
    pg_temp.item_t(hx, cl1, 100, date '2025-03-01', date '2026-02-28', pg_temp.rowsn(date '2025-03-05', 12, 100, 'overdue'))), null), '1|12');
  perform pg_temp.rec('4c2 ...todas continuam overdue, com os vencimentos enviados',
    (select (count(*) = 12 and count(*) filter (where t.status = 'overdue') = 12
             and min(t.due_date) = date '2025-03-05' and max(t.due_date) = date '2026-02-05')::text
       from public.tuitions t join public.contracts c on c.id = t.contract_id where c.renewed_from_id = hx), 'true');
  perform pg_temp.rec('4c3 (H2) vencimento passado com status pending também é aceito (o job converte)', pg_temp.renew_s(u_admin, s_x, jsonb_build_array(
    pg_temp.item_t(hy, cl1, 100, date '2025-03-01', date '2026-02-28', pg_temp.rowsn(date '2025-03-05', 12, 100, 'pending'))), null), '1|12');
  perform pg_temp.rec('4c4 ...e continuam pending',
    (select count(*)::text from public.tuitions t join public.contracts c on c.id = t.contract_id
      where c.renewed_from_id = hy and t.status = 'pending'), '12');
  perform pg_temp.rec('4d (H2) overdue com vencimento futuro é recusado', pg_temp.renew(u_admin, s_x, jsonb_build_array(
    pg_temp.item_t(h[3], cl1, 100, date '2031-03-01', date '2032-02-29', pg_temp.rowsn(date '2031-03-05', 12, 100, 'overdue'))), null),
    'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('4d1 (H2) overdue com vencimento amanhã é recusado', pg_temp.renew(u_admin, s_x, jsonb_build_array(
    pg_temp.item_t(hz, cl1, 100, current_date, current_date + 30, jsonb_build_array(
      jsonb_build_object('due_date', current_date + 1, 'amount', 100, 'status', 'overdue', 'description', 'Amanhã')))), null),
    'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('4d2 (H2) overdue com vencimento hoje é aceito (folga de fuso)', pg_temp.renew_s(u_admin, s_x, jsonb_build_array(
    pg_temp.item_t(hw, cl1, 100, current_date, current_date + 30, jsonb_build_array(
      jsonb_build_object('due_date', current_date, 'amount', 100, 'status', 'overdue', 'description', 'Hoje')))), null), '1|1');

  -- H3: JSON malformado vira INVALID_ITEM(S), nunca erro cru nem eco do valor enviado
  got := pg_temp.renew(u_admin, s_x, jsonb_build_array(jsonb_set(pg_temp.item(h[4], cl1, 100, 100), '{monthly_amount}', '"abc"')), null);
  perform pg_temp.rec('4e (H3) monthly_amount não numérico', got, 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('4e2 ...sem ecoar o valor enviado', (got like '%abc%')::text, 'false');
  perform pg_temp.rec('4f (H3) data de vencimento impossível', pg_temp.renew(u_admin, s_x, jsonb_build_array(
    jsonb_set(pg_temp.item(h[5], cl1, 100, 100), '{tuitions,0,due_date}', '"2031-13-45"')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('4g (H3) monthly_amount objeto em vez de número', pg_temp.renew(u_admin, s_x, jsonb_build_array(
    jsonb_set(pg_temp.item(h[6], cl1, 100, 100), '{monthly_amount}', '{"a":1}')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('4h (H3) mensalidades que não são objetos', pg_temp.renew(u_admin, s_x, jsonb_build_array(
    jsonb_set(pg_temp.item(h[7], cl1, 100, 100), '{tuitions}', '[1,2]')), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('4i (H3) itens que não são objetos', pg_temp.renew(u_admin, s_x, '[1]'::jsonb, null), 'ERR:22023:INVALID_ITEMS');
  perform pg_temp.rec('4j (H3) p_items objeto em vez de array', pg_temp.renew(u_admin, s_x, '{}'::jsonb, null), 'ERR:22023:INVALID_ITEMS');

  -- H4: itens processados em ordem de source_contract_id (a prova de deadlock entre duas sessões não cabe numa transação só)
  lo := least(h[8], h[9]); hi := greatest(h[8], h[9]);
  got := pg_temp.renew(u_admin, s_x, jsonb_build_array(pg_temp.item(hi, cl1, 0, 0), pg_temp.item(lo, cl1, 0, 0)), null);
  perform pg_temp.rec('4k (H4) lote fora de ordem: o erro é do menor source_contract_id',
    (got like 'ERR:22023:INVALID_ITEM%' and got like '%' || lo::text || '%' and got not like '%' || hi::text || '%')::text, 'true');
  perform pg_temp.rec('4l (H4) lote com os mesmos contratos em ordem inversa renova os dois', pg_temp.renew_s(u_admin, s_x, jsonb_build_array(
    pg_temp.item(hi, cl1, 100, 100), pg_temp.item(lo, cl1, 100, 100)), null), '2|24');
  perform pg_temp.rec('4m (H4) duplicata no lote: a primeira ocorrência vence (ordem original preservada)', pg_temp.renew_s(u_admin, s_x, jsonb_build_array(
    pg_temp.item(h[10], cl1, 100, 100), pg_temp.item(h[10], cl2, 150, 150)), null), '1|12');
  perform pg_temp.rec('4m2 ...o contrato novo é o da primeira (turma 1, R$ 100)',
    (select (class_id = cl1 and monthly_amount = 100)::text from public.contracts where renewed_from_id = h[10]), 'true');

  -- H5: teto de monthly_amount = R$ 30.000,00 (constante MAX_MONTHLY_AMOUNT em src/lib/renewal.ts; o RPC só confirma)
  perform pg_temp.rec('4n (H5) R$ 30.000,00 é aceito', pg_temp.renew_s(u_admin, s_x, jsonb_build_array(
    pg_temp.item(h[11], cl1, 30000, 30000)), null), '1|12');
  perform pg_temp.rec('4o (H5) R$ 30.000,01 é recusado', pg_temp.renew(u_admin, s_x, jsonb_build_array(
    pg_temp.item(h[12], cl1, 30000.01, 30000.01)), null), 'ERR:22023:INVALID_ITEM');

  -- Lacunas da etapa 1
  perform pg_temp.rec('4p turma de destino nula (sem turma) é aceita', pg_temp.renew_s(u_admin, s_x, jsonb_build_array(
    pg_temp.item(h[13], null::uuid, 100, 100)), null), '1|12');
  perform pg_temp.rec('4p2 ...e o contrato novo fica sem turma',
    (select (class_id is null)::text from public.contracts where renewed_from_id = h[13]), 'true');
  perform pg_temp.rec('4q tolerância: diferença de R$ 0,01 passa', pg_temp.renew_s(u_admin, s_x, jsonb_build_array(
    pg_temp.item(h[14], cl1, 500, 500.01)), null), '1|12');
  perform pg_temp.rec('4q2 tolerância: diferença de R$ 0,02 não passa', pg_temp.renew(u_admin, s_x, jsonb_build_array(
    pg_temp.item(h[15], cl1, 500, 500.02)), null), 'ERR:22023:INVALID_ITEM');
  perform pg_temp.rec('4r arredondamento com desconto (333,33 com 10%): o cliente manda o valor arredondado', pg_temp.renew_s(u_admin, s_x, jsonb_build_array(
    pg_temp.item(hd, cl1, 333.33, round(333.33 * 0.9, 2))), null), '1|12');
  perform pg_temp.rec('4r2 ...e a mensalidade gravada é o final_amount do contrato (299,997) arredondado a 2 casas = 300,00, nas 12',
    (select (count(*) = 12 and bool_and(t.amount = round(c.final_amount, 2) and t.amount = 300.00))::text
       from public.tuitions t join public.contracts c on c.id = t.contract_id where c.renewed_from_id = hd), 'true');

  -- 5. Item I: contracts.final_amount com 2 casas na origem (round) -------------------------
  -- Escritos ANTES da migration 20261125130000_contracts_final_amount_round.sql: 5a, 5b e 5e devem falhar contra o schema anterior.
  hk1 := pg_temp.mk(s_x, st, cl1, date '2031-02-28', 333.33, 10);
  hk2 := pg_temp.mk(s_x, st, cl1, date '2031-02-28', 99.99, 33.33);
  hk3 := pg_temp.mk(s_x, st, cl1, date '2031-02-28', 250, 0);
  hk4 := pg_temp.mk(s_x, st, cl1, date '2031-02-28', 1350, 12.5);

  perform pg_temp.rec('5a (I) 333,33 com 10% = 300,00 exato (299,997 arredondado)',
    (select (final_amount = 300.00 and scale(final_amount) <= 2)::text from public.contracts where id = hk1), 'true');
  perform pg_temp.rec('5b (I) 99,99 com 33,33% = 66,66 (66,659333 arredondado)',
    (select (final_amount = 66.66 and scale(final_amount) <= 2)::text from public.contracts where id = hk2), 'true');
  perform pg_temp.rec('5c (I) desconto zero: final_amount = monthly_amount',
    (select (final_amount = 250.00 and scale(final_amount) <= 2)::text from public.contracts where id = hk3), 'true');
  perform pg_temp.rec('5d (I) valor com desconto que já fecha em 2 casas não muda (1350 com 12,5% = 1181,25)',
    (select (final_amount = 1181.25)::text from public.contracts where id = hk4), 'true');
  perform pg_temp.rec('5e (I) nenhum contrato da matriz tem fração de centavo no final_amount',
    (select count(*)::text from public.contracts where final_amount <> round(final_amount, 2)), '0');
  perform pg_temp.rec('5f (I) renew_contracts com o valor arredondado renova e grava 300,00 nas 12',
    pg_temp.renew_s(u_admin, s_x, jsonb_build_array(pg_temp.item(hk1, cl1, 333.33, 300.00)), null), '1|12');
  perform pg_temp.rec('5f2 (I) ...as 12 mensalidades gravadas são exatamente o final_amount do contrato de origem',
    (select (count(*) = 12 and bool_and(t.amount = (select final_amount from public.contracts where id = hk1)))::text
       from public.tuitions t join public.contracts c on c.id = t.contract_id where c.renewed_from_id = hk1), 'true');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
