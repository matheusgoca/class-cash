-- supabase/tests/update_contract_amounts_matrix.sql
-- Matriz de update_contract_amounts (S6b, bloco B). Migrations: 20261126110000_scholarship_tuitions.sql (bloco H) e
-- 20261126120000_update_contract_amounts.sql. Tudo dentro de BEGIN ... ROLLBACK: nada persiste. NUNCA remova o "rollback;".
-- ATENÇÃO: roda contra PRODUÇÃO, cria escolas de teste, move dois usuários de teste para a escola X, muda papéis e liga/desliga
-- require_2fa dentro da transação. Não rodar perto das 08:00 UTC. Personas por consulta; sem UUIDs nem nomes de escola fixos.
-- Migrations ainda NÃO aplicadas: trocar a linha marcadora MIGRATION (sozinha na linha) pelo conteúdo das duas, nessa ordem.
-- Migrations já aplicadas: npx supabase@2.117.0 db query --linked -f supabase/tests/update_contract_amounts_matrix.sql
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

-- chama o RPC como o usuário e devolve o jsonb em texto ou o erro
create function pg_temp.upd(p_uid uuid, p_school uuid, p_contract uuid, p_m numeric, p_d numeric, p_dry boolean default false, p_aal text default 'aal1')
returns text language sql as $f$
  select pg_temp.run_as(p_uid, p_aal, format('select public.update_contract_amounts(%L, %L, %s, %s, %L)::text', p_school, p_contract,
         coalesce(p_m::text, 'null'), coalesce(p_d::text, 'null'), p_dry))
$f$;

-- resumo curto do resultado: "a vencer/vencidas/bolsa/reabertas a vencer/reabertas vencidas | ajustadas/renegociadas/pagas/canceladas"
create function pg_temp.sum(p_json text) returns text language sql as $f$
  select (j->>'upcoming') || '/' || (j->>'overdue') || '/' || (j->>'to_scholarship') || '/' || (j->>'reopened_upcoming') || '/' || (j->>'reopened_overdue')
         || '|' || (j->'unchanged'->>'adjusted') || '/' || (j->'unchanged'->>'renegotiated') || '/' || (j->'unchanged'->>'paid') || '/' || (j->'unchanged'->>'cancelled')
    from (select p_json::jsonb j) z
$f$;

create function pg_temp.mkt(p_school uuid, p_contract uuid, p_student uuid, p_due date, p_status text, p_amount numeric,
                            p_paid date default null, p_final numeric default null, p_method text default null)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.tuitions (contract_id, student_id, school_id, amount, due_date, status, paid_date, final_amount, payment_method, description)
    values (p_contract, p_student, p_school, p_amount, p_due, p_status, p_paid, p_final, p_method, 'valor teste') returning id into v;
  return v;
end $f$;

-- monta o contrato de teste (1000, 0%) com 12 mensalidades em estados variados e 1 renegociação; devolve o id do contrato
create function pg_temp.mk_contract(p_school uuid, p_class uuid, p_student uuid, p_admin uuid) returns uuid language plpgsql as $f$
declare k uuid; a uuid; b uuid;
begin
  insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (p_student, p_class, 'meio_periodo', date '2025-01-01', date '2031-12-31', 1000, 0, 10, 'active', p_school) returning id into k;
  perform pg_temp.mkt(p_school, k, p_student, date '2025-01-10', 'paid', 1000, date '2025-01-09', 1000, 'pix');      -- r1 paga de verdade
  perform pg_temp.mkt(p_school, k, p_student, date '2025-02-10', 'paid', 1000, date '2025-02-12', 1000, 'dinheiro'); -- r2 paga de verdade
  perform pg_temp.mkt(p_school, k, p_student, date '2025-03-10', 'cancelled', 1000);                                  -- r3 cancelada
  perform pg_temp.mkt(p_school, k, p_student, date '2025-04-10', 'overdue', 1000);                                    -- r4 vencida
  perform pg_temp.mkt(p_school, k, p_student, date '2025-05-10', 'overdue', 1000);                                    -- r5 vencida
  perform pg_temp.mkt(p_school, k, p_student, date '2025-06-10', 'pending', 1000);                                    -- r6 pendente já vencida (job não rodou)
  a := pg_temp.mkt(p_school, k, p_student, date '2025-07-10', 'overdue', 1000);                                       -- r7 vai ser renegociada
  b := pg_temp.mkt(p_school, k, p_student, date '2025-08-10', 'overdue', 1000);                                       -- r8 vai ser renegociada
  perform pg_temp.mkt(p_school, k, p_student, date '2031-01-10', 'pending', 1000);                                    -- r9 a vencer
  perform pg_temp.mkt(p_school, k, p_student, date '2031-02-10', 'pending', 1000);                                    -- r10 a vencer
  perform pg_temp.mkt(p_school, k, p_student, date '2031-03-10', 'pending', 1000);                                    -- r11 a vencer
  perform pg_temp.mkt(p_school, k, p_student, date '2031-04-10', 'pending', 900);                                     -- r12 ajustada à mão
  perform pg_temp.run_as(p_admin, 'aal1', format($q$select public.renegotiate_tuitions(%L, %L, array[%L, %L]::uuid[], 400::numeric, 2, date '2031-06-05', 'teste', %L)::text$q$,
          p_student, p_school, a, b, p_admin));
  return k;
