-- supabase/tests/tuition_reversal_matrix.sql
-- Matriz do estorno de baixa e da trava de baixa dupla (S6b, bloco D). Migration: 20261126100000_tuition_reversal.sql.
-- Tudo dentro de BEGIN ... ROLLBACK: nada persiste. NUNCA remova o "rollback;" do final.
-- ATENÇÃO: roda contra PRODUÇÃO, cria escolas de teste, move dois usuários de teste para a escola X, muda papéis e
-- liga/desliga require_2fa dentro da transação. Não rodar perto das 08:00 UTC.
-- Migration ainda NÃO aplicada: gerar um arquivo que troca a linha marcadora MIGRATION (sozinha na linha) pelo conteúdo
-- de 20261126100000_tuition_reversal.sql. Migration já aplicada: npx supabase@2.117.0 db query --linked -f supabase/tests/tuition_reversal_matrix.sql
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

-- estorna como o usuário e devolve o jsonb em texto ou o erro
create function pg_temp.rev(p_uid uuid, p_school uuid, p_tuition uuid, p_aal text default 'aal1') returns text language sql as $f$
  select pg_temp.run_as(p_uid, p_aal, format('select public.reverse_tuition_payment(%L, %L)::text', p_school, p_tuition))
$f$;

-- UPDATE direto como o usuário; devolve a quantidade de linhas ou o erro
create function pg_temp.upd(p_uid uuid, p_set text, p_id uuid) returns text language sql as $f$
  select pg_temp.run_as(p_uid, 'aal1', format('with u as (update public.tuitions set %s where id = %L returning 1) select count(*)::text from u', p_set, p_id))
$f$;

-- mensalidade de teste no estado pedido
create function pg_temp.mkt(p_school uuid, p_contract uuid, p_student uuid, p_due date, p_status text, p_amount numeric,
                            p_paid date default null, p_final numeric default null, p_method text default null)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.tuitions (contract_id, student_id, school_id, amount, due_date, status, paid_date, final_amount, payment_method, description,
                               discount_applied, penalty_amount)
    values (p_contract, p_student, p_school, p_amount, p_due, p_status, p_paid, p_final, p_method, 'estorno teste',
            case when p_status = 'paid' then 20 end, case when p_status = 'paid' then 5 end)
    returning id into v;
  return v;
end $f$;

do $$
declare
  u_master uuid; u_admin uuid; u_fin uuid; s_orig uuid;
  s_x uuid; s_y uuid; s_z uuid; cl uuid; cly uuid; st uuid; sty uuid; stz uuid; k uuid; ky uuid; kz uuid;
  t_pago uuid; t_pago2 uuid; t_fin uuid; t_prof uuid; t_pend uuid; t_over uuid; t_canc uuid; t_bolsa uuid; t_y uuid; t_z uuid;
  t_dupla uuid; t_reabre uuid; t_cancela uuid; t_baixa uuid; t_escape uuid; t_mfa uuid; t_seq uuid;
  v text; antes numeric; depois numeric; r jsonb; v_role text;
