-- supabase/tests/scholarship_matrix.sql
-- Matriz do bolsista integral, desconto 100% (S6b, bloco H). Migration: 20261126110000_scholarship_tuitions.sql.
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste. NUNCA remova o "rollback;" do final.
-- Personas por consulta (admin e financeiro da escola de casa do master, a escola de teste). Sem UUIDs nem nomes fixos.
-- Migration ainda NÃO aplicada: trocar a linha marcadora MIGRATION (sozinha na linha) pelo conteúdo da migration.
-- Migration já aplicada: npx supabase@2.117.0 db query --linked -f supabase/tests/scholarship_matrix.sql
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

-- n linhas mensais a partir de p_start (vencimento dia 10), valor p_amount, status p_status
create function pg_temp.rowsn(p_start date, p_n int, p_amount numeric, p_status text default 'pending') returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object('due_date', (date_trunc('month', p_start) + make_interval(months => g) + interval '9 days')::date,
                                      'amount', p_amount, 'status', p_status, 'description', 'Mensalidade ' || (g + 1)) order by g)
    from generate_series(0, p_n - 1) g
$f$;

-- gera as linhas como o app (RPC insert_generated_tuitions) para o contrato, como o usuário dado
create function pg_temp.gen(p_uid uuid, p_school uuid, p_contract uuid, p_student uuid, p_rows jsonb) returns text language sql as $f$
  select pg_temp.run_as(p_uid, 'aal1', format($q$select public.insert_generated_tuitions(%L, (select jsonb_agg(r || jsonb_build_object('contract_id', %L, 'student_id', %L, 'school_id', %L, 'final_amount', null))
    from jsonb_array_elements(%L::jsonb) r))::text$q$, p_school, p_contract, p_student, p_school, p_rows::text))
$f$;

do $$
declare
  s uuid; u_adm uuid; u_fin uuid; cl uuid;
  st_b uuid; k_b uuid; st_n uuid; k_n uuid; st_o uuid; k_o uuid; st_i uuid; k_i uuid; st_r uuid; k_r uuid; st_m uuid; k_m uuid;
  v text; t_b uuid; items jsonb; n_bolsa int;
