-- supabase/tests/ensaio_matrix.sql
-- Ensaio geral financeiro (25/11/2026): matrícula, geração, baixa, edição de valor (item I), renegociação,
-- lote de renovação (prévia x resultado), despesa recorrente e casos de borda. Relatório: docs/ENSAIO_GERAL_2026-11-25.md.
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste. NUNCA remova o "rollback;" do final.
-- Personas escolhidas por consulta (como a renewal_matrix.sql): o admin e o financeiro da escola de casa do master.
-- Não rode contra uma escola real que não seja a escola de teste do master (a escola alvo é impressa na 1ª linha).
-- Como rodar: npx supabase@2.117.0 db query --linked -f supabase/tests/ensaio_matrix.sql
-- Saída: uma linha por verificação; "ok" deve ser true em TODAS.
-- Linhas "LACUNA": registram o comportamento ATUAL conhecido e indesejado (ok = true enquanto a lacuna existir). Depois dos blocos B, C2 e D
-- (26/11) as lacunas que restam são: edição/criação DIRETA pela API (sem RPC), origem ativa após renovar e CHECKs no banco.
-- Quando o bloco que corrige a lacuna entrar, a linha correspondente deve ser invertida para o comportamento novo.

begin;

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
          coalesce(p_got = p_esperado or (p_esperado like 'ERR:%' and p_got like 'ERR:%'), false))
$f$;

-- n mensalidades mensais a partir de p_start (vencimento no p_due_day de cada mês, limitado ao último dia), valor p_amount
create function pg_temp.rowsn(p_start date, p_n int, p_due_day int, p_amount numeric) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object(
           'due_date', (least(make_date(extract(year from d)::int, extract(month from d)::int, 1) + (p_due_day - 1),
                              (date_trunc('month', d) + interval '1 month - 1 day')::date)),
           'amount', p_amount, 'status', 'pending', 'description', 'Mensalidade ' || (g + 1)) order by g)
    from (select g, (date_trunc('month', p_start) + make_interval(months => g))::date d from generate_series(0, p_n - 1) g) z
$f$;

do $$
declare
  s uuid; sname text; u_adm uuid; u_fin uuid; cl uuid; cl2 uuid; cat uuid;
  v text; t1 uuid; t2 uuid; ids uuid[]; rid uuid; i int;
  st_a uuid; k_a uuid; st_b uuid; k_b uuid; st_c uuid; k_c uuid; st_d uuid; k_d uuid; st_i uuid; k_i uuid;
  r1 uuid; r2 uuid; r3 uuid; kr1 uuid; kr2 uuid; kr3 uuid; items jsonb;
