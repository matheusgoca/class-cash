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
create function pg_temp.renew(p_uid uuid, p_school uuid, p_items jsonb, p_fee uuid default null)
returns text language sql as $f$
  select pg_temp.run_as(p_uid, 'aal1',
    format('select public.renew_contracts(%L, %L::jsonb, %L)::text', p_school, p_items::text, p_fee))
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
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