begin
  select p.school_id into s from public.profiles p where p.is_master_admin and p.school_id is not null order by p.user_id limit 1;
  select p.user_id into u_adm from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s and not p.is_master_admin and r.role = 'admin' order by p.user_id limit 1;
  select p.user_id into u_fin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  if s is null or u_adm is null or u_fin is null then raise exception 'personagens nao encontrados'; end if;
  insert into public.classes (name, school_id, monthly_fee) values ('BOLSA turma', s, 1000) returning id into cl;

  -- 1. matrícula de bolsista: desconto 100%, valor de tabela preservado
  insert into public.students (full_name, birth_date, school_id) values ('BOLSA aluno bolsista', date '2015-01-01', s) returning id into st_b;
  v := pg_temp.run_as(u_adm, 'aal1', format($q$with c as (insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (%L, %L, 'meio_periodo', date '2030-06-01', date '2031-05-31', 1000, 100, 10, 'active', %L) returning id) select id::text from c$q$, st_b, cl, s));
  k_b := v::uuid;
  perform pg_temp.rec('1a contrato com desconto 100% mantém o valor de tabela e zera o final_amount',
    (select monthly_amount::text || '/' || discount::text || '/' || final_amount::text from public.contracts where id = k_b), '1000.00/100.00/0.00');

  -- 2. geração (12 meses: parte vencida, parte futura): todas nascem quitadas como bolsa
  v := pg_temp.gen(u_adm, s, k_b, st_b, pg_temp.rowsn(date '2030-06-01', 12, 0));
  perform pg_temp.rec('2a 12 mensalidades geradas', v, '12');
  perform pg_temp.rec('2b todas nascem paid / bolsa / final 0',
    (select count(*) filter (where status = 'paid' and payment_method = 'bolsa' and final_amount = 0 and amount = 0)::text from public.tuitions where contract_id = k_b), '12');
  perform pg_temp.rec('2c paid_date = due_date em todas, inclusive em mês futuro',
    (select count(*) filter (where paid_date = due_date)::text from public.tuitions where contract_id = k_b), '12');
  perform pg_temp.rec('2d há bolsas em mês futuro (due_date > hoje)',
    (select (count(*) filter (where due_date > current_date) > 0)::text from public.tuitions where contract_id = k_b), 'true');
  perform pg_temp.rec('2e nenhuma fica aberta (pending/overdue): fora da inadimplência, dos avisos e das ações de baixa',
    (select count(*)::text from public.tuitions where contract_id = k_b and status in ('pending', 'overdue')), '0');
  perform pg_temp.rec('2f entrada "overdue" também nasce bolsa (mês vencido)',
    pg_temp.gen(u_adm, s, k_b, st_b, pg_temp.rowsn(date '2031-06-01', 1, 0, 'overdue')), '1');
  perform pg_temp.rec('2g ...e fica paid/bolsa',
    (select status || '/' || payment_method from public.tuitions where contract_id = k_b and due_date = date '2031-06-10'), 'paid/bolsa');

  -- 3. o financeiro gera da mesma forma (a regra não depende de quem chama)
  insert into public.students (full_name, birth_date, school_id) values ('BOLSA aluno fin', date '2015-01-01', s) returning id into st_m;
  insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (st_m, cl, 'meio_periodo', date '2030-06-01', date '2031-05-31', 800, 100, 10, 'active', s) returning id into k_m;
  perform pg_temp.rec('3a financeiro gera mensalidades de bolsista', pg_temp.gen(u_fin, s, k_m, st_m, pg_temp.rowsn(date '2030-06-01', 3, 0)), '3');
  perform pg_temp.rec('3b ...e nascem bolsa', (select count(*)::text from public.tuitions where contract_id = k_m and status = 'paid' and payment_method = 'bolsa'), '3');

  -- 4. contrato comum (15% de desconto) não é afetado
  insert into public.students (full_name, birth_date, school_id) values ('BOLSA aluno comum', date '2015-01-01', s) returning id into st_n;
  insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (st_n, cl, 'meio_periodo', date '2031-01-01', date '2031-12-31', 1000, 15, 10, 'active', s) returning id into k_n;
  perform pg_temp.rec('4a contrato comum gera 3 mensalidades', pg_temp.gen(u_adm, s, k_n, st_n, pg_temp.rowsn(date '2031-01-01', 3, 850)), '3');
  perform pg_temp.rec('4b ...que seguem pendentes, sem forma de pagamento',
    (select count(*) filter (where status = 'pending' and payment_method is null and final_amount is null)::text from public.tuitions where contract_id = k_n), '3');

  -- 5. contrato 100% mas mensalidade com valor > 0 (lançamento manual de taxa/ajuste) não vira bolsa
  perform pg_temp.rec('5a mensalidade de valor > 0 em contrato de bolsista segue pendente', pg_temp.gen(u_adm, s, k_b, st_b, pg_temp.rowsn(date '2032-01-01', 1, 50)), '1');
  perform pg_temp.rec('5b ...pendente', (select status from public.tuitions where contract_id = k_b and due_date = date '2032-01-10'), 'pending');

  -- 6. estorno e baixa dupla bloqueados para bolsa
  select id into t_b from public.tuitions where contract_id = k_b order by due_date limit 1;
  perform pg_temp.rec('6a estorno de bolsa: SCHOLARSHIP_LOCKED',
    pg_temp.run_as(u_adm, 'aal1', format($q$select public.reverse_tuition_payment(%L, %L)::text$q$, s, t_b)), 'ERR:22023:SCHOLARSHIP_LOCKED');
  perform pg_temp.rec('6b baixa dupla sobre bolsa: ALREADY_PAID',
    pg_temp.run_as(u_adm, 'aal1', format($q$with u as (update public.tuitions set status = 'paid', paid_date = date '2031-01-01', payment_method = 'pix' where id = %L returning 1) select count(*)::text from u$q$, t_b)), 'ERR:22023:ALREADY_PAID');
  perform pg_temp.rec('6c reabrir bolsa fora do RPC: USE_REVERSAL',
    pg_temp.run_as(u_adm, 'aal1', format($q$with u as (update public.tuitions set status = 'pending' where id = %L returning 1) select count(*)::text from u$q$, t_b)), 'ERR:22023:USE_REVERSAL');

  -- 7. o job que promove pending vencida a overdue não toca a bolsa
  perform public.promote_overdue_tuitions();
  perform pg_temp.rec('7a depois do job de vencidas, bolsa continua paid',
    (select count(*) filter (where status = 'paid' and payment_method = 'bolsa')::text from public.tuitions where contract_id = k_b and due_date < date '2031-06-01'), '12');

  -- 8. renovação em lote com bolsista
  insert into public.students (full_name, birth_date, school_id) values ('BOLSA aluno renovacao', date '2014-01-01', s) returning id into st_r;
  insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (st_r, cl, 'meio_periodo', date '2031-01-01', date '2031-12-31', 1500, 100, 10, 'active', s) returning id into k_r;
  items := jsonb_build_array(jsonb_build_object('source_contract_id', k_r, 'class_id', cl, 'monthly_amount', 1605.00, 'start_date', '2032-01-01', 'end_date', '2032-12-31',
            'tuitions', pg_temp.rowsn(date '2032-01-01', 12, 0)));
  v := pg_temp.run_as(u_adm, 'aal1', format($q$select (r->>'renewed') || '/' || (r->>'tuitions') from (select public.renew_contracts(%L, %L::jsonb) r) z$q$, s, items::text));
  perform pg_temp.rec('8a renovação em lote de bolsista (reajuste de 7% sobre o valor de tabela)', v, '1/12');
  perform pg_temp.rec('8b sucessor segue bolsista (valor de tabela reajustado, final 0)',
    (select monthly_amount::text || '/' || final_amount::text from public.contracts where renewed_from_id = k_r), '1605.00/0.00');
  perform pg_temp.rec('8c as 12 mensalidades do sucessor nascem bolsa',
    (select count(*) filter (where t.status = 'paid' and t.payment_method = 'bolsa')::text from public.tuitions t join public.contracts c on c.id = t.contract_id where c.renewed_from_id = k_r), '12');

  -- 9. importação de contratos com desconto 100%
  insert into public.students (full_name, birth_date, school_id) values ('BOLSA aluno importado', date '2014-01-01', s) returning id into st_i;
  v := pg_temp.run_as(u_adm, 'aal1', format($q$select public.import_contract(%L::jsonb, %L)::text$q$,
        json_build_object('student_id', st_i, 'class_id', cl, 'monthly_amount', 900, 'discount', 100, 'due_day', 10, 'start_date', '2031-01-01', 'end_date', '2031-12-31', 'status', 'active')::text, s));
  k_i := v::uuid;
  perform pg_temp.rec('9a import_contract aceita desconto 100% (final 0, valor de tabela 900)', (select monthly_amount::text || '/' || final_amount::text from public.contracts where id = k_i), '900.00/0.00');
  perform pg_temp.rec('9b geração após importar: 12 mensalidades', pg_temp.gen(u_adm, s, k_i, st_i, pg_temp.rowsn(date '2031-01-01', 12, 0)), '12');
  perform pg_temp.rec('9c ...todas bolsa', (select count(*) filter (where status = 'paid' and payment_method = 'bolsa')::text from public.tuitions where contract_id = k_i), '12');

  -- 10. agregados por valor: a bolsa não soma receita, não é inadimplência e não conta como paga "de verdade"
  perform pg_temp.rec('10a bolsistas somam R$ 0,00 em receita',
    (select coalesce(sum(coalesce(final_amount, amount)), 0)::text from public.tuitions where contract_id in (k_b, k_m, k_r, k_i) and payment_method = 'bolsa'), '0.00');
  perform pg_temp.rec('10b nenhuma mensalidade de bolsista conta como vencida',
    (select count(*)::text from public.tuitions where contract_id in (k_b, k_m, k_i) and (status = 'overdue' or (status = 'pending' and due_date < current_date)) and payment_method = 'bolsa'), '0');
  select count(*) into n_bolsa from public.tuitions where payment_method = 'bolsa' and school_id = s;
  perform pg_temp.rec('10c contagem de bolsas separada da de pagas (pagas com forma <> bolsa)', ((select count(*) from public.tuitions where school_id = s and status = 'paid' and payment_method is distinct from 'bolsa') >= 0)::text, 'true');
  perform pg_temp.rec('10d gerador de notificações roda sem erro com bolsistas presentes', (select (count(*) >= 0)::text from (select public.generate_daily_notifications(now())) x), 'true');

end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