begin
  select p.school_id into s from public.profiles p where p.is_master_admin and p.school_id is not null order by p.user_id limit 1;
  select name into sname from public.schools where id = s;
  select p.user_id into u_adm from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s and not p.is_master_admin and r.role = 'admin' order by p.user_id limit 1;
  select p.user_id into u_fin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  select id into cat from public.expense_categories where school_id = s order by name limit 1;
  if s is null or u_adm is null or u_fin is null or cat is null then raise exception 'personagens nao encontrados'; end if;
  perform pg_temp.rec('0 escola alvo (confira que e a escola de teste): ' || sname, 'ok', 'ok');

  insert into public.classes (name, school_id, monthly_fee, max_capacity) values ('ENSAIO turma A', s, 1000, 2) returning id into cl;
  insert into public.classes (name, school_id, monthly_fee, max_capacity) values ('ENSAIO turma vazia', s, 1000, 5) returning id into cl2;

  -- ===== 1. Matrículas (contrato criado pelo admin como o formulário; mensalidades pelo RPC de geração)
  -- desconto 15%: 1000 -> 850,00
  insert into public.students (full_name, birth_date, school_id, guardian_contact) values ('ENSAIO a', date '2015-03-01', s, 'RESP-A') returning id into st_a;
  v := pg_temp.run_as(u_adm, 'aal1', format($q$with c as (insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (%L, %L, 'meio_periodo', date '2031-01-01', date '2031-12-31', 1000, 15, 10, 'active', %L) returning id) select id::text from c$q$, st_a, cl, s));
  k_a := v::uuid;
  perform pg_temp.rec('1a final_amount do contrato com 15% de desconto', (select final_amount::text from public.contracts where id = k_a), '850.00');
  v := pg_temp.run_as(u_adm, 'aal1', format($q$select public.insert_generated_tuitions(%L, (select jsonb_agg(r || jsonb_build_object('contract_id', %L, 'student_id', %L, 'school_id', %L, 'final_amount', null))
    from jsonb_array_elements(%L::jsonb) r))::text$q$, s, k_a, st_a, s, pg_temp.rowsn(date '2031-01-01', 12, 10, 850)::text));
  perform pg_temp.rec('1b 12 mensalidades geradas', v, '12');
  perform pg_temp.rec('1c soma = 12 x 850,00', (select sum(amount)::text from public.tuitions where contract_id = k_a), '10200.00');

  -- centavos: 333,33 com 10% -> 300,00 (arredondado na origem pelo item I)
  insert into public.students (full_name, birth_date, school_id) values ('ENSAIO b', date '2015-03-01', s) returning id into st_b;
  insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (st_b, cl, 'meio_periodo', date '2031-01-01', date '2031-12-31', 333.33, 10, 31, 'active', s) returning id into k_b;
  perform pg_temp.rec('1d 333,33 com 10% = 300,00 (2 casas)', (select final_amount::text from public.contracts where id = k_b), '300.00');
  insert into public.students (full_name, birth_date, school_id) values ('ENSAIO c', date '2015-03-01', s) returning id into st_c;
  insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (st_c, cl, 'meio_periodo', date '2031-01-01', date '2031-12-31', 1234.57, 12.5, 15, 'active', s) returning id into k_c;
  perform pg_temp.rec('1e 1234,57 com 12,5% = 1080,25', (select final_amount::text from public.contracts where id = k_c), '1080.25');

  -- vencimento dia 31 em mês curto: as linhas vêm do gerador do front (tuitionRows.ts); aqui só conferimos o RPC aceitar o último dia
  v := pg_temp.run_as(u_adm, 'aal1', format($q$select public.insert_generated_tuitions(%L, (select jsonb_agg(r || jsonb_build_object('contract_id', %L, 'student_id', %L, 'school_id', %L, 'final_amount', null))
    from jsonb_array_elements(%L::jsonb) r))::text$q$, s, k_b, st_b, s, pg_temp.rowsn(date '2031-01-01', 12, 31, 300)::text));
  perform pg_temp.rec('1f vencimento dia 31 (fev = último dia do mês): 12 geradas', v, '12');
  perform pg_temp.rec('1g fevereiro vence dia 28 de 2031', (select due_date::text from public.tuitions where contract_id = k_b and due_date between date '2031-02-01' and date '2031-02-28' limit 1), '2031-02-28');

  -- ===== 2. Baixa (como o TuitionTable: status, paid_date, forma, final_amount = valor - desconto + multa)
  select id into t1 from public.tuitions where contract_id = k_a order by due_date limit 1;
  select id into t2 from public.tuitions where contract_id = k_a order by due_date offset 1 limit 1;
  v := pg_temp.run_as(u_adm, 'aal1', format($q$with u as (update public.tuitions set discount_applied = 50 where id = %L and school_id = %L returning 1) select count(*)::text from u$q$, t1, s));
  v := pg_temp.run_as(u_adm, 'aal1', format($q$with u as (update public.tuitions set status='paid', paid_date = date '2030-12-20', payment_method='pix',
    final_amount = amount - coalesce(discount_applied,0) + coalesce(penalty_amount,0) where id = %L and school_id = %L returning 1) select count(*)::text from u$q$, t1, s));
  perform pg_temp.rec('2a baixa antecipada com desconto de R$ 50 pelo admin', (select final_amount::text from public.tuitions where id = t1), '800.00');
  v := pg_temp.run_as(u_fin, 'aal1', format($q$with u as (update public.tuitions set penalty_amount = 30 where id = %L and school_id = %L returning 1) select count(*)::text from u$q$, t2, s));
  v := pg_temp.run_as(u_fin, 'aal1', format($q$with u as (update public.tuitions set status='paid', paid_date = date '2031-02-12', payment_method='dinheiro',
    final_amount = amount - coalesce(discount_applied,0) + coalesce(penalty_amount,0) where id = %L and school_id = %L returning 1) select count(*)::text from u$q$, t2, s));
  perform pg_temp.rec('2b baixa com multa de R$ 30 pelo financeiro', (select final_amount::text from public.tuitions where id = t2), '880.00');
  -- Bloco D (migration 20261126100000 aplicada): baixa dupla é barrada pelo banco e a paid_date original fica
  v := pg_temp.run_as(u_adm, 'aal1', format($q$with u as (update public.tuitions set status='paid', paid_date = date '2031-03-01', final_amount = amount where id = %L and school_id = %L returning 1) select count(*)::text from u$q$, t2, s));
  perform pg_temp.rec('2c baixa dupla é barrada (ALREADY_PAID) e a paid_date original é preservada', (select paid_date::text from public.tuitions where id = t2), '2031-02-12');

  -- ===== 3. Edição de valor (item I + bloco B): o caminho oficial é o RPC update_contract_amounts (propaga às mensalidades abertas)
  v := pg_temp.run_as(u_adm, 'aal1', format($q$select public.update_contract_amounts(%L, %L, 1100, null)::text$q$, s, k_a));
  perform pg_temp.rec('3a final_amount recalculado ao editar o contrato pelo RPC (1100 com 15%)', (select final_amount::text from public.contracts where id = k_a), '935.00');
  perform pg_temp.rec('3b as 10 mensalidades abertas foram propagadas (nenhuma com o valor antigo)', (select count(*)::text from public.tuitions where contract_id = k_a and status in ('pending','overdue') and amount <> 935.00), '0');
  perform pg_temp.rec('3c as 2 pagas não mudaram (800 e 880)', (select string_agg(final_amount::text, ',' order by due_date) from public.tuitions where contract_id = k_a and status = 'paid'), '800.00,880.00');
  -- LACUNA (edição direta pela API): UPDATE direto em contracts, fora do RPC, não propaga (aceito por ora; o formulário usa o RPC)
  v := pg_temp.run_as(u_adm, 'aal1', format($q$with u as (update public.contracts set monthly_amount = 1200 where id = %L and school_id = %L returning 1) select count(*)::text from u$q$, k_a, s));
  perform pg_temp.rec('LACUNA (API direta) 3d UPDATE direto do contrato não propaga: as 10 abertas seguem em 935', (select count(*)::text from public.tuitions where contract_id = k_a and status in ('pending','overdue') and amount = 935.00), '10');

  -- ===== 4. Renegociação do inadimplente
  insert into public.students (full_name, birth_date, school_id) values ('ENSAIO i', date '2015-03-01', s) returning id into st_i;
  insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (st_i, cl, 'meio_periodo', date '2031-01-01', date '2031-12-31', 850, 0, 10, 'active', s) returning id into k_i;
  insert into public.tuitions (contract_id, student_id, school_id, amount, due_date, status, description)
    select k_i, st_i, s, 850, d, 'overdue', 'ENSAIO' from unnest(array[date '2031-01-10', date '2031-02-10', date '2031-03-10', date '2031-04-10']) d;
  select array_agg(id order by due_date) into ids from (select id, due_date from public.tuitions where contract_id = k_i order by due_date limit 3) z;
  v := pg_temp.run_as(u_adm, 'aal1', format($q$select public.renegotiate_tuitions(%L, %L, %L::uuid[], 400::numeric, 3, date '2031-06-05', 'ensaio', %L)::text$q$, st_i, s, ids::text, u_adm));
  perform pg_temp.rec('4a renegociação devolve o id', (v ~ '^[0-9a-f-]{36}$')::text, 'true');
  perform pg_temp.rec('4b 3 originais canceladas', (select count(*)::text from public.tuitions where contract_id = k_i and status = 'cancelled'), '3');
  perform pg_temp.rec('4c 3 parcelas novas somam R$ 1.200,00', (select count(*)::text || '/' || sum(amount)::text from public.tuitions where student_id = st_i and renegotiation_id is not null and status <> 'cancelled'), '3/1200.00');
  perform pg_temp.rec('4d sem duplicata (contrato + vencimento)', (select count(*)::text from (select 1 from public.tuitions where student_id = st_i and status <> 'cancelled' group by contract_id, due_date having count(*) > 1) d), '0');

  -- ===== 5. Lote de renovação: servidor x conta esperada (prévia do front = mesma conta)
  for i in 1..3 loop
    insert into public.students (full_name, birth_date, school_id) values ('ENSAIO r' || i, date '2014-05-05', s) returning id into rid;
    insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
      values (rid, cl, 'meio_periodo', date '2031-01-01', date '2031-12-31', (array[1000, 333.33, 1500])[i], (array[0, 10, 100])[i], 10, 'active', s)
      returning id into rid;
    if i = 1 then r1 := rid; elsif i = 2 then r2 := rid; else r3 := rid; end if;
  end loop;
  -- reajuste de 7%: novo valor = round(monthly * 1,07, 2); mensalidade = round(novo * (1 - desc/100), 2)
  items := jsonb_build_array(
    jsonb_build_object('source_contract_id', r1, 'class_id', cl, 'monthly_amount', 1070.00, 'start_date', '2032-01-01', 'end_date', '2032-12-31', 'tuitions', pg_temp.rowsn(date '2032-01-01', 12, 10, 1070.00)),
    jsonb_build_object('source_contract_id', r2, 'class_id', cl, 'monthly_amount', 356.66, 'start_date', '2032-01-01', 'end_date', '2032-12-31', 'tuitions', pg_temp.rowsn(date '2032-01-01', 12, 10, 320.99)),
    jsonb_build_object('source_contract_id', r3, 'class_id', cl, 'monthly_amount', 1605.00, 'start_date', '2032-01-01', 'end_date', '2032-12-31', 'tuitions', pg_temp.rowsn(date '2032-01-01', 12, 10, 0.00)));
  v := pg_temp.run_as(u_adm, 'aal1', format($q$select (r->>'renewed') || '/' || (r->>'tuitions') || '/' || jsonb_array_length(r->'skipped') from (select public.renew_contracts(%L, %L::jsonb) r) z$q$, s, items::text));
  perform pg_temp.rec('5a lote: renovados/mensalidades/ignorados', v, '3/36/0');
  perform pg_temp.rec('5b sucessor com centavos (356,66 com 10% = 320,99)', (select final_amount::text from public.contracts where renewed_from_id = r2), '320.99');
  perform pg_temp.rec('5c total BRUTO dos sucessores (o que a prévia mostra hoje)', (select sum(monthly_amount)::text from public.contracts where renewed_from_id in (r1, r2, r3)), '3031.66');
  perform pg_temp.rec('5d total LÍQUIDO dos sucessores (o que será cobrado por mês)', (select sum(final_amount)::text from public.contracts where renewed_from_id in (r1, r2, r3)), '1390.99');
  v := pg_temp.run_as(u_adm, 'aal1', format($q$select (r->>'renewed') || '/' || (r->>'tuitions') || '/' || jsonb_array_length(r->'skipped') from (select public.renew_contracts(%L, %L::jsonb) r) z$q$, s, items::text));
  perform pg_temp.rec('5e repetir o lote (duas pessoas renovando): nada duplica', v, '0/0/3');
  insert into public.students (full_name, birth_date, school_id) values ('ENSAIO r4', date '2014-05-05', s) returning id into rid;
  insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (rid, cl, 'meio_periodo', date '2031-01-01', date '2031-12-31', 29000, 0, 10, 'active', s) returning id into r3;
  v := pg_temp.run_as(u_adm, 'aal1', format($q$select public.renew_contracts(%L, jsonb_build_array(jsonb_set(jsonb_set(%L::jsonb, '{monthly_amount}', '31030'::jsonb), '{source_contract_id}', to_jsonb(%L::text))))::text$q$, s, (items->0)::text, r3));
  perform pg_temp.rec('5f servidor recusa valor acima do teto (R$ 30.000)', v, 'ERR:');
  -- LACUNA: origem continua ativa depois de renovada (desenho atual)
  perform pg_temp.rec('LACUNA 5g contratos de origem seguem ativos depois de renovados', (select count(*)::text from public.contracts where id in (r1, r2) and status = 'active'), '2');

  -- ===== 6. Despesa recorrente
  insert into public.recurring_expenses (school_id, category_id, description, amount, due_day, start_date, end_date, active)
    values (s, cat, 'ENSAIO conta de luz', 1234.56, 10, date '2031-01-01', date '2031-03-31', true) returning id into rid;
  v := pg_temp.run_as(u_adm, 'aal1', format($q$select public.insert_generated_expenses(%L, (select jsonb_agg(jsonb_build_object('recurring_expense_id', %L, 'school_id', %L, 'category_id', %L, 'class_id', null, 'amount', 1234.56, 'due_date', d, 'status', 'pending', 'description', 'ENSAIO luz'))
    from unnest(array[date '2031-01-10', date '2031-02-10', date '2031-03-10']) d))::text$q$, s, rid, s, cat));
  perform pg_temp.rec('6a 3 lançamentos gerados do molde', v, '3');
  v := pg_temp.run_as(u_fin, 'aal1', format($q$with u as (update public.expenses set status='paid', paid_date = date '2031-01-05', payment_method='pix' where recurring_expense_id = %L and due_date = date '2031-01-10' and school_id = %L returning 1) select count(*)::text from u$q$, rid, s));
  perform pg_temp.rec('6b baixa de despesa pelo financeiro', v, '1');
  perform pg_temp.rec('6c total do molde = 3 x 1.234,56', (select sum(amount)::text from public.expenses where recurring_expense_id = rid), '3703.68');

  -- ===== 7. Bordas
  -- Bloco C2: o import_contract barra ativo sobreposto; LACUNA (API direta): o INSERT direto em contracts segue aceito pelo banco
  perform pg_temp.rec('7a0 import_contract barra 2º contrato ativo sobreposto do mesmo aluno (OVERLAP)', pg_temp.run_as(u_adm, 'aal1', format($q$select public.import_contract(%L::jsonb, %L)::text$q$, json_build_object('student_id', st_a, 'monthly_amount', 500, 'discount', 0, 'due_day', 10, 'start_date', '2031-06-01', 'end_date', '2031-12-31', 'status', 'active')::text, s)), 'ERR:22023:OVERLAP');
  v := pg_temp.run_as(u_adm, 'aal1', format($q$with c as (insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (%L, %L, 'meio_periodo', date '2031-06-01', date '2031-12-31', 1000, 0, 10, 'active', %L) returning id) select id::text from c$q$, st_a, cl, s));
  perform pg_temp.rec('LACUNA (API direta) 7a INSERT direto de 2º contrato ativo sobreposto e aceito pelo banco', (v ~ '^[0-9a-f-]{36}$')::text, 'true');
  -- LACUNA (Bloco C/F): sem CHECKs no banco
  for i in 1..4 loop
    insert into public.students (full_name, birth_date, school_id) values ('ENSAIO borda ' || i, date '2015-01-01', s) returning id into rid;
    v := pg_temp.run_as(u_adm, 'aal1', format($q$with c as (insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
      values (%L, %L, 'meio_periodo', %L, %L, %s, %s, %s, 'active', %L) returning id) select id::text from c$q$, rid, cl,
      (array['2032-01-01','2032-01-01','2032-12-31','2032-01-01'])[i], (array['2032-12-31','2032-12-31','2032-01-01','2032-12-31'])[i],
      (array[1000, 0, 1000, 1000])[i], (array[120, 0, 0, 0])[i], (array[10, 10, 10, 45])[i], s));
    perform pg_temp.rec('LACUNA (Bloco C/F) 7b banco aceita contrato inválido #' || i || ' (1 = desconto 120%, 2 = valor 0, 3 = fim antes do início, 4 = vencimento 45)', (v ~ '^[0-9a-f-]{36}$')::text, 'true');
  end loop;
  v := pg_temp.run_as(u_adm, 'aal1', format($q$with d as (delete from public.students where id = %L returning 1) select count(*)::text from d$q$, st_a));
  perform pg_temp.rec('7c excluir aluno com contrato: banco recusa (FK)', case when v like 'ERR:%' then 'ERR:' else v end, 'ERR:');
  v := pg_temp.run_as(u_adm, 'aal1', format($q$with d as (delete from public.classes where id = %L returning 1) select count(*)::text from d$q$, cl));
  perform pg_temp.rec('7d excluir turma com contratos: banco recusa (FK)', case when v like 'ERR:%' then 'ERR:' else v end, 'ERR:');
  perform pg_temp.rec('7e aluno sem responsável tem contrato e mensalidades normalmente', (select count(*)::text from public.students where id = st_b and guardian_contact is null), '1');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
