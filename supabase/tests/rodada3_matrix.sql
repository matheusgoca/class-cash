-- Matriz da rodada 3 (migration 20261128100000): EXECUTE, import_enrollment, renegociação, auditoria de profiles,
-- políticas de invitations, regressão dos fluxos e reversão.
--
-- Tudo dentro de BEGIN ... ROLLBACK (nada persiste, inclusive os ajustes de cenário feitos como postgres).
-- Para rodar antes de aplicar: gerar um arquivo trocando a linha marcadora MIG3 pelo conteúdo da migration e a linha
-- marcadora REV3 pelo conteúdo de docs/db/reversao_rodada3.sql. Com a migration já aplicada, tirar as duas marcadoras.
-- Esperado: 'BLOQ' = 0 linhas ou erro 42501; 'ERR' = qualquer erro; 'NAO42501' = sem erro de permissão de função;
-- 'OK' = sem erro; número/texto = igual. Saída: uma linha por célula; "ok" deve ser true em TODAS as de fase final.

begin;

create temp table t_res (n serial, fase text, cenario text, got text, esperado text, ok boolean);
create temp table t_p (k text primary key, v uuid);
create temp table t_anon (k text primary key, got text);

create function pg_temp.run_w(p_uid uuid, p_aal text, p_sql text, p_role text default 'authenticated', p_email text default null) returns text language plpgsql as $f$
declare v text; n int := 0;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
    else json_build_object('sub', p_uid, 'aal', p_aal, 'role', p_role, 'email', p_email)::text end, true);
  if p_role <> 'postgres' then execute format('set local role %I', p_role); end if;
  begin
    execute p_sql;
    get diagnostics n = row_count;
    raise exception 'probe_rollback';
  exception when others then
    if sqlerrm = 'probe_rollback' then v := n::text; else v := 'ERR:' || sqlstate; end if;
  end;
  reset role;
  return v;
end $f$;

-- executa p_sql como o usuário e devolve o resultado de p_after (como postgres), desfazendo tudo
create function pg_temp.run_after(p_uid uuid, p_role text, p_sql text, p_after text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'aal', 'aal2', 'role', p_role)::text end, true);
  if p_role <> 'postgres' then execute format('set local role %I', p_role); end if;
  begin
    execute p_sql;
    reset role;
    execute p_after into v;
    raise exception 'probe_rollback';
  exception when others then
    if sqlerrm <> 'probe_rollback' then v := 'ERR:' || sqlstate; end if;
  end;
  reset role;
  return v;
end $f$;

create function pg_temp.run_r(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
    else json_build_object('sub', p_uid, 'aal', 'aal1', 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERR:' || sqlstate;
  end;
  reset role;
  return v;
end $f$;

create function pg_temp.rec(p_fase text, p_cenario text, p_got text, p_esperado text) returns void language sql as $f$
  insert into t_res (fase, cenario, got, esperado, ok)
  values (p_fase, p_cenario, p_got, p_esperado,
          p_got = p_esperado
          or (p_esperado = 'BLOQ' and p_got in ('0', 'ERR:42501'))
          or (p_esperado = 'ERR' and p_got like 'ERR:%')
          or (p_esperado = 'OK' and p_got not like 'ERR:%')
          or (p_esperado = 'NAO42501' and p_got is distinct from 'ERR:42501'))
$f$;

-- personagens e dados de teste (por consulta, sem id fixo)
insert into t_p select 'master', user_id from public.profiles where is_master_admin limit 1;
insert into t_p select 'teste', school_id from public.profiles where is_master_admin limit 1;
insert into t_p select 'pensar', id from public.schools where name = 'Colégio Pensar';
insert into t_p select 'p_admin', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='pensar') and r.role = 'admin' limit 1;
insert into t_p select 'p_fin1', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='pensar') and r.role = 'financial' order by p.user_id limit 1;
insert into t_p select 'p_fin2', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='pensar') and r.role = 'financial' order by p.user_id desc limit 1;
insert into t_p select 't_a1', p.user_id from public.profiles p join public.user_roles r on r.user_id = p.user_id
 where p.school_id = (select v from t_p where k='teste') and r.role = 'admin' and not p.is_master_admin order by p.user_id limit 1;
insert into t_p select 'ts', id from public.students where school_id = (select v from t_p where k='teste') order by id limit 1;
insert into t_p select 'tc', c.id from public.classes c where c.school_id = (select v from t_p where k='teste')
  and not exists (select 1 from public.enrollments e where e.class_id = c.id and e.student_id = (select v from t_p where k='ts')) order by c.id limit 1;
