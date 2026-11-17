-- Matriz do gate de 2FA no banco (Fase 3, S2): RLS real + view + RPCs.
--
-- Complementa mfa_gate_matrix.sql (que testa a função mfa_gate_ok() em si).
-- Aqui o teste é de ponta a ponta: SET ROLE authenticated/anon com JWT simulado
-- e consultas de verdade nas tabelas.
--
-- Tudo roda dentro de BEGIN ... ROLLBACK: nada persiste. Pré-requisito: a
-- migration 20261117120000 (mfa_gate_ok etc.) já aplicada.
--
-- Como rodar ANTES de aplicar B e C: gerar um arquivo que substitui as linhas
-- marcadoras "-- @@MIGRATION_B@@" e "-- @@MIGRATION_C@@" pelo conteúdo das
-- migrations 20261117121000 e 20261117122000, e rodar esse arquivo com
--   supabase db query --linked -f <arquivo>
-- Depois de aplicadas, rodar este arquivo direto.
-- Saída: uma linha por verificação; "ok" deve ser true em TODAS.

begin;

-- @@MIGRATION_B@@
-- @@MIGRATION_C@@

create temp table t_res (n serial, cenario text, got text, esperado text, ok boolean);

-- Roda um SELECT escalar como um usuário/papel simulado (RLS de verdade) e
-- devolve o resultado em texto, ou 'ERR:<sqlstate>' se falhar.
create function pg_temp.run_as(p_uid uuid, p_aal text, p_sql text, p_role text default 'authenticated')
returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then json_build_object('role', p_role)::text
         else json_build_object('sub', p_uid, 'aal', p_aal, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERR:' || sqlstate;
  end;
  reset role;
  return v;
end $f$;

create function pg_temp.rec(p_cenario text, p_got text, p_esperado text) returns void language sql as $f$
  insert into t_res (cenario, got, esperado, ok) values (p_cenario, p_got, p_esperado, p_got = p_esperado)
$f$;

do $$
declare
  u_owner_p uuid := '03065019-c9b4-4163-a4c9-b89a6cd12986'; -- owner+admin, Colégio Pensar
  u_fin_p   uuid := '77acd93b-6112-4373-b748-9800c0080a04'; -- financeiro, Colégio Pensar
  u_master  uuid := '52d00ab5-567f-4537-b33a-22c2bd44e14d'; -- master (+owner do Colegio Teste)
  u_admin_t uuid := 'e0185312-eea9-4273-a9a8-ad9d575d4781'; -- admin, Colegio Teste
  s_pensar  uuid := '2b1e5eba-6cf9-4cb1-a742-eecca53ab5d5';
  s_teste   uuid := 'aaaf9993-908f-43f2-9d3d-dc12357d7468';

  q_stu_p   text := format('select count(*)::text from public.students where school_id = %L', s_pensar);
  q_stu_t   text := format('select count(*)::text from public.students where school_id = %L', s_teste);
  q_stu_all text := 'select count(*)::text from public.students';
  q_tui_all text := 'select count(*)::text from public.tuitions';
  q_tui_p   text := format('select count(*)::text from public.tuitions where school_id = %L', s_pensar);
  q_aud_p   text := format('select count(*)::text from public.audit_logs where school_id = %L', s_pensar);
  q_dir_p   text := format('select count(*)::text from public.teachers_directory where school_id = %L', s_pensar);
  q_upd_stu text := format('with x as (update public.students set full_name = full_name where school_id = %L returning 1) select count(*)::text from x', s_pensar);
  q_sal     text := format('select public.get_active_teachers_salary_sum(%L)::text', s_pensar);
  q_imp     text := format($q$select public.import_teacher('{"full_name":"Teste MFA","email":"mfa-test@example.invalid","phone":"1","salary":1,"status":"active"}'::jsonb, %L)::text$q$, s_pensar);

  b_stu_p int; b_stu_t int; b_stu_all int; b_tui_p int; b_tui_all int; b_aud_p int; b_tch_p int;
  v text;
begin
  -- O teste não pode depender do estado real: o master e outros usuários podem
  -- ter fator verificado ou carência em produção. Dentro da transação, limpa os
  -- dos usuários de teste (o ROLLBACK devolve tudo).
  delete from auth.mfa_factors where user_id in (u_owner_p, u_fin_p, u_master, u_admin_t);
  delete from public.mfa_grace  where user_id in (u_owner_p, u_fin_p, u_master, u_admin_t);

  -- linha de base (como postgres, sem RLS)
  select count(*) into b_stu_p   from public.students where school_id = s_pensar;
  select count(*) into b_stu_t   from public.students where school_id = s_teste;
  select count(*) into b_stu_all from public.students;
  select count(*) into b_tui_p   from public.tuitions where school_id = s_pensar;
  select count(*) into b_aud_p   from public.audit_logs where school_id = s_pensar;
  select count(*) into b_tch_p   from public.teachers where school_id = s_pensar;
  select count(*) into b_tui_all from public.tuitions;
  perform pg_temp.rec('base: há alunos, professores e mensalidades para o teste fazer sentido',
    (b_stu_p > 0 and b_tch_p > 0 and b_tui_all > 0)::text, 'true');

  -- Pensar passa a exigir 2FA (como service role; o trigger deixa passar)
  perform set_config('request.jwt.claims', '', true);
  update public.schools set require_2fa = true where id = s_pensar;

  -- ===== G1: owner exigido, sem fator e sem carência → BLOQUEADO =====
  perform pg_temp.rec('G1a owner bloqueado: students',          pg_temp.run_as(u_owner_p, 'aal1', q_stu_p), '0');
  perform pg_temp.rec('G1b owner bloqueado: tuitions',          pg_temp.run_as(u_owner_p, 'aal1', q_tui_p), '0');
  perform pg_temp.rec('G1c owner bloqueado: audit_logs',        pg_temp.run_as(u_owner_p, 'aal1', q_aud_p), '0');
  perform pg_temp.rec('G1d owner bloqueado: teachers_directory', pg_temp.run_as(u_owner_p, 'aal1', q_dir_p), '0');
  perform pg_temp.rec('G1e owner bloqueado: UPDATE em students não afeta nada', pg_temp.run_as(u_owner_p, 'aal1', q_upd_stu), '0');

  -- ===== G2: owner na carência → LIBERADO =====
  insert into public.mfa_grace (user_id, grace_until) values (u_owner_p, now() + interval '3 days');
  perform pg_temp.rec('G2a owner na carência: students',  pg_temp.run_as(u_owner_p, 'aal1', q_stu_p), b_stu_p::text);
  perform pg_temp.rec('G2b owner na carência: tuitions',  pg_temp.run_as(u_owner_p, 'aal1', q_tui_p), b_tui_p::text);
  perform pg_temp.rec('G2c owner na carência: teachers_directory', pg_temp.run_as(u_owner_p, 'aal1', q_dir_p), b_tch_p::text);
  perform pg_temp.rec('G2d owner lê a própria linha de mfa_grace',
    pg_temp.run_as(u_owner_p, 'aal1', 'select count(*)::text from public.mfa_grace'), '1');
  perform pg_temp.rec('G2e UPDATE em students funciona dentro da carência', pg_temp.run_as(u_owner_p, 'aal1', q_upd_stu), b_stu_p::text);

  -- ===== G3: carência vencida → bloqueia de novo =====
  update public.mfa_grace set grace_until = now() - interval '1 day' where user_id = u_owner_p;
  perform pg_temp.rec('G3  carência vencida: students', pg_temp.run_as(u_owner_p, 'aal1', q_stu_p), '0');

  -- ===== G4: fator verificado → aal1 bloqueia, aal2 libera =====
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, friendly_name)
  values (gen_random_uuid(), u_owner_p, 'totp', 'verified', now(), now(), 'teste');
  perform pg_temp.rec('G4a com fator, sessão aal1: students', pg_temp.run_as(u_owner_p, 'aal1', q_stu_p), '0');
  perform pg_temp.rec('G4b com fator, sessão aal2: students', pg_temp.run_as(u_owner_p, 'aal2', q_stu_p), b_stu_p::text);
  -- audit_logs cresceu durante o teste (o UPDATE do G2e dispara o trigger em
  -- todas as linhas): recalcula a linha de base logo antes de comparar.
  select count(*) into b_aud_p from public.audit_logs where school_id = s_pensar;
  perform pg_temp.rec('G4c com fator, sessão aal2: audit_logs', pg_temp.run_as(u_owner_p, 'aal2', q_aud_p), b_aud_p::text);

  -- ===== G5: REGRESSÃO — quem NÃO é exigido continua exatamente como antes =====
  perform pg_temp.rec('G5a financeiro de escola que exige: students (não é exigido)', pg_temp.run_as(u_fin_p, 'aal1', q_stu_p), b_stu_p::text);
  perform pg_temp.rec('G5b financeiro: teachers_directory',                            pg_temp.run_as(u_fin_p, 'aal1', q_dir_p), b_tch_p::text);
  perform pg_temp.rec('G5c admin de OUTRA escola (que não exige): vê a sua', pg_temp.run_as(u_admin_t, 'aal1', q_stu_t), b_stu_t::text);
  perform pg_temp.rec('G5d admin de OUTRA escola: continua sem ver Pensar',  pg_temp.run_as(u_admin_t, 'aal1', q_stu_p), '0');

  -- ===== G6: master é SEMPRE exigido =====
  -- O master real já tem uma carência em produção (criada pelo app ao logar);
  -- parte de "sem carência" dentro da transação (o ROLLBACK devolve a linha).
  delete from public.mfa_grace where user_id = u_master;
  perform pg_temp.rec('G6a master sem fator/carência: students (todas as escolas)', pg_temp.run_as(u_master, 'aal1', q_stu_all), '0');
  insert into public.mfa_grace (user_id, grace_until) values (u_master, now() + interval '3 days');
  perform pg_temp.rec('G6b master na carência: vê todas as escolas', pg_temp.run_as(u_master, 'aal1', q_stu_all), b_stu_all::text);
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, friendly_name)
  values (gen_random_uuid(), u_master, 'totp', 'verified', now(), now(), 'teste');
  perform pg_temp.rec('G6c master com fator + aal1: bloqueado', pg_temp.run_as(u_master, 'aal1', q_stu_all), '0');
  perform pg_temp.rec('G6d master com fator + aal2: liberado',  pg_temp.run_as(u_master, 'aal2', q_stu_all), b_stu_all::text);
  perform pg_temp.rec('G6e master aal2: vê todas as mensalidades', pg_temp.run_as(u_master, 'aal2', q_tui_all), b_tui_all::text);
  perform pg_temp.rec('G6f master aal1 com fator: mensalidades bloqueadas', pg_temp.run_as(u_master, 'aal1', q_tui_all), '0');

  -- ===== G7: view teachers_directory — bypass de RLS fechado =====
  perform pg_temp.rec('G7a UPDATE via view teachers_directory agora é negado (era possível)',
    pg_temp.run_as(u_fin_p, 'aal1',
      format('with x as (update public.teachers_directory set full_name = full_name where school_id = %L returning 1) select count(*)::text from x', s_pensar)),
    'ERR:42501');
  perform pg_temp.rec('G7b DELETE via view teachers_directory agora é negado (era possível)',
    pg_temp.run_as(u_fin_p, 'aal1',
      format('with x as (delete from public.teachers_directory where school_id = %L returning 1) select count(*)::text from x', s_pensar)),
    'ERR:42501');
  perform pg_temp.rec('G7c anon não lê teachers_directory',
    pg_temp.run_as(null, null, q_dir_p, 'anon'), 'ERR:42501');

  -- ===== R: RPCs SECURITY DEFINER =====
  -- bloqueado: o gate dispara ANTES de qualquer outra coisa
  perform pg_temp.rec('R1a owner bloqueado: get_active_teachers_salary_sum',
    pg_temp.run_as(u_owner_p, 'aal1', q_sal), 'ERR:42501');
  -- (o owner de Pensar tem fator verificado desde G4, então aal1 = bloqueado)
  perform pg_temp.rec('R1b owner bloqueado: import_teacher', pg_temp.run_as(u_owner_p, 'aal1', q_imp), 'ERR:42501');
  -- liberado (aal2) e não exigido (financeiro): a função ainda funciona
  perform pg_temp.rec('R2a owner aal2: get_active_teachers_salary_sum funciona',
    (pg_temp.run_as(u_owner_p, 'aal2', q_sal) not like 'ERR:%')::text, 'true');
  perform pg_temp.rec('R2b owner aal2: import_teacher funciona',
    (pg_temp.run_as(u_owner_p, 'aal2', q_imp) not like 'ERR:%')::text, 'true');
  perform pg_temp.rec('R2c financeiro (não exigido): get_active_teachers_salary_sum funciona',
    (pg_temp.run_as(u_fin_p, 'aal1', q_sal) not like 'ERR:%')::text, 'true');

  -- catálogo: as 9 funções têm o gate; promote_overdue_tuitions não
  select count(*)::text into v from pg_proc
   where pronamespace = 'public'::regnamespace and prosecdef
     and proname in ('get_active_teachers_salary_sum','import_teacher','import_student','import_enrollment',
                     'import_contract','insert_generated_expenses','insert_generated_tuitions',
                     'renegotiate_tuitions','save_class_with_teachers')
     and prosrc like '%assert_mfa_gate%';
  perform pg_temp.rec('C1  as 9 RPCs de dados têm assert_mfa_gate()', v, '9');
  select count(*)::text into v from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'promote_overdue_tuitions' and prosrc like '%assert_mfa_gate%';
  perform pg_temp.rec('C2  promote_overdue_tuitions (só cron) fica sem o gate', v, '0');

  -- catálogo: 15 policies mfa_gate, todas RESTRICTIVE
  select count(*)::text into v from pg_policy where polname = 'mfa_gate' and not polpermissive;
  perform pg_temp.rec('C3  15 policies mfa_gate RESTRICTIVE', v, '15');
end $$;

select n, cenario, got, esperado, ok from t_res order by n;

rollback;