end $f$;

do $$
declare
  u_master uuid; u_admin uuid; u_fin uuid; s_orig uuid;
  s_x uuid; s_y uuid; s_z uuid; cl uuid; cly uuid; st uuid; sty uuid; stz uuid; k uuid; ky uuid; kz uuid; k2 uuid; st2 uuid;
  v text; v_role text; v2 text;
begin
  perform set_config('request.jwt.claims', '', true);
  select p.user_id, p.school_id into u_master, s_orig from public.profiles p where p.is_master_admin and p.school_id is not null order by p.user_id limit 1;
  select p.user_id into u_admin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_orig and not p.is_master_admin and r.role = 'admin' order by p.user_id limit 1;
  select p.user_id into u_fin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_orig and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  if u_master is null or u_admin is null or u_fin is null then raise exception 'personagens nao encontrados'; end if;

  insert into public.schools (name, owner_user_id) values ('Escola Teste Valor X', u_master) returning id into s_x;
  insert into public.schools (name, owner_user_id) values ('Escola Teste Valor Y', u_master) returning id into s_y;
  update public.profiles set school_id = s_x where user_id in (u_admin, u_fin);
  delete from auth.mfa_factors where user_id in (u_admin, u_fin);
  delete from public.mfa_grace where user_id in (u_admin, u_fin);
  insert into public.classes (name, school_id) values ('Turma', s_x) returning id into cl;
  insert into public.classes (name, school_id) values ('Turma Y', s_y) returning id into cly;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno', date '2015-01-01', s_x) returning id into st;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Y', date '2015-01-01', s_y) returning id into sty;
  perform set_config('app.audit_source', '', true);

  k := pg_temp.mk_contract(s_x, cl, st, u_admin);
  perform pg_temp.rec('0 setup: 2 pagas, 3 canceladas (1 + 2 originais renegociadas), 2 renegociadas abertas',
    (select count(*) filter (where status = 'paid')::text || '/' || count(*) filter (where status = 'cancelled')::text || '/' || count(*) filter (where renegotiation_id is not null and status = 'pending')::text from public.tuitions where contract_id = k), '2/3/2');

  -- 1. dry-run: conta sem gravar -------------------------------------------------------------------
  v := pg_temp.upd(u_admin, s_x, k, 1100, null, true);
  perform pg_temp.rec('1a dry-run: 3 a vencer, 3 vencidas | 1 ajustada, 2 renegociadas, 2 pagas, 3 canceladas', pg_temp.sum(v), '3/3/0/0/0|1/2/2/3');
  perform pg_temp.rec('1b dry-run não grava: contrato e mensalidades iguais',
    (select final_amount::text from public.contracts where id = k) || '/' || (select count(*)::text from public.tuitions where contract_id = k and amount = 1000), '1000.00/11');
  perform pg_temp.rec('1c dry-run informa o valor antigo e o novo', (v::jsonb->>'old_final') || '->' || (v::jsonb->>'new_final'), '1000.00->1100.00');

  -- 2. propagação real (valor) ----------------------------------------------------------------------
  v := pg_temp.upd(u_admin, s_x, k, 1100, null);
  perform pg_temp.rec('2a edição real devolve a mesma divisão do dry-run', pg_temp.sum(v), '3/3/0/0/0|1/2/2/3');
  perform pg_temp.rec('2b final_amount do contrato = 1100,00', (select final_amount::text from public.contracts where id = k), '1100.00');
  perform pg_temp.rec('2c as 3 a vencer e as 3 vencidas (2 overdue + 1 pending já vencida) foram para 1100,00',
    (select count(*)::text from public.tuitions where contract_id = k and amount = 1100 and status in ('pending', 'overdue')), '6');
  perform pg_temp.rec('2d a ajustada à mão (900) foi preservada', (select amount::text from public.tuitions where contract_id = k and due_date = date '2031-04-10'), '900.00');
  perform pg_temp.rec('2e as renegociadas (400) não mudaram', (select count(*)::text from public.tuitions where contract_id = k and renegotiation_id is not null and amount = 400), '2');
  perform pg_temp.rec('2f as pagas de verdade não mudaram (valor, data e forma)',
    (select string_agg(final_amount::text || '/' || paid_date::text || '/' || payment_method, ',' order by due_date) from public.tuitions where contract_id = k and status = 'paid'),
    '1000.00/2025-01-09/pix,1000.00/2025-02-12/dinheiro');
  perform pg_temp.rec('2g as canceladas não mudaram', (select count(*)::text from public.tuitions where contract_id = k and status = 'cancelled' and amount = 1000), '3');
  perform pg_temp.rec('2h status das elegíveis preservados (overdue segue overdue, pending segue pending)',
    (select count(*) filter (where status = 'overdue')::text || '/' || count(*) filter (where status = 'pending' and amount = 1100)::text from public.tuitions where contract_id = k and amount = 1100), '2/4');
  perform pg_temp.rec('2i auditoria do contrato guarda o valor antigo (old_data)',
    (select (old_data->>'monthly_amount') || '->' || (new_data->>'monthly_amount') from public.audit_logs where table_name = 'contracts' and record_id = k and action = 'update' order by created_at desc, id desc limit 1), '1000.00->1100.00');
  perform pg_temp.rec('2j auditoria das mensalidades alteradas (6 updates com amount antigo)',
    (select count(*)::text from public.audit_logs a where a.table_name = 'tuitions' and a.action = 'update' and a.old_data->>'amount' = '1000.00' and a.new_data->>'amount' = '1100.00'), '6');

  -- 3. idempotência ------------------------------------------------------------------------------------
  v := pg_temp.upd(u_admin, s_x, k, 1100, null);
  perform pg_temp.rec('3a repetir o mesmo valor não muda nada', (v::jsonb->>'changed') || '/' || (v::jsonb->>'updated'), 'false/0');

  -- 4. desconto -------------------------------------------------------------------------------------------
  v := pg_temp.upd(u_fin, s_x, k, null, 10);
  perform pg_temp.rec('4a financeiro altera o desconto (10%): 6 elegíveis (1100 -> 990)', pg_temp.sum(v), '3/3/0/0/0|1/2/2/3');
  perform pg_temp.rec('4b final_amount = 990,00 e as 6 mensalidades abertas idem',
    (select final_amount::text from public.contracts where id = k) || '/' || (select count(*)::text from public.tuitions where contract_id = k and amount = 990), '990.00/6');

  -- 5. desconto ENTRANDO em 100%: as elegíveis viram bolsa -----------------------------------------------------
  v := pg_temp.upd(u_admin, s_x, k, null, 100, true);
  perform pg_temp.rec('5a dry-run entrando em 100%: 6 viram bolsa', pg_temp.sum(v) || '/' || (v::jsonb->>'to_scholarship'), '3/3/6/0/0|1/2/2/3/6');
  v := pg_temp.upd(u_admin, s_x, k, null, 100);
  perform pg_temp.rec('5b as 6 viram paid / bolsa / final 0 / paid_date = due_date',
    (select count(*)::text from public.tuitions where contract_id = k and status = 'paid' and payment_method = 'bolsa' and final_amount = 0 and amount = 0 and paid_date = due_date), '6');
  perform pg_temp.rec('5c a ajustada, as renegociadas, as pagas e as canceladas seguem como estavam',
    (select count(*) filter (where amount = 900 and status = 'pending')::text || '/' || count(*) filter (where renegotiation_id is not null and status = 'pending')::text
            || '/' || count(*) filter (where status = 'paid' and payment_method in ('pix', 'dinheiro'))::text || '/' || count(*) filter (where status = 'cancelled')::text
       from public.tuitions where contract_id = k), '1/2/2/3');
  perform pg_temp.rec('5d contrato 100%: valor de tabela preservado e final 0', (select monthly_amount::text || '/' || final_amount::text from public.contracts where id = k), '1100.00/0.00');

  -- 6. desconto SAINDO de 100%: as de bolsa reabrem com o novo valor; pagas de verdade nunca -----------------------
  v := pg_temp.upd(u_admin, s_x, k, null, 0, true);
  perform pg_temp.rec('6a dry-run saindo de 100%: 3 reabrem a vencer e 3 reabrem vencidas', pg_temp.sum(v), '0/0/0/3/3|1/2/2/3');
  v := pg_temp.upd(u_admin, s_x, k, null, 0);
  perform pg_temp.rec('6b as 6 de bolsa reabrem com 1100,00 (3 a vencer = pending, 3 vencidas = overdue)',
    (select count(*) filter (where status = 'pending' and due_date >= current_date)::text || '/' || count(*) filter (where status = 'overdue' and due_date < current_date)::text
       from public.tuitions where contract_id = k and amount = 1100), '3/3');
  perform pg_temp.rec('6c reabertas sem data, valor final nem forma de pagamento',
    (select count(*)::text from public.tuitions where contract_id = k and amount = 1100 and paid_date is null and final_amount is null and payment_method is null), '6');
  perform pg_temp.rec('6d as 2 pagas de verdade continuam pagas e intactas',
    (select count(*)::text from public.tuitions where contract_id = k and status = 'paid' and payment_method in ('pix', 'dinheiro') and final_amount = 1000), '2');
  perform pg_temp.rec('6e nenhuma bolsa sobra no contrato', (select count(*)::text from public.tuitions where contract_id = k and payment_method = 'bolsa'), '0');

  -- 7. 100% e valor de tabela mudando juntos: bolsa só reabre/segue conforme o final
  v := pg_temp.upd(u_admin, s_x, k, 1200, 100);
  perform pg_temp.rec('7a editar valor e desconto juntos para 100%: 6 viram bolsa', (v::jsonb->>'to_scholarship') || '/' || (select final_amount::text from public.contracts where id = k), '6/0.00');
  v := pg_temp.upd(u_admin, s_x, k, 1300, 100);
  perform pg_temp.rec('7b mudar só o valor de tabela de um bolsista (continua 100%): nada a propagar', (v::jsonb->>'changed') || '/' || (v::jsonb->>'updated'), 'true/0');
  perform pg_temp.rec('7c ...e as bolsas seguem bolsa', (select count(*)::text from public.tuitions where contract_id = k and payment_method = 'bolsa'), '6');
  v := pg_temp.upd(u_admin, s_x, k, 1000, 0);
  perform pg_temp.rec('7d saindo de 100% com valor 1000: reabrem com 1000,00', (select count(*)::text from public.tuitions where contract_id = k and amount = 1000 and status in ('pending', 'overdue')), '6');

  -- 8. validações ------------------------------------------------------------------------------------------------
  perform pg_temp.rec('8a valor 0: INVALID_AMOUNT', pg_temp.upd(u_admin, s_x, k, 0, null), 'ERR:22023:INVALID_AMOUNT');
  perform pg_temp.rec('8b valor negativo: INVALID_AMOUNT', pg_temp.upd(u_admin, s_x, k, -5, null), 'ERR:22023:INVALID_AMOUNT');
  perform pg_temp.rec('8c valor acima do teto (R$ 30.000): INVALID_AMOUNT', pg_temp.upd(u_admin, s_x, k, 30001, null), 'ERR:22023:INVALID_AMOUNT');
  perform pg_temp.rec('8d desconto 101: INVALID_DISCOUNT', pg_temp.upd(u_admin, s_x, k, null, 101), 'ERR:22023:INVALID_DISCOUNT');
  perform pg_temp.rec('8e desconto negativo: INVALID_DISCOUNT', pg_temp.upd(u_admin, s_x, k, null, -1), 'ERR:22023:INVALID_DISCOUNT');
  perform pg_temp.rec('8f contrato inexistente: NOT_FOUND', pg_temp.upd(u_admin, s_x, gen_random_uuid(), 1000, null), 'ERR:22023:NOT_FOUND');
  perform pg_temp.rec('8g as recusas não alteraram o contrato', (select monthly_amount::text || '/' || discount::text from public.contracts where id = k), '1000.00/0.00');

  -- 9. papéis ---------------------------------------------------------------------------------------------------
  update public.user_roles set role = 'teacher' where user_id = u_fin;
  perform pg_temp.rec('9a professor NÃO edita (NOT_ALLOWED)', pg_temp.upd(u_fin, s_x, k, 1500, null), 'ERR:42501:NOT_ALLOWED');
  select role::text into v_role from public.user_roles where user_id = u_fin;
  delete from public.user_roles where user_id = u_fin;
  perform pg_temp.rec('9b usuário sem papel NÃO edita (fail closed)', pg_temp.upd(u_fin, s_x, k, 1500, null), 'ERR:42501:NOT_ALLOWED');
  insert into public.user_roles (user_id, role) values (u_fin, 'financial'::public.app_role);
  perform pg_temp.rec('9c professor ou sem papel não alteraram nada', (select monthly_amount::text from public.contracts where id = k), '1000.00');
  perform pg_temp.rec('9d financeiro edita', (pg_temp.upd(u_fin, s_x, k, 1000.50, null)::jsonb ? 'updated')::text, 'true');

  -- 10. outra escola -----------------------------------------------------------------------------------------------
  insert into public.contracts (student_id, class_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (sty, cly, 'meio_periodo', date '2031-01-01', date '2031-12-31', 1000, 0, 10, 'active', s_y) returning id into ky;
  perform pg_temp.mkt(s_y, ky, sty, date '2031-01-10', 'pending', 1000);
  perform pg_temp.rec('10a admin da X passando a escola Y: NOT_ALLOWED', pg_temp.upd(u_admin, s_y, ky, 1500, null), 'ERR:42501:NOT_ALLOWED');
  perform pg_temp.rec('10b admin da X passando a própria escola com contrato da Y: NOT_FOUND', pg_temp.upd(u_admin, s_x, ky, 1500, null), 'ERR:22023:NOT_FOUND');
  perform pg_temp.rec('10c o contrato e a mensalidade da Y seguem intactos', (select c.monthly_amount::text || '/' || (select amount::text from public.tuitions where contract_id = ky) from public.contracts c where c.id = ky), '1000.00/1000.00');

  -- 11. 2FA e master em escola alheia -------------------------------------------------------------------------------
  update public.schools set require_2fa = true where id = s_x;
  perform pg_temp.rec('11a escola com 2FA exigido e sessão aal1: barrado pelo gate', case when pg_temp.upd(u_admin, s_x, k, 1600, null) like 'ERR:%' then 'barrado' else 'passou' end, 'barrado');
  update public.schools set require_2fa = false where id = s_x;
  insert into public.schools (name, owner_user_id) values ('Escola Teste Valor Z', u_admin) returning id into s_z;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Z', date '2015-01-01', s_z) returning id into stz;
  insert into public.contracts (student_id, period, start_date, end_date, monthly_amount, discount, due_day, status, school_id)
    values (stz, 'meio_periodo', date '2031-01-01', date '2031-12-31', 1000, 0, 10, 'active', s_z) returning id into kz;
  perform pg_temp.mkt(s_z, kz, stz, date '2031-01-10', 'pending', 1000);
  delete from public.mfa_grace where user_id = u_master;
  v := pg_temp.upd(u_master, s_z, kz, 1250, null, false, 'aal2');
  perform pg_temp.rec('11b master edita contrato de escola alheia (aal2)', pg_temp.sum(v), '1/0/0/0/0|0/0/0/0');
  perform pg_temp.rec('11c ...na escola do contrato', (select school_id = s_z and amount = 1250 from public.tuitions where contract_id = kz)::text, 'true');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