insert into t_p select 'ps', id from public.students where school_id = (select v from t_p where k='pensar') order by id limit 1;
insert into t_p select 'pc', id from public.classes where school_id = (select v from t_p where k='pensar') order by id limit 1;
-- aluno do Teste com mensalidades pendentes (renegociação)
insert into t_p select 'ns', student_id from public.tuitions where school_id = (select v from t_p where k='teste') and status in ('pending','overdue')
  group by student_id order by student_id limit 1;

-- convites de teste (como postgres)
insert into public.invitations (id, email, role, school_id, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'conv-pensar@example.invalid', 'financial', (select v from t_p where k='pensar'), 'pending'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'conv-teste@example.invalid',  'financial', (select v from t_p where k='teste'), 'pending');

create function pg_temp.u(k text) returns text language sql as $f$ select v::text from t_p where k = $1 $f$;

create function pg_temp.matrix(d text) returns void language plpgsql as $f$
declare
  a1 text := pg_temp.u('t_a1'); mst text := pg_temp.u('master'); pa text := pg_temp.u('p_admin');
  pf1 text := pg_temp.u('p_fin1'); pf2 text := pg_temp.u('p_fin2');
  tst text := pg_temp.u('teste'); pen text := pg_temp.u('pensar');
  ts text := pg_temp.u('ts'); tc text := pg_temp.u('tc'); ps text := pg_temp.u('ps'); pc text := pg_temp.u('pc'); ns text := pg_temp.u('ns');
  rls text := '''get_current_user_role'',''get_user_school_id'',''is_master_admin''';
  lista_a1 text := '''get_active_teachers_salary_sum'',''import_contract'',''import_enrollment'',''import_student'',''import_teacher'',''insert_generated_expenses'',''insert_generated_tuitions'',''renegotiate_tuitions'',''save_class_with_teachers''';
  lista_a2 text := '''get_user_by_email'',''get_user_role'',''has_role'',''promote_overdue_tuitions''';
  v text;
  tids text;