begin
  perform set_config('request.jwt.claims', '', true);
  select p.user_id, p.school_id into u_master, s_orig from public.profiles p where p.is_master_admin and p.school_id is not null order by p.user_id limit 1;
  select p.user_id into u_admin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_orig and not p.is_master_admin and r.role = 'admin' order by p.user_id limit 1;
  select p.user_id into u_fin from public.profiles p join public.user_roles r on r.user_id = p.user_id
   where p.school_id = s_orig and not p.is_master_admin and r.role = 'financial' order by p.user_id limit 1;
  if u_master is null or u_admin is null or u_fin is null then raise exception 'personagens nao encontrados'; end if;

  insert into public.schools (name, owner_user_id) values ('Escola Teste Estorno X', u_master) returning id into s_x;
  insert into public.schools (name, owner_user_id) values ('Escola Teste Estorno Y', u_master) returning id into s_y;
  update public.profiles set school_id = s_x where user_id in (u_admin, u_fin);
  delete from auth.mfa_factors where user_id in (u_admin, u_fin);
  delete from public.mfa_grace where user_id in (u_admin, u_fin);

  insert into public.classes (name, school_id) values ('Turma', s_x) returning id into cl;
  insert into public.classes (name, school_id) values ('Turma Y', s_y) returning id into cly;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno', date '2015-01-01', s_x) returning id into st;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Y', date '2015-01-01', s_y) returning id into sty;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (st, cl, s_x, date '2031-01-01', date '2031-12-31', 'active', 1000, 0, 10, 'meio_periodo') returning id into k;
  insert into public.contracts (student_id, class_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (sty, cly, s_y, date '2031-01-01', date '2031-12-31', 'active', 1000, 0, 10, 'meio_periodo') returning id into ky;
  perform set_config('app.audit_source', '', true);

  -- 1. estorno básico -----------------------------------------------------------------------
  t_pago := pg_temp.mkt(s_x, k, st, date '2031-01-10', 'paid', 1000, date '2031-01-08', 985, 'pix');
  select coalesce(sum(coalesce(final_amount, amount)), 0) into antes from public.tuitions
   where school_id = s_x and status = 'paid' and paid_date >= date '2031-01-01' and paid_date < date '2031-02-01';
  r := pg_temp.rev(u_admin, s_x, t_pago)::jsonb;
  perform pg_temp.rec('1a admin estorna: devolve o que foi desfeito', (r->>'previous_final_amount') || '/' || (r->>'previous_payment_method') || '/' || (r->>'previous_paid_date'), '985.00/pix/2031-01-08');
  perform pg_temp.rec('1b volta a pending e limpa paid_date, final_amount e forma',
    (select status || '/' || coalesce(paid_date::text, '-') || '/' || coalesce(final_amount::text, '-') || '/' || coalesce(payment_method, '-') from public.tuitions where id = t_pago), 'pending/-/-/-');
  perform pg_temp.rec('1c desconto e multa aplicados são preservados',
    (select discount_applied::text || '/' || penalty_amount::text from public.tuitions where id = t_pago), '20.00/5.00');
  select coalesce(sum(coalesce(final_amount, amount)), 0) into depois from public.tuitions
   where school_id = s_x and status = 'paid' and paid_date >= date '2031-01-01' and paid_date < date '2031-02-01';
  perform pg_temp.rec('1d o Realizado do mês cai exatamente o valor estornado (R$ 985,00)', (antes - depois)::text, '985.00');
  perform pg_temp.rec('1e auditoria guarda o estado anterior (old_data: paga, R$ 985, pix)',
    (select (old_data->>'status') || '/' || (old_data->>'final_amount') || '/' || (old_data->>'payment_method') from public.audit_logs
      where table_name = 'tuitions' and record_id = t_pago and action = 'update' order by created_at desc, id desc limit 1), 'paid/985.00/pix');
  perform pg_temp.rec('1f estornar de novo a mesma mensalidade: NOT_PAID', pg_temp.rev(u_admin, s_x, t_pago), 'ERR:22023:NOT_PAID');

  -- 2. papéis ---------------------------------------------------------------------------------
  t_fin := pg_temp.mkt(s_x, k, st, date '2031-02-10', 'paid', 1000, date '2031-02-09', 1000, 'dinheiro');
  perform pg_temp.rec('2a financeiro estorna', (pg_temp.rev(u_fin, s_x, t_fin)::jsonb ? 'id')::text, 'true');
  t_prof := pg_temp.mkt(s_x, k, st, date '2031-03-10', 'paid', 1000, date '2031-03-09', 1000, 'pix');
  update public.user_roles set role = 'teacher' where user_id = u_fin;
  perform pg_temp.rec('2b professor NÃO estorna', pg_temp.rev(u_fin, s_x, t_prof), 'ERR:42501:NOT_ALLOWED');
  select role::text into v_role from public.user_roles where user_id = u_fin;
  delete from public.user_roles where user_id = u_fin;
  perform pg_temp.rec('2c usuário sem papel NÃO estorna (fail closed)', pg_temp.rev(u_fin, s_x, t_prof), 'ERR:42501:NOT_ALLOWED');
  insert into public.user_roles (user_id, role) values (u_fin, 'financial'::public.app_role);
  perform pg_temp.rec('2d a mensalidade negada continua paga', (select status from public.tuitions where id = t_prof), 'paid');

  -- 3. outra escola -----------------------------------------------------------------------------
  t_y := pg_temp.mkt(s_y, ky, sty, date '2031-01-10', 'paid', 1000, date '2031-01-09', 1000, 'pix');
  perform pg_temp.rec('3a admin da X passando a escola Y: NOT_ALLOWED', pg_temp.rev(u_admin, s_y, t_y), 'ERR:42501:NOT_ALLOWED');
  perform pg_temp.rec('3b admin da X passando a própria escola com mensalidade da Y: NOT_FOUND', pg_temp.rev(u_admin, s_x, t_y), 'ERR:22023:NOT_FOUND');
  perform pg_temp.rec('3c a mensalidade da Y continua paga', (select status from public.tuitions where id = t_y), 'paid');

  -- 4. estados que não podem ser estornados -------------------------------------------------------
  t_pend := pg_temp.mkt(s_x, k, st, date '2031-04-10', 'pending', 1000);
  t_over := pg_temp.mkt(s_x, k, st, date '2031-05-10', 'overdue', 1000);
  t_canc := pg_temp.mkt(s_x, k, st, date '2031-06-10', 'cancelled', 1000);
  perform pg_temp.rec('4a pendente: NOT_PAID', pg_temp.rev(u_admin, s_x, t_pend), 'ERR:22023:NOT_PAID');
  perform pg_temp.rec('4b vencida: NOT_PAID', pg_temp.rev(u_admin, s_x, t_over), 'ERR:22023:NOT_PAID');
  perform pg_temp.rec('4c cancelada: NOT_PAID', pg_temp.rev(u_admin, s_x, t_canc), 'ERR:22023:NOT_PAID');
  t_bolsa := pg_temp.mkt(s_x, k, st, date '2031-07-10', 'paid', 0, date '2031-07-10', 0, 'bolsa');
  perform pg_temp.rec('4d bolsa 100% (forma "bolsa"): SCHOLARSHIP_LOCKED', pg_temp.rev(u_admin, s_x, t_bolsa), 'ERR:22023:SCHOLARSHIP_LOCKED');
  perform pg_temp.rec('4e ...e continua paga', (select status from public.tuitions where id = t_bolsa), 'paid');
  perform pg_temp.rec('4f id inexistente: NOT_FOUND', pg_temp.rev(u_admin, s_x, gen_random_uuid()), 'ERR:22023:NOT_FOUND');

  -- 5. trava de baixa dupla e reabertura por fora do RPC ------------------------------------------
  t_dupla := pg_temp.mkt(s_x, k, st, date '2031-08-10', 'paid', 1000, date '2031-08-09', 1000, 'pix');
  perform pg_temp.rec('5a baixa dupla (paid -> paid com outra paid_date): ALREADY_PAID', pg_temp.upd(u_admin, $s$status='paid', paid_date = date '2031-08-20'$s$, t_dupla), 'ERR:22023:ALREADY_PAID');
  perform pg_temp.rec('5b baixa dupla mudando o valor final: ALREADY_PAID', pg_temp.upd(u_admin, $s$final_amount = 1, status='paid'$s$, t_dupla), 'ERR:22023:ALREADY_PAID');
  perform pg_temp.rec('5c ...e a data original foi preservada', (select paid_date::text from public.tuitions where id = t_dupla), '2031-08-09');
  perform pg_temp.rec('5d mexer em outro campo de uma paga (descrição) segue permitido', pg_temp.upd(u_admin, $s$description = 'ajuste'$s$, t_dupla), '1');
  t_reabre := pg_temp.mkt(s_x, k, st, date '2031-09-10', 'paid', 1000, date '2031-09-09', 1000, 'pix');
  perform pg_temp.rec('5e reabrir paga direto (paid -> pending) fora do RPC: USE_REVERSAL', pg_temp.upd(u_admin, $s$status='pending', paid_date=null$s$, t_reabre), 'ERR:22023:USE_REVERSAL');
  perform pg_temp.rec('5f reabrir direto como overdue: USE_REVERSAL', pg_temp.upd(u_admin, $s$status='overdue'$s$, t_reabre), 'ERR:22023:USE_REVERSAL');
  t_cancela := pg_temp.mkt(s_x, k, st, date '2031-10-10', 'paid', 1000, date '2031-10-09', 1000, 'pix');
  perform pg_temp.rec('5g cancelar uma mensalidade paga continua permitido (não é baixa nem estorno)', pg_temp.upd(u_admin, $s$status='cancelled'$s$, t_cancela), '1');
  t_baixa := pg_temp.mkt(s_x, k, st, date '2031-11-10', 'pending', 1000);
  perform pg_temp.rec('5h baixa normal (pending -> paid) continua funcionando', pg_temp.upd(u_admin, $s$status='paid', paid_date = date '2031-11-09', final_amount = 1000, payment_method = 'pix'$s$, t_baixa), '1');
  perform pg_temp.rec('5i ...e depois estorna pelo RPC', (pg_temp.rev(u_admin, s_x, t_baixa)::jsonb ? 'id')::text, 'true');
  perform pg_temp.rec('5j ...e a mensalidade pode ser paga de novo (ciclo completo)', pg_temp.upd(u_admin, $s$status='paid', paid_date = date '2031-11-12', final_amount = 1000, payment_method = 'dinheiro'$s$, t_baixa), '1');
  -- correção administrativa por script (postgres) com o escape explícito
  t_escape := pg_temp.mkt(s_x, k, st, date '2031-12-10', 'paid', 750, date '2031-12-09', 0, 'pix');
  begin
    update public.tuitions set final_amount = 750 where id = t_escape;
    v := 'sem trava';
  exception when others then v := sqlerrm; end;
  perform pg_temp.rec('5k script administrativo sem o escape também é barrado', v, 'ALREADY_PAID');
  perform set_config('app.allow_paid_edit', 'on', true);
  update public.tuitions set final_amount = 750 where id = t_escape;
  perform set_config('app.allow_paid_edit', '', true);
  perform pg_temp.rec('5l com app.allow_paid_edit=on o script corrige o valor', (select final_amount::text from public.tuitions where id = t_escape), '750.00');

  -- 6. 2FA: escola que exige 2FA ------------------------------------------------------------------
  update public.schools set require_2fa = true where id = s_x;
  t_mfa := pg_temp.mkt(s_x, k, st, date '2032-01-10', 'paid', 1000, date '2032-01-09', 1000, 'pix');
  perform pg_temp.rec('6a admin com 2FA exigido e sessão aal1: barrado pelo gate', case when pg_temp.rev(u_admin, s_x, t_mfa) like 'ERR:%' then 'barrado' else 'passou' end, 'barrado');
  perform pg_temp.rec('6b ...a mensalidade continua paga', (select status from public.tuitions where id = t_mfa), 'paid');
  update public.schools set require_2fa = false where id = s_x;

  -- 7. master em escola alheia (aal2) ---------------------------------------------------------------
  insert into public.schools (name, owner_user_id) values ('Escola Teste Estorno Z', u_admin) returning id into s_z;
  insert into public.students (full_name, birth_date, school_id) values ('Aluno Z', date '2015-01-01', s_z) returning id into stz;
  insert into public.contracts (student_id, school_id, start_date, end_date, status, monthly_amount, discount, due_day, period)
    values (stz, s_z, date '2031-01-01', date '2031-12-31', 'active', 1000, 0, 10, 'meio_periodo') returning id into kz;
  t_z := pg_temp.mkt(s_z, kz, stz, date '2031-01-10', 'paid', 1000, date '2031-01-09', 1000, 'pix');
  delete from public.mfa_grace where user_id = u_master;
  perform pg_temp.rec('7a master estorna em escola alheia (aal2)', (pg_temp.rev(u_master, s_z, t_z, 'aal2')::jsonb ? 'id')::text, 'true');
  perform pg_temp.rec('7b ...e a mensalidade é da escola Z', (select (school_id = s_z and status = 'pending')::text from public.tuitions where id = t_z), 'true');

  -- 8. serialização: dois estornos em sequência só valem um
  t_seq := pg_temp.mkt(s_x, k, st, date '2032-02-10', 'paid', 1000, date '2032-02-09', 1000, 'pix');
  perform pg_temp.rec('8a 1º estorno', (pg_temp.rev(u_admin, s_x, t_seq)::jsonb ? 'id')::text, 'true');
  perform pg_temp.rec('8b 2º estorno', pg_temp.rev(u_fin, s_x, t_seq), 'ERR:22023:NOT_PAID');
  perform pg_temp.rec('8c uma só linha de auditoria de estorno para a mensalidade',
    (select count(*)::text from public.audit_logs where table_name = 'tuitions' and record_id = t_seq and action = 'update'), '1');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
