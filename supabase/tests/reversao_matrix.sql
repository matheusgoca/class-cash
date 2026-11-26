-- supabase/tests/reversao_matrix.sql
-- Plano de reversão de erros de cadastro (ensaio de 25/11/2026): estorno de baixa, exclusão de contrato e mensalidades,
-- desfazer lote de renovação, identificar importação pela auditoria e provar que a auditoria é append-only.
-- Relatório: docs/ENSAIO_GERAL_2026-11-25.md. Tudo dentro de BEGIN ... ROLLBACK; NUNCA remova o "rollback;" do final.
-- Personas por consulta (escola de casa do master, seu admin e seu financeiro); sem UUIDs nem nomes fixos.
-- Como rodar: npx supabase@2.117.0 db query --linked -f supabase/tests/reversao_matrix.sql ("ok" deve ser true em TODAS)

begin;
create temp table t_res (n serial, cenario text, got text, esperado text, ok boolean);
create function pg_temp.run_as(p_uid uuid, p_aal text, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'aal', p_aal, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into v;
  exception when others then v := 'ERR:' || sqlstate || ':' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;
create function pg_temp.rec(p_c text, p_got text, p_e text) returns void language sql as $f$
  insert into t_res (cenario, got, esperado, ok) values (p_c, p_got, p_e, coalesce(p_got = p_e or (p_e like 'ERR:%' and p_got like 'ERR:%'), false)) $f$;

do $do$
declare
  s uuid; adm uuid; fin uuid; v text;
  cl uuid := gen_random_uuid();
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid(); st3 uuid := gen_random_uuid(); st4 uuid := gen_random_uuid();
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid(); ks1 uuid := gen_random_uuid(); ks2 uuid := gen_random_uuid();
  t1 uuid; kimp uuid; ts0 timestamptz;
begin
  select p.school_id into s from public.profiles p where p.is_master_admin and p.school_id is not null order by p.user_id limit 1;
  select p.user_id into adm from public.profiles p join public.user_roles r on r.user_id = p.user_id where p.school_id = s and not p.is_master_admin and r.role = 'admin' order by p.user_id limit 1;
  select p.user_id into fin from public.profiles p join public.user_roles r on r.user_id = p.user_id where p.school_id = s and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  if s is null or adm is null or fin is null then raise exception 'personagens nao encontrados'; end if;
  ts0 := now();

  insert into public.classes (id, name, school_id, monthly_fee) values (cl, 'REVERSAO turma', s, 1000);
  insert into public.students (id, full_name, birth_date, school_id) values
    (st1, 'REVERSAO a', date '2015-01-01', s), (st2, 'REVERSAO b', date '2015-01-01', s), (st3, 'REVERSAO c', date '2015-01-01', s), (st4, 'REVERSAO d', date '2015-01-01', s);

  -- contrato k1 com 3 mensalidades, uma paga
  insert into public.contracts (id, student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (k1, st1, cl, 'meio_periodo', date '2027-01-01', date '2027-03-31', 1000, 0, 10, 'active', s);
  insert into public.tuitions (contract_id, student_id, school_id, amount, due_date, status, description)
    select k1, st1, s, 1000, d, 'pending', 'REVERSAO' from unnest(array[date '2027-01-10', date '2027-02-10', date '2027-03-10']) d;
  select id into t1 from public.tuitions where contract_id = k1 order by due_date limit 1;
  update public.tuitions set status='paid', paid_date=date '2026-11-25', payment_method='pix', final_amount=1000 where id = t1;

  -- R1. estorno de baixa (o app nao oferece) como admin e como financeiro
  v := pg_temp.run_as(adm, 'aal1', format($q$with u as (update public.tuitions set status='pending', paid_date=null where id = %L and school_id = %L returning 1) select count(*)::text from u$q$, t1::text, s::text));
  perform pg_temp.rec('R1-0 reabrir por UPDATE direto é barrado (USE_REVERSAL); só o RPC estorna', case when v like 'ERR:%' then 'barrado' else v end, 'barrado');
  v := pg_temp.run_as(adm, 'aal1', format($q$select public.reverse_tuition_payment(%L, %L)->>'id'$q$, s::text, t1::text));
  perform pg_temp.rec('R1 estorno de baixa pelo RPC reverse_tuition_payment (volta a pendente, limpa data, valor final e forma) como ADMIN', v, t1::text);
  perform pg_temp.rec('R1b estado depois do estorno', (select status || '/' || coalesce(paid_date::text,'-') || '/' || coalesce(final_amount::text,'-') from public.tuitions where id = t1), 'pending/-/-');
  update public.tuitions set status='paid', paid_date=date '2026-11-25', payment_method='pix', final_amount=1000 where id = t1;
  v := pg_temp.run_as(fin, 'aal1', format($q$select public.reverse_tuition_payment(%L, %L)->>'id'$q$, s::text, t1::text));
  perform pg_temp.rec('R1c estorno de baixa como FINANCEIRO', v, t1::text);

  -- R2. excluir contrato lancado errado (mensalidades primeiro, depois o contrato)
  v := pg_temp.run_as(adm, 'aal1', format($q$with d as (delete from public.contracts where id = %L and school_id = %L returning 1) select count(*)::text from d$q$, k1::text, s::text));
  perform pg_temp.rec('R2 excluir o contrato ANTES das mensalidades: banco recusa (FK)', case when v like 'ERR:%' then 'ERR:' else v end, 'ERR:');
  v := pg_temp.run_as(adm, 'aal1', format($q$with d as (delete from public.tuitions where contract_id = %L and school_id = %L returning 1) select count(*)::text from d$q$, k1::text, s::text));
  perform pg_temp.rec('R2b excluir as 3 mensalidades do contrato como ADMIN', v, '3');
  v := pg_temp.run_as(adm, 'aal1', format($q$with d as (delete from public.contracts where id = %L and school_id = %L returning 1) select count(*)::text from d$q$, k1::text, s::text));
  perform pg_temp.rec('R2c excluir o contrato como ADMIN', v, '1');
  perform pg_temp.rec('R2d a trilha de auditoria guarda o contrato apagado (old_data)', (select count(*)::text from public.audit_logs where table_name='contracts' and record_id = k1 and action='delete' and old_data is not null), '1');
  perform pg_temp.rec('R2e a trilha guarda as 3 mensalidades apagadas (old_data)', (select count(*)::text from public.audit_logs where table_name='tuitions' and action='delete' and old_data->>'contract_id' = k1::text), '3');

  -- R3. mesmo caminho como FINANCEIRO
  insert into public.contracts (id, student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (k2, st2, cl, 'meio_periodo', date '2027-01-01', date '2027-02-28', 1000, 0, 10, 'active', s);
  insert into public.tuitions (contract_id, student_id, school_id, amount, due_date, status, description)
    select k2, st2, s, 1000, d, 'pending', 'REVERSAO' from unnest(array[date '2027-01-10', date '2027-02-10']) d;
  v := pg_temp.run_as(fin, 'aal1', format($q$with d as (delete from public.tuitions where contract_id = %L and school_id = %L returning 1) select count(*)::text from d$q$, k2::text, s::text));
  perform pg_temp.rec('R3 financeiro exclui mensalidades', v, '2');
  v := pg_temp.run_as(fin, 'aal1', format($q$with d as (delete from public.contracts where id = %L and school_id = %L returning 1) select count(*)::text from d$q$, k2::text, s::text));
  perform pg_temp.rec('R3b financeiro exclui contrato', v, '1');

  -- R4. desfazer lote de renovacao: sucessor sai (mensalidades, depois contrato); origem continua
  insert into public.contracts (id, student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (ks1, st3, cl, 'meio_periodo', date '2026-01-01', date '2026-12-31', 1000, 0, 10, 'active', s);
  v := pg_temp.run_as(adm, 'aal1', format($q$select (r->>'renewed') from (select public.renew_contracts(%L, jsonb_build_array(jsonb_build_object('source_contract_id', %L, 'class_id', %L, 'monthly_amount', 1070, 'start_date', '2027-01-01', 'end_date', '2027-12-31', 'tuitions', (select jsonb_agg(jsonb_build_object('due_date', to_char(d,'YYYY-MM-DD'), 'amount', 1070, 'status', 'pending', 'description', 'REVERSAO renov')) from generate_series(date '2027-01-10', date '2027-12-10', interval '1 month') d)))) r) z$q$, s::text, ks1::text, cl::text));
  perform pg_temp.rec('R4 renovação de 1 contrato (setup do desfazer)', v, '1');
  v := pg_temp.run_as(adm, 'aal1', format($q$with d as (delete from public.tuitions where contract_id in (select id from public.contracts where renewed_from_id = %L and school_id = %L) returning 1) select count(*)::text from d$q$, ks1::text, s::text));
  perform pg_temp.rec('R4b desfazer renovação: excluir as 12 mensalidades do sucessor', v, '12');
  v := pg_temp.run_as(adm, 'aal1', format($q$with d as (delete from public.contracts where renewed_from_id = %L and school_id = %L returning 1) select count(*)::text from d$q$, ks1::text, s::text));
  perform pg_temp.rec('R4c desfazer renovação: excluir o contrato sucessor', v, '1');
  perform pg_temp.rec('R4d a origem segue ativa e volta a aparecer como "a renovar"', (select status from public.contracts where id = ks1), 'active');

  -- R5. desfazer uma importacao pela trilha (source = import)
  v := pg_temp.run_as(adm, 'aal1', format($q$select public.import_contract(%L::jsonb, %L)::text$q$, json_build_object('student_id', st4, 'class_id', cl, 'monthly_amount', 500, 'discount', 0, 'due_day', 10, 'start_date', '2027-01-01', 'end_date', '2027-12-31', 'status', 'active')::text, s::text));
  perform pg_temp.rec('R5 importa 1 contrato (setup do desfazer)', (v ~ '^[0-9a-f-]{36}$')::text, 'true');
  kimp := v::uuid;
  perform pg_temp.rec('R5b a auditoria identifica o lote importado (source=import, escola, janela de tempo)', (select count(*)::text from public.audit_logs where school_id = s and table_name = 'contracts' and source = 'import' and action = 'insert' and created_at >= ts0 and record_id = kimp), '1');

  -- R6. a trilha em si e append-only
  v := pg_temp.run_as(adm, 'aal1', format($q$with d as (delete from public.audit_logs where record_id = %L returning 1) select count(*)::text from d$q$, kimp::text));
  perform pg_temp.rec('R6 admin NÃO consegue apagar a trilha de auditoria', case when v like 'ERR:%' or v = '0' then 'protegida' else v end, 'protegida');
  v := pg_temp.run_as(adm, 'aal1', format($q$with d as (update public.audit_logs set source = 'manual' where record_id = %L returning 1) select count(*)::text from d$q$, kimp::text));
  perform pg_temp.rec('R6b admin NÃO consegue alterar a trilha de auditoria', case when v like 'ERR:%' or v = '0' then 'protegida' else v end, 'protegida');
end $do$;
select n, cenario, got, esperado, ok from t_res order by n;
rollback;