begin
  -- ===== A. EXECUTE =====
  perform pg_temp.rec(d, 'G1 anon executa funções definer da lista (13)', (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname in (select unnest(string_to_array(replace(lista_a1||','||lista_a2,'''',''),','))) and has_function_privilege('anon', p.oid, 'execute')), '0');
  perform pg_temp.rec(d, 'G2 public executa funções definer da lista (13)', (select count(*)::text from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.pronamespace='public'::regnamespace and p.prosecdef and a.grantee = 0 and p.proname in (select unnest(string_to_array(replace(lista_a1||','||lista_a2,'''',''),',')))), '0');
  perform pg_temp.rec(d, 'G3 authenticated executa as 9 usadas pelo app', (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname in (select unnest(string_to_array(replace(lista_a1,'''',''),','))) and has_function_privilege('authenticated', p.oid, 'execute')), (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname in (select unnest(string_to_array(replace(lista_a1,'''',''),',')))));
  perform pg_temp.rec(d, 'G4 authenticated executa as 4 sem uso no app', (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname in (select unnest(string_to_array(replace(lista_a2,'''',''),','))) and has_function_privilege('authenticated', p.oid, 'execute')), '0');
  perform pg_temp.rec(d, 'G5 service_role executa as 13', (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname in (select unnest(string_to_array(replace(lista_a1||','||lista_a2,'''',''),','))) and has_function_privilege('service_role', p.oid, 'execute')), (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname in (select unnest(string_to_array(replace(lista_a1||','||lista_a2,'''',''),',')))));
  perform pg_temp.rec(d, 'G6 as 3 funções de RLS continuam executáveis por anon', (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (select unnest(string_to_array(replace(rls,'''',''),','))) and has_function_privilege('anon', p.oid, 'execute')), '3');
  perform pg_temp.rec(d, 'G7 definer (não-trigger) executáveis por anon fora das 3 de RLS', (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype and p.proname not in (select unnest(string_to_array(replace(rls,'''',''),','))) and has_function_privilege('anon', p.oid, 'execute')), '0');

  -- anon: leitura de tabelas e chamada de RPC (paridade antes/depois: sem erro novo)
  foreach v in array array['students','tuitions','profiles','invitations','schools','classes','user_roles','audit_logs'] loop
    if d = 'antes' then
      insert into t_anon values ('tbl_'||v, pg_temp.run_r(null, 'anon', 'select count(*)::text from public.'||v));
    else
      perform pg_temp.rec(d, 'AN anon lê '||v||' (igual ao estado anterior)', pg_temp.run_r(null, 'anon', 'select count(*)::text from public.'||v), (select got from t_anon where k='tbl_'||v));
    end if;
  end loop;
  perform pg_temp.rec(d, 'AN-rpc anon chama import_student', pg_temp.run_w(null,'', 'select public.import_student(''{}''::jsonb, '''||tst||'''::uuid)', 'anon'), 'ERR');
  perform pg_temp.rec(d, 'AN-rpc anon: função sem uso no app', pg_temp.run_w(null,'', 'select * from public.get_user_by_email(''x@example.invalid'')', 'anon'), 'ERR');
  perform pg_temp.rec(d, 'AN-rpc anon chama is_master_admin (RLS)', pg_temp.run_w(null,'', 'select public.is_master_admin()', 'anon'), 'OK');
  perform pg_temp.rec(d, 'AN-rpc authenticated: função sem uso no app', pg_temp.run_w(pa::uuid,'aal1', 'select * from public.get_user_by_email(''x@example.invalid'')'), case when d='antes' then 'OK' else 'ERR' end);

  -- ===== B. import_enrollment =====
  perform pg_temp.rec(d, 'I1 admin Teste matricula aluno e turma da própria escola', pg_temp.run_w(a1::uuid,'aal1','select public.import_enrollment('''||ts||''','''||tc||''','''||tst||''')'), 'OK');
  perform pg_temp.rec(d, 'I2 admin Teste: turma de OUTRA escola com p_school_id próprio', pg_temp.run_w(a1::uuid,'aal1','select public.import_enrollment('''||ts||''','''||pc||''','''||tst||''')'), case when d='antes' then 'OK' else 'ERR' end);
  perform pg_temp.rec(d, 'I3 admin Teste: aluno de OUTRA escola com p_school_id próprio', pg_temp.run_w(a1::uuid,'aal1','select public.import_enrollment('''||ps||''','''||tc||''','''||tst||''')'), case when d='antes' then 'OK' else 'ERR' end);
  perform pg_temp.rec(d, 'I4 admin Teste: p_school_id de outra escola', pg_temp.run_w(a1::uuid,'aal1','select public.import_enrollment('''||ts||''','''||tc||''','''||pen||''')'), 'ERR');
  perform pg_temp.rec(d, 'I5 master matricula dentro de uma escola', pg_temp.run_w(mst::uuid,'aal2','select public.import_enrollment('''||ts||''','''||tc||''','''||tst||''')'), 'OK');

  -- ===== C. renegotiate_tuitions =====
  select string_agg(quote_literal(id::text), ',') into tids from (select id from public.tuitions where school_id = tst::uuid and student_id = ns::uuid and status in ('pending','overdue') limit 1) x;
  perform pg_temp.rec(d, 'N1 renegociação: created_by = quem chama, mesmo com p_created_by de outro usuário',
    pg_temp.run_after(a1::uuid,'authenticated',
      'select public.renegotiate_tuitions('''||ns||'''::uuid, '''||tst||'''::uuid, array['||tids||']::uuid[], 100, 2, current_date + 30, ''teste'', '''||mst||'''::uuid)',
      'select created_by::text from public.renegotiations order by created_at desc limit 1'),
    case when d='antes' then mst else a1 end);
  perform pg_temp.rec(d, 'N2 renegociação com p_created_by nulo: created_by = quem chama',
    pg_temp.run_after(a1::uuid,'authenticated',
      'select public.renegotiate_tuitions('''||ns||'''::uuid, '''||tst||'''::uuid, array['||tids||']::uuid[], 100, 2, current_date + 30, ''teste'', null)',
      'select created_by::text from public.renegotiations order by created_at desc limit 1'),
    a1);
  perform pg_temp.rec(d, 'N3 renegociação em escola alheia', pg_temp.run_w(a1::uuid,'aal1','select public.renegotiate_tuitions('''||ns||'''::uuid, '''||pen||'''::uuid, array['||tids||']::uuid[], 100, 2, current_date + 30, ''x'', null)'), 'ERR');

  -- ===== D. Auditoria de profiles (contexto sem cliente) =====
  perform pg_temp.rec(d, 'U1 mudança de school_id gera 1 registro (profiles)', pg_temp.run_after(null,'postgres',
    'update public.profiles set school_id = '''||tst||''' where user_id = '''||pf2||'''',
    'select count(*)::text||coalesce(max(changed_fields::text),'''') from public.audit_logs where table_name=''profiles'' and created_at >= now() - interval ''1 minute'' and action = ''update'' and record_id = (select id from public.profiles where user_id = '''||pf2||''')'),
    case when d='antes' then '0' else '1{school_id}' end);
  perform pg_temp.rec(d, 'U2 mudança de is_master_admin gera 1 registro', pg_temp.run_after(null,'postgres',
    'update public.profiles set is_master_admin = true where user_id = '''||pf2||'''',
    'select count(*)::text||coalesce(max(changed_fields::text),'''') from public.audit_logs where table_name=''profiles'' and created_at >= now() - interval ''1 minute'' and action = ''update'' and record_id = (select id from public.profiles where user_id = '''||pf2||''')'),
    case when d='antes' then '0' else '1{is_master_admin}' end);
  perform pg_temp.rec(d, 'U3 só nome: nenhum registro', pg_temp.run_after(null,'postgres',
    'update public.profiles set full_name = full_name || ''x'' where user_id = '''||pf2||'''',
    'select count(*)::text from public.audit_logs where table_name=''profiles'' and created_at >= now() - interval ''1 minute'' and record_id = (select id from public.profiles where user_id = '''||pf2||''')'),
    '0');
  perform pg_temp.rec(d, 'U4 mudança de papel já é auditada (user_roles)', pg_temp.run_after(null,'postgres',
    'update public.user_roles set role = ''teacher'' where user_id = '''||pf2||'''',
    'select count(*)::text from public.audit_logs where table_name=''user_roles'' and created_at >= now() - interval ''1 minute'' and action = ''update'' and record_id = (select id from public.user_roles where user_id = '''||pf2||''')'),
    '1');
  perform pg_temp.rec(d, 'U5 cadastro novo (handle_new_user) cria o perfil e registra a criação', pg_temp.run_after(null,'postgres',
    'insert into auth.users (id, instance_id, aud, role, email) values (''22222222-2222-2222-2222-222222222222'', ''00000000-0000-0000-0000-000000000000'', ''authenticated'', ''authenticated'', ''audit@example.invalid'')',
    'select (select count(*) from public.profiles where user_id = ''22222222-2222-2222-2222-222222222222'')::text||''/''||(select count(*) from public.audit_logs where table_name=''profiles'' and action=''insert'' and created_at >= now() - interval ''1 minute'')::text'),
    case when d='antes' then '1/0' else '1/1' end);
  perform pg_temp.rec(d, 'U6 exclusão de usuário (cascata para perfil) registra a remoção e não é bloqueada', pg_temp.run_after(null,'postgres',
    'insert into auth.users (id, instance_id, aud, role, email) values (''33333333-3333-3333-3333-333333333333'', ''00000000-0000-0000-0000-000000000000'', ''authenticated'', ''authenticated'', ''audit2@example.invalid''); delete from auth.users where id = ''33333333-3333-3333-3333-333333333333''',
    'select count(*)::text from public.audit_logs where table_name=''profiles'' and action=''delete'' and created_at >= now() - interval ''1 minute'''),
    case when d='antes' then '0' else '1' end);

  -- ===== E. invitations =====
  perform pg_temp.rec(d, 'V1 financeiro: criar convite (restrito ao admin)', pg_temp.run_w(pf1::uuid,'aal1','insert into public.invitations (email, role, school_id, status) values (''novo@example.invalid'',''admin'','''||pen||''',''pending'')'), case when d='antes' then '1' else 'BLOQ' end);
  perform pg_temp.rec(d, 'V2 admin cria convite na própria escola', pg_temp.run_w(pa::uuid,'aal1','insert into public.invitations (email, role, school_id, status) values (''novo@example.invalid'',''financial'','''||pen||''',''pending'')'), '1');
  perform pg_temp.rec(d, 'V3 admin altera convite da própria escola', pg_temp.run_w(pa::uuid,'aal1','update public.invitations set status=''expired'' where id=''aaaaaaaa-0000-0000-0000-000000000001'''), case when d='antes' then 'ERR' else '1' end);
  perform pg_temp.rec(d, 'V4 admin cancela (apaga) convite da própria escola', pg_temp.run_w(pa::uuid,'aal1','delete from public.invitations where id=''aaaaaaaa-0000-0000-0000-000000000001'''), '1');
  perform pg_temp.rec(d, 'V5 admin: convite de outra escola (alterar)', pg_temp.run_w(pa::uuid,'aal1','update public.invitations set status=''expired'' where id=''aaaaaaaa-0000-0000-0000-000000000002'''), 'BLOQ');
  perform pg_temp.rec(d, 'V6 admin: convite de outra escola (apagar)', pg_temp.run_w(pa::uuid,'aal1','delete from public.invitations where id=''aaaaaaaa-0000-0000-0000-000000000002'''), 'BLOQ');
  perform pg_temp.rec(d, 'V7 admin: criar convite em outra escola', pg_temp.run_w(pa::uuid,'aal1','insert into public.invitations (email, role, school_id, status) values (''z@example.invalid'',''admin'','''||tst||''',''pending'')'), 'BLOQ');
  perform pg_temp.rec(d, 'V8 financeiro: apagar convite (restrito ao admin)', pg_temp.run_w(pf1::uuid,'aal1','delete from public.invitations where id=''aaaaaaaa-0000-0000-0000-000000000001'''), case when d='antes' then '1' else 'BLOQ' end);
  perform pg_temp.rec(d, 'V9 financeiro altera convite da própria escola', pg_temp.run_w(pf1::uuid,'aal1','update public.invitations set status=''expired'' where id=''aaaaaaaa-0000-0000-0000-000000000001'''), 'BLOQ');
  perform pg_temp.rec(d, 'V10 convidado: alterar convite pelo próprio e-mail (bloqueado)', pg_temp.run_w(pf1::uuid,'aal1','update public.invitations set role=''admin'' where email=''conv-pensar@example.invalid''', 'authenticated', 'conv-pensar@example.invalid'), 'BLOQ');
  perform pg_temp.rec(d, 'V11 master altera convite de qualquer escola', pg_temp.run_w(mst::uuid,'aal2','update public.invitations set status=''expired'' where id=''aaaaaaaa-0000-0000-0000-000000000002'''), '1');
  perform pg_temp.rec(d, 'V12 master apaga convite de qualquer escola', pg_temp.run_w(mst::uuid,'aal2','delete from public.invitations where id=''aaaaaaaa-0000-0000-0000-000000000002'''), '1');
  perform pg_temp.rec(d, 'V13 admin lê convites só da própria escola', pg_temp.run_r(pa::uuid,'authenticated','select count(*)::text from public.invitations where school_id is distinct from '''||pen||''''), '0');

  -- ===== Regressão dos fluxos (autoridade mantida para quem tem papel) =====
  perform pg_temp.rec(d, 'F1 import_student (admin Teste) chega à função (sem erro de permissão de EXECUTE)', pg_temp.run_w(a1::uuid,'aal1','select public.import_student(''{}''::jsonb, '''||tst||'''::uuid)'), 'NAO42501');
  perform pg_temp.rec(d, 'F2 import_teacher (admin Teste)', pg_temp.run_w(a1::uuid,'aal1','select public.import_teacher(''{}''::jsonb, '''||tst||'''::uuid)'), 'NAO42501');
  perform pg_temp.rec(d, 'F3 import_contract (admin Teste)', pg_temp.run_w(a1::uuid,'aal1','select public.import_contract(''{}''::jsonb, '''||tst||'''::uuid)'), 'NAO42501');
  perform pg_temp.rec(d, 'F4 insert_generated_expenses (admin Teste)', pg_temp.run_w(a1::uuid,'aal1','select public.insert_generated_expenses('''||tst||'''::uuid, ''[]''::jsonb)'), 'NAO42501');
  perform pg_temp.rec(d, 'F5 insert_generated_tuitions (admin Teste)', pg_temp.run_w(a1::uuid,'aal1','select public.insert_generated_tuitions('''||tst||'''::uuid, ''[]''::jsonb)'), 'NAO42501');
  perform pg_temp.rec(d, 'F6 get_active_teachers_salary_sum (financeiro Pensar)', pg_temp.run_w(pf1::uuid,'aal1','select public.get_active_teachers_salary_sum('''||pen||'''::uuid)'), 'OK');
  perform pg_temp.rec(d, 'F7 save_class_with_teachers (admin Teste)', pg_temp.run_w(a1::uuid,'aal1','select public.save_class_with_teachers(null::uuid, '''||tst||'''::uuid, ''Turma Regressao'', ''x'', '''', 10, 0, 0, ''#ffffff'', ''{}''::uuid[], ''{}''::numeric[], ''manual'')'), 'NAO42501');
  perform pg_temp.rec(d, 'F8 login: as 3 funções de RLS respondem para authenticated', pg_temp.run_r(pa::uuid,'authenticated','select (public.get_current_user_role() = ''admin'' and public.get_user_school_id() is not null and not public.is_master_admin())::text'), 'true');
  perform pg_temp.rec(d, 'F9 cron: promote_overdue_tuitions roda como postgres', pg_temp.run_w(null,'','select public.promote_overdue_tuitions()','postgres'), 'OK');
  perform pg_temp.rec(d, 'F10 cron: o job promote roda como postgres (dono da função)', (select (j.username = 'postgres')::text from cron.job j where j.jobname = 'promote-overdue-tuitions'), 'true');
  perform pg_temp.rec(d, 'F11 Edge Functions: service_role mantém EXECUTE', has_function_privilege('service_role', 'public.get_user_by_email(text)', 'execute')::text, 'true');
end $f$;

select pg_temp.matrix('antes');

-- @@MIG3@@

select pg_temp.matrix('depois');

-- Onboarding (cliente cria a própria escola e liga o perfil) continua funcionando com a auditoria de profiles
insert into t_p select 'novo', p.user_id from public.profiles p
 where p.school_id is null and not p.is_master_admin and not exists (select 1 from public.user_roles r where r.user_id = p.user_id) limit 1;
select set_config('request.jwt.claims', '', true);
insert into public.schools (name, segments, owner_user_id) values ('Escola Regressao R3', array['fundamental_1'], (select v from t_p where k='novo'));
select pg_temp.rec('depois', 'O1 onboarding: perfil liga (de NULL) à escola da qual é owner, com auditoria ativa',
  pg_temp.run_after((select v from t_p where k='novo'), 'authenticated',
    'update public.profiles set school_id = (select id from public.schools where name = ''Escola Regressao R3'') where user_id = '''||(select v::text from t_p where k='novo')||'''',
    'select count(*)::text from public.audit_logs where table_name=''profiles'' and action=''update'' and created_at >= now() - interval ''1 minute'' and changed_fields = array[''school_id'']'),
  '1');

-- ===== Reversão =====
-- @@REV3@@
select pg_temp.rec('reversao', 'V-G1 anon volta a executar as 13', (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname in ('get_active_teachers_salary_sum','import_contract','import_enrollment','import_student','import_teacher','insert_generated_expenses','insert_generated_tuitions','renegotiate_tuitions','save_class_with_teachers','get_user_by_email','get_user_role','has_role','promote_overdue_tuitions') and has_function_privilege('anon', p.oid, 'execute')), (select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname in ('get_active_teachers_salary_sum','import_contract','import_enrollment','import_student','import_teacher','insert_generated_expenses','insert_generated_tuitions','renegotiate_tuitions','save_class_with_teachers','get_user_by_email','get_user_role','has_role','promote_overdue_tuitions')));
select pg_temp.rec('reversao', 'V-T trigger e função de auditoria removidos', (select count(*)::text from pg_trigger where tgname = 'profiles_audit' and not tgisinternal), '0');
select pg_temp.rec('reversao', 'V-I2 import_enrollment volta ao comportamento anterior',
  pg_temp.run_w((select v from t_p where k='t_a1'),'aal1','select public.import_enrollment('''||(select v::text from t_p where k='ts')||''','''||(select v::text from t_p where k='pc')||''','''||(select v::text from t_p where k='teste')||''')'), 'OK');
select pg_temp.rec('reversao', 'V-V1 política de insert de convites volta ao anterior (financeiro cria)',
  pg_temp.run_w((select v from t_p where k='p_fin1'),'aal1','insert into public.invitations (email, role, school_id, status) values (''novo@example.invalid'',''admin'','''||(select v::text from t_p where k='pensar')||''',''pending'')'), '1');
select pg_temp.rec('reversao', 'V-V3 política de update de convites volta ao anterior',
  pg_temp.run_w((select v from t_p where k='p_admin'),'aal1','update public.invitations set status=''expired'' where id=''aaaaaaaa-0000-0000-0000-000000000001'''), 'ERR');

select n, fase, cenario, got, esperado, ok from t_res order by case fase when 'antes' then 1 when 'depois' then 2 else 3 end, n;

rollback;
